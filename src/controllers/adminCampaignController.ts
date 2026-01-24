import { Request, Response } from 'express';
import * as whatsappService from '../services/whatsapp';
import {
  TemplateMessage,
  MetaMessageTemplate,
} from '../services/whatsapp/types';
import { logger } from '../utils/logger';
import { supabase } from '../config/database';
import { getBusinessId } from '../middleware/auth';
import {
  uploadCampaignImage,
  validateCampaignImage,
  deleteCampaignImage,
} from '../services/mediaService';

/**
 * Get available WhatsApp message templates from Meta
 * Returns templates with their parameter requirements
 */
export async function getTemplates(req: Request, res: Response): Promise<void> {
  const { status } = req.query;

  try {
    // Validate status filter if provided
    const statusFilter = status as
      | 'APPROVED'
      | 'PENDING'
      | 'REJECTED'
      | undefined;
    if (
      status &&
      !['APPROVED', 'PENDING', 'REJECTED'].includes(status as string)
    ) {
      res.status(400).json({
        error: 'Invalid status filter. Use APPROVED, PENDING, or REJECTED',
      });
      return;
    }

    const businessId = getBusinessId(req);

    if (businessId) {
      // Fetch templates from Meta
      const templates = await whatsappService.getMessageTemplates(
        statusFilter,
        businessId
      );

      // Parse each template to extract parameter info
      const templatesWithParams = templates.map(
        (template: MetaMessageTemplate) => {
          const paramInfo = whatsappService.parseTemplateParameters(template);
          return {
            ...template,
            parameterInfo: paramInfo,
          };
        }
      );

      res.status(200).json({
        success: true,
        templates: templatesWithParams,
        count: templatesWithParams.length,
      });
    }
  } catch (error: any) {
    logger.error('Error fetching templates:', error);
    res.status(500).json({
      error: 'Failed to fetch templates',
      details: error.message,
    });
  }
}

/**
 * Get a single template by name with full details
 */
export async function getTemplateByName(
  req: Request,
  res: Response
): Promise<void> {
  const { templateName } = req.params;

  try {
    const businessId = getBusinessId(req);

    if (businessId) {
      const templates = await whatsappService.getMessageTemplates(
        'APPROVED',
        businessId
      );
      const template = templates.find(
        (t: MetaMessageTemplate) => t.name === templateName
      );

      if (!template) {
        res.status(404).json({
          error: `Template '${templateName}' not found or not approved`,
        });
        return;
      }

      const paramInfo = whatsappService.parseTemplateParameters(template);

      res.status(200).json({
        success: true,
        template: {
          ...template,
          parameterInfo: paramInfo,
        },
      });
    }
  } catch (error: any) {
    logger.error('Error fetching template:', error);
    res.status(500).json({
      error: 'Failed to fetch template',
      details: error.message,
    });
  }
}

/**
 * Send a bulk campaign using a WhatsApp template
 *
 * Example with image header:
 * {
 *   "template_name": "seasonal_celebration",
 *   "language_code": "en_US",
 *   "components": [
 *     {
 *       "type": "header",
 *       "parameters": [
 *         {
 *           "type": "image",
 *           "image": {
 *             "link": "https://your-supabase-url.co/storage/v1/object/public/campaign-media/business-id/republic-day.jpg"
 *           }
 *         }
 *       ]
 *     },
 *     {
 *       "type": "body",
 *       "parameters": [
 *         { "type": "text", "text": "Republic Day" },
 *         { "type": "text", "text": "Get 25% off today!" },
 *         { "type": "text", "text": "Use code: INDIA26" }
 *       ]
 *     }
 *   ],
 *   "phone_numbers": ["919876543210"]
 * }
 */
export async function sendCampaign(req: Request, res: Response): Promise<void> {
  const {
    template_name,
    language_code,
    components,
    phone_numbers,
    user_ids,
    filter_tags,
  } = req.body;

  // We need to get the business ID from the authenticated user
  // Assuming authMiddleware attaches user to req.user
  // For now, we'll look up the business associated with the admin
  // This part might need adjustment based on how admin auth works in your system
  // Using a simplified approach: fetch business for the first admin user found or passed in header

  // Actually, we should use the business_id from the request or user context.
  // Looking at other controllers, it seems business context is often derived or passed.
  // Let's assume the user is an admin of a specific business.

  const businessId = getBusinessId(req);

  if (!businessId) {
    res.status(400).json({ error: 'Business ID not found in user context' });
    return;
  }

  if (!template_name) {
    res.status(400).json({ error: 'Template name is required' });
    return;
  }

  const language = {
    code: language_code || 'en_US',
  };

  let targetNumbers: string[] = [];

  try {
    if (
      phone_numbers &&
      Array.isArray(phone_numbers) &&
      phone_numbers.length > 0
    ) {
      targetNumbers = phone_numbers;
    } else if (user_ids && Array.isArray(user_ids) && user_ids.length > 0) {
      // Resolve user IDs to phone numbers
      const { data: customers, error } = await supabase
        .from('customers')
        .select('phone')
        .in('id', user_ids)
        .eq('business_id', businessId);

      if (error) throw error;
      targetNumbers = customers.map((c) => c.phone);
    } else {
      // Fetch ALL customers for this business
      let query = supabase
        .from('customers')
        .select('phone')
        .eq('business_id', businessId);

      if (filter_tags && Array.isArray(filter_tags)) {
        // Implement tag filtering if you have a tags system
      }

      const { data: customers, error } = await query;

      if (error) throw error;

      targetNumbers = customers.map((c) => c.phone);
    }

    if (targetNumbers.length === 0) {
      res.status(400).json({ error: 'No target customers found' });
      return;
    }

    // Send to the first customer synchronously to validate template
    const firstPhone = targetNumbers[0];
    const remainingNumbers = targetNumbers.slice(1);

    const template: TemplateMessage = {
      name: template_name,
      language,
      components,
    };

    try {
      await whatsappService.sendTemplate(firstPhone, template, businessId);
    } catch (error: any) {
      logger.error('Failed to send validation message:', error);

      // Extract Meta error message if available
      const metaError = error.response?.data?.error?.message || error.message;

      res.status(400).json({
        error: 'Campaign validation failed. Template might be invalid.',
        details: metaError,
      });
      return;
    }

    // Create campaign record in database
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .insert({
        business_id: businessId,
        name: `Campaign: ${template_name}`,
        campaign_type: 'template',
        template_name,
        language_code: language.code,
        total_recipients: targetNumbers.length,
        successful_sends: remainingNumbers.length === 0 ? 1 : 0,
        failed_sends: 0,
        status: remainingNumbers.length === 0 ? 'completed' : 'sending',
        started_at: new Date().toISOString(),
        completed_at:
          remainingNumbers.length === 0 ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (campaignError) {
      logger.error('Failed to create campaign record:', campaignError);
      // Continue anyway - messages were sent
    }

    // Send remaining messages in background
    if (remainingNumbers.length > 0 && campaign) {
      processCampaign(
        remainingNumbers,
        template_name,
        language,
        components,
        businessId,
        campaign.id
      );
    }

    res.status(200).json({
      success: true,
      message: `Campaign started. Validation successful. Sending to ${targetNumbers.length} customers.`,
      campaign_id: campaign?.id,
      job_id: Date.now().toString(),
    });
  } catch (error) {
    logger.error('Error starting campaign:', error);
    res.status(500).json({ error: 'Failed to start campaign' });
  }
}

async function processCampaign(
  numbers: string[],
  templateName: string,
  language: { code: string },
  components: any[],
  businessId: string,
  campaignId: string
) {
  logger.info(
    `Starting campaign '${templateName}' (ID: ${campaignId}) for ${numbers.length} users`
  );

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

      // small delay to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (err) {
      logger.error(`Failed to send campaign message to ${phone}`, err);
      failCount++;
    }
  }

  // Update campaign record with final counts
  try {
    await supabase
      .from('campaigns')
      .update({
        successful_sends: successCount + 1, // +1 for validation message
        failed_sends: failCount,
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', campaignId);

    logger.info(
      `Campaign '${templateName}' (ID: ${campaignId}) finished. Success: ${
        successCount + 1
      }, Failed: ${failCount}`
    );
  } catch (err) {
    logger.error(`Failed to update campaign ${campaignId} status:`, err);
  }
}

/**
 * Upload campaign image/poster
 * Returns public URL for use in WhatsApp templates
 */
export async function uploadCampaignMedia(
  req: Request,
  res: Response
): Promise<void> {
  const businessId = getBusinessId(req);

  if (!businessId) {
    res.status(400).json({ error: 'Business ID not found' });
    return;
  }

  // Check if file was uploaded
  if (!req.file) {
    res.status(400).json({ error: 'No image file uploaded' });
    return;
  }

  const file = req.file.buffer;
  const filename = req.file.originalname;

  try {
    // Validate image
    const validation = validateCampaignImage(file, filename);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    // Upload to Supabase Storage
    const result = await uploadCampaignImage(file, filename, businessId);

    if (!result.success) {
      res.status(500).json({ error: result.error || 'Failed to upload image' });
      return;
    }

    logger.info(
      `Campaign image uploaded for business ${businessId}: ${result.publicUrl}`
    );

    res.status(200).json({
      success: true,
      imageUrl: result.publicUrl,
      filePath: result.filePath,
      message: 'Image uploaded successfully',
    });
  } catch (error: any) {
    logger.error('Error in uploadCampaignMedia:', error);
    res.status(500).json({ error: 'Failed to upload campaign image' });
  }
}

/**
 * Create a campaign record in database
 * Stores campaign details for tracking and history
 */
export async function createCampaign(
  req: Request,
  res: Response
): Promise<void> {
  const businessId = getBusinessId(req);

  if (!businessId) {
    res.status(400).json({ error: 'Business ID not found' });
    return;
  }

  const {
    name,
    description,
    campaign_type = 'template',
    template_name,
    language_code = 'en_US',
    image_url,
    template_variables,
    target_type = 'all',
    target_phone_numbers,
    target_user_ids,
    filter_tags,
    scheduled_at,
  } = req.body;

  if (!name) {
    res.status(400).json({ error: 'Campaign name is required' });
    return;
  }

  try {
    // Calculate total recipients
    let totalRecipients = 0;
    if (target_phone_numbers?.length) {
      totalRecipients = target_phone_numbers.length;
    } else if (target_user_ids?.length) {
      totalRecipients = target_user_ids.length;
    } else {
      // Count all customers for business
      const { count } = await supabase
        .from('customers')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', businessId);
      totalRecipients = count || 0;
    }

    // Determine status based on scheduled_at
    const campaignStatus = scheduled_at ? 'scheduled' : 'draft';

    // Insert campaign record
    const { data: campaign, error } = await supabase
      .from('campaigns')
      .insert({
        business_id: businessId,
        name,
        description,
        campaign_type,
        template_name,
        language_code,
        image_url,
        template_variables,
        target_type,
        target_phone_numbers,
        target_user_ids,
        filter_tags,
        total_recipients: totalRecipients,
        status: campaignStatus,
        scheduled_at: scheduled_at || null,
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create campaign:', error);
      res.status(500).json({ error: 'Failed to create campaign' });
      return;
    }

    logger.info(`Campaign created: ${campaign.id} - ${name}`);

    res.status(201).json({
      success: true,
      campaign,
    });
  } catch (error) {
    logger.error('Error in createCampaign:', error);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
}

/**
 * Get campaign history for a business with pagination
 * Query params: page (default 1), limit (default 10), status (optional filter)
 */
export async function getCampaigns(req: Request, res: Response): Promise<void> {
  const businessId = getBusinessId(req);

  if (!businessId) {
    res.status(400).json({ error: 'Business ID not found' });
    return;
  }

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(
    100,
    Math.max(1, parseInt(req.query.limit as string) || 10)
  );
  const status = req.query.status as string;
  const offset = (page - 1) * limit;

  try {
    // Build query
    let query = supabase
      .from('campaigns')
      .select('*', { count: 'exact' })
      .eq('business_id', businessId);

    // Optional status filter
    if (
      status &&
      ['draft', 'scheduled', 'processing', 'sending', 'completed', 'failed', 'cancelled'].includes(status)
    ) {
      query = query.eq('status', status);
    }

    // Apply pagination and ordering
    const {
      data: campaigns,
      error,
      count,
    } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error('Failed to fetch campaigns:', error);
      res.status(500).json({ error: 'Failed to fetch campaigns' });
      return;
    }

    const totalPages = Math.ceil((count || 0) / limit);

    res.status(200).json({
      success: true,
      campaigns,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    logger.error('Error in getCampaigns:', error);
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
}

/**
 * Get single campaign details
 */
export async function getCampaign(req: Request, res: Response): Promise<void> {
  const businessId = getBusinessId(req);
  const { campaignId } = req.params;

  if (!businessId) {
    res.status(400).json({ error: 'Business ID not found' });
    return;
  }

  try {
    const { data: campaign, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .eq('business_id', businessId)
      .single();

    if (error || !campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    res.status(200).json({
      success: true,
      campaign,
    });
  } catch (error) {
    logger.error('Error in getCampaign:', error);
    res.status(500).json({ error: 'Failed to fetch campaign' });
  }
}

/**
 * Update a campaign (only draft or scheduled campaigns can be updated)
 */
export async function updateCampaign(
  req: Request,
  res: Response
): Promise<void> {
  const businessId = getBusinessId(req);
  const { campaignId } = req.params;

  if (!businessId) {
    res.status(400).json({ error: 'Business ID not found' });
    return;
  }

  const {
    name,
    description,
    template_name,
    language_code,
    image_url,
    template_variables,
    target_type,
    target_phone_numbers,
    target_user_ids,
    filter_tags,
    scheduled_at,
  } = req.body;

  try {
    // First check if campaign exists and is editable
    const { data: existing, error: fetchError } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .eq('business_id', businessId)
      .single();

    if (fetchError || !existing) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    // Only draft or scheduled campaigns can be updated
    if (!['draft', 'scheduled'].includes(existing.status)) {
      res.status(400).json({
        error: `Cannot update campaign with status '${existing.status}'. Only draft or scheduled campaigns can be updated.`,
      });
      return;
    }

    // Build update object with only provided fields
    const updateData: Record<string, any> = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (template_name !== undefined) updateData.template_name = template_name;
    if (language_code !== undefined) updateData.language_code = language_code;
    if (image_url !== undefined) updateData.image_url = image_url;
    if (template_variables !== undefined) updateData.template_variables = template_variables;
    if (target_type !== undefined) updateData.target_type = target_type;
    if (target_phone_numbers !== undefined) updateData.target_phone_numbers = target_phone_numbers;
    if (target_user_ids !== undefined) updateData.target_user_ids = target_user_ids;
    if (filter_tags !== undefined) updateData.filter_tags = filter_tags;

    // Handle scheduled_at changes
    if (scheduled_at !== undefined) {
      updateData.scheduled_at = scheduled_at;
      // If setting scheduled_at, status becomes scheduled; if clearing it, status becomes draft
      updateData.status = scheduled_at ? 'scheduled' : 'draft';
    }

    // Recalculate total_recipients if targeting changed
    if (target_phone_numbers !== undefined || target_user_ids !== undefined || target_type !== undefined) {
      let totalRecipients = 0;
      const phones = target_phone_numbers ?? existing.target_phone_numbers;
      const userIds = target_user_ids ?? existing.target_user_ids;

      if (phones?.length) {
        totalRecipients = phones.length;
      } else if (userIds?.length) {
        totalRecipients = userIds.length;
      } else {
        const { count } = await supabase
          .from('customers')
          .select('*', { count: 'exact', head: true })
          .eq('business_id', businessId);
        totalRecipients = count || 0;
      }
      updateData.total_recipients = totalRecipients;
    }

    const { data: campaign, error } = await supabase
      .from('campaigns')
      .update(updateData)
      .eq('id', campaignId)
      .eq('business_id', businessId)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update campaign:', error);
      res.status(500).json({ error: 'Failed to update campaign' });
      return;
    }

    logger.info(`Campaign updated: ${campaignId}`);

    res.status(200).json({
      success: true,
      campaign,
    });
  } catch (error) {
    logger.error('Error in updateCampaign:', error);
    res.status(500).json({ error: 'Failed to update campaign' });
  }
}

/**
 * Cancel a scheduled campaign
 */
export async function cancelCampaign(
  req: Request,
  res: Response
): Promise<void> {
  const businessId = getBusinessId(req);
  const { campaignId } = req.params;

  if (!businessId) {
    res.status(400).json({ error: 'Business ID not found' });
    return;
  }

  try {
    // Check if campaign exists and can be cancelled
    const { data: existing, error: fetchError } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .eq('business_id', businessId)
      .single();

    if (fetchError || !existing) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    // Only scheduled or draft campaigns can be cancelled
    if (!['draft', 'scheduled'].includes(existing.status)) {
      res.status(400).json({
        error: `Cannot cancel campaign with status '${existing.status}'. Only draft or scheduled campaigns can be cancelled.`,
      });
      return;
    }

    const { data: campaign, error } = await supabase
      .from('campaigns')
      .update({ status: 'cancelled' })
      .eq('id', campaignId)
      .eq('business_id', businessId)
      .select()
      .single();

    if (error) {
      logger.error('Failed to cancel campaign:', error);
      res.status(500).json({ error: 'Failed to cancel campaign' });
      return;
    }

    logger.info(`Campaign cancelled: ${campaignId}`);

    res.status(200).json({
      success: true,
      campaign,
    });
  } catch (error) {
    logger.error('Error in cancelCampaign:', error);
    res.status(500).json({ error: 'Failed to cancel campaign' });
  }
}

/**
 * Send a draft or scheduled campaign immediately
 */
export async function sendDraftCampaign(
  req: Request,
  res: Response
): Promise<void> {
  const businessId = getBusinessId(req);
  const { campaignId } = req.params;

  if (!businessId) {
    res.status(400).json({ error: 'Business ID not found' });
    return;
  }

  try {
    // Fetch campaign
    const { data: campaign, error: fetchError } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .eq('business_id', businessId)
      .single();

    if (fetchError || !campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    // Only draft or scheduled campaigns can be sent
    if (!['draft', 'scheduled'].includes(campaign.status)) {
      res.status(400).json({
        error: `Cannot send campaign with status '${campaign.status}'. Only draft or scheduled campaigns can be sent.`,
      });
      return;
    }

    if (!campaign.template_name) {
      res.status(400).json({ error: 'Campaign has no template configured' });
      return;
    }

    // Resolve target numbers
    let targetNumbers: string[] = [];

    if (campaign.target_phone_numbers?.length > 0) {
      targetNumbers = campaign.target_phone_numbers;
    } else if (campaign.target_user_ids?.length > 0) {
      const { data: customers, error } = await supabase
        .from('customers')
        .select('phone')
        .in('id', campaign.target_user_ids)
        .eq('business_id', businessId);

      if (error) throw error;
      targetNumbers = customers?.map((c) => c.phone) || [];
    } else {
      // All customers
      const { data: customers, error } = await supabase
        .from('customers')
        .select('phone')
        .eq('business_id', businessId);

      if (error) throw error;
      targetNumbers = customers?.map((c) => c.phone) || [];
    }

    if (targetNumbers.length === 0) {
      res.status(400).json({ error: 'No target customers found' });
      return;
    }

    // Build components from stored data
    const components: any[] = [];

    if (campaign.image_url) {
      components.push({
        type: 'header',
        parameters: [{ type: 'image', image: { link: campaign.image_url } }],
      });
    }

    if (campaign.template_variables?.body_params?.length > 0) {
      components.push({
        type: 'body',
        parameters: campaign.template_variables.body_params.map((text: string) => ({
          type: 'text',
          text,
        })),
      });
    }

    // Send validation message to first recipient
    const firstPhone = targetNumbers[0];
    const remainingNumbers = targetNumbers.slice(1);

    const template: TemplateMessage = {
      name: campaign.template_name,
      language: { code: campaign.language_code || 'en_US' },
      components,
    };

    try {
      await whatsappService.sendTemplate(firstPhone, template, businessId);
    } catch (error: any) {
      logger.error('Failed to send validation message:', error);
      const metaError = error.response?.data?.error?.message || error.message;
      res.status(400).json({
        error: 'Campaign validation failed. Template might be invalid.',
        details: metaError,
      });
      return;
    }

    // Update campaign status
    await supabase
      .from('campaigns')
      .update({
        status: remainingNumbers.length === 0 ? 'completed' : 'sending',
        started_at: new Date().toISOString(),
        total_recipients: targetNumbers.length,
        successful_sends: remainingNumbers.length === 0 ? 1 : 0,
        completed_at: remainingNumbers.length === 0 ? new Date().toISOString() : null,
      })
      .eq('id', campaignId);

    // Process remaining in background
    if (remainingNumbers.length > 0) {
      processCampaign(
        remainingNumbers,
        campaign.template_name,
        { code: campaign.language_code || 'en_US' },
        components,
        businessId,
        campaignId
      );
    }

    logger.info(`Campaign ${campaignId} send triggered. Recipients: ${targetNumbers.length}`);

    res.status(200).json({
      success: true,
      message: `Campaign started. Sending to ${targetNumbers.length} customers.`,
      campaign_id: campaignId,
    });
  } catch (error) {
    logger.error('Error in sendDraftCampaign:', error);
    res.status(500).json({ error: 'Failed to send campaign' });
  }
}

/**
 * Delete campaign image
 */
export async function deleteCampaignMedia(
  req: Request,
  res: Response
): Promise<void> {
  const businessId = getBusinessId(req);
  const { filePath } = req.body;

  if (!businessId) {
    res.status(400).json({ error: 'Business ID not found' });
    return;
  }

  if (!filePath) {
    res.status(400).json({ error: 'File path is required' });
    return;
  }

  try {
    const success = await deleteCampaignImage(filePath);

    if (!success) {
      res.status(500).json({ error: 'Failed to delete image' });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Image deleted successfully',
    });
  } catch (error) {
    logger.error('Error in deleteCampaignMedia:', error);
    res.status(500).json({ error: 'Failed to delete image' });
  }
}
