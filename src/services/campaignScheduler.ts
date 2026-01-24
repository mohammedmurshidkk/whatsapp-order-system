import { supabase } from '../config/database';
import { logger } from '../utils/logger';
import * as whatsappService from './whatsapp';
import { TemplateMessage } from './whatsapp/types';

const POLL_INTERVAL_MS = 60_000; // 1 minute
let schedulerInterval: NodeJS.Timeout | null = null;

/**
 * Start the campaign scheduler
 * Polls database every minute for due scheduled campaigns
 */
export function startCampaignScheduler(): void {
  if (schedulerInterval) {
    logger.warn('Campaign scheduler already running');
    return;
  }

  logger.info('Starting campaign scheduler (polling every 60s)');

  // Run immediately on start
  checkScheduledCampaigns();

  // Then poll every minute
  schedulerInterval = setInterval(checkScheduledCampaigns, POLL_INTERVAL_MS);
}

/**
 * Stop the campaign scheduler
 */
export function stopCampaignScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    logger.info('Campaign scheduler stopped');
  }
}

/**
 * Check for and process due scheduled campaigns
 */
async function checkScheduledCampaigns(): Promise<void> {
  try {
    // Find campaigns that are scheduled and due
    const { data: dueCampaigns, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('status', 'scheduled')
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true });

    if (error) {
      logger.error('Error fetching scheduled campaigns:', error);
      return;
    }

    if (!dueCampaigns || dueCampaigns.length === 0) {
      return;
    }

    logger.info(`Found ${dueCampaigns.length} scheduled campaign(s) due for processing`);

    for (const campaign of dueCampaigns) {
      await processScheduledCampaign(campaign);
    }
  } catch (error) {
    logger.error('Error in checkScheduledCampaigns:', error);
  }
}

/**
 * Process a single scheduled campaign
 * Uses row-level locking via status update to prevent duplicates
 */
async function processScheduledCampaign(campaign: any): Promise<void> {
  const { id: campaignId, business_id: businessId, template_name, language_code } = campaign;

  try {
    // Attempt to lock the campaign by setting status to 'processing'
    // This prevents other instances from picking it up
    const { data: locked, error: lockError } = await supabase
      .from('campaigns')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', campaignId)
      .eq('status', 'scheduled') // Only update if still scheduled (prevents race)
      .select()
      .single();

    if (lockError || !locked) {
      // Another instance already picked it up or status changed
      logger.debug(`Campaign ${campaignId} already being processed or status changed`);
      return;
    }

    logger.info(`Processing scheduled campaign: ${campaignId} - ${campaign.name}`);

    // Get target phone numbers
    const targetNumbers = await resolveTargetNumbers(campaign);

    if (targetNumbers.length === 0) {
      await updateCampaignStatus(campaignId, 'failed', { error: 'No target customers found' });
      return;
    }

    // Update status to sending
    await supabase
      .from('campaigns')
      .update({ status: 'sending', total_recipients: targetNumbers.length })
      .eq('id', campaignId);

    // Build template components from stored variables
    const components = buildTemplateComponents(campaign);

    // Send messages
    await sendCampaignMessages(
      targetNumbers,
      template_name,
      { code: language_code || 'en_US' },
      components,
      businessId,
      campaignId
    );
  } catch (error: any) {
    logger.error(`Error processing scheduled campaign ${campaignId}:`, error);
    await updateCampaignStatus(campaignId, 'failed', { error: error.message });
  }
}

/**
 * Resolve target phone numbers from campaign settings
 */
async function resolveTargetNumbers(campaign: any): Promise<string[]> {
  const { business_id, target_phone_numbers, target_user_ids } = campaign;

  if (target_phone_numbers?.length > 0) {
    return target_phone_numbers;
  }

  if (target_user_ids?.length > 0) {
    const { data: customers, error } = await supabase
      .from('customers')
      .select('phone')
      .in('id', target_user_ids)
      .eq('business_id', business_id);

    if (error) throw error;
    return customers?.map((c) => c.phone) || [];
  }

  // Default: all customers for business
  const { data: customers, error } = await supabase
    .from('customers')
    .select('phone')
    .eq('business_id', business_id);

  if (error) throw error;
  return customers?.map((c) => c.phone) || [];
}

/**
 * Build template components from stored template_variables
 */
function buildTemplateComponents(campaign: any): any[] {
  const { template_variables, image_url } = campaign;
  const components: any[] = [];

  // Add header with image if present
  if (image_url) {
    components.push({
      type: 'header',
      parameters: [{ type: 'image', image: { link: image_url } }],
    });
  }

  // Add body parameters if present
  if (template_variables?.body_params?.length > 0) {
    components.push({
      type: 'body',
      parameters: template_variables.body_params.map((text: string) => ({
        type: 'text',
        text,
      })),
    });
  }

  return components;
}

/**
 * Send campaign messages to all recipients
 */
async function sendCampaignMessages(
  numbers: string[],
  templateName: string,
  language: { code: string },
  components: any[],
  businessId: string,
  campaignId: string
): Promise<void> {
  logger.info(`Sending campaign ${campaignId} to ${numbers.length} recipients`);

  let successCount = 0;
  let failCount = 0;

  for (const phone of numbers) {
    try {
      const template: TemplateMessage = {
        name: templateName,
        language,
        components,
      };

      await whatsappService.sendTemplate(phone, template, businessId);
      successCount++;

      // Small delay to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (err) {
      logger.error(`Failed to send campaign message to ${phone}:`, err);
      failCount++;
    }
  }

  // Update campaign with final results
  await supabase
    .from('campaigns')
    .update({
      successful_sends: successCount,
      failed_sends: failCount,
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', campaignId);

  logger.info(
    `Campaign ${campaignId} completed. Success: ${successCount}, Failed: ${failCount}`
  );
}

/**
 * Update campaign status with optional error details
 */
async function updateCampaignStatus(
  campaignId: string,
  status: string,
  errorDetails?: { error: string }
): Promise<void> {
  const update: Record<string, any> = { status };
  if (errorDetails) {
    update.error_details = errorDetails;
  }
  if (status === 'completed' || status === 'failed') {
    update.completed_at = new Date().toISOString();
  }

  await supabase.from('campaigns').update(update).eq('id', campaignId);
}
