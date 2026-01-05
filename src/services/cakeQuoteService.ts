import axios from 'axios';
import { supabase } from '../config/database';
import { GEMINI_MODEL_NAME } from '../config/constants';
import {
  CakePriceQuote,
  CakePriceQuoteWithCustomer,
  CakeAIAnalysis,
  CakePriceQuoteStatus,
} from '../types';
import { logger } from '../utils/logger';
import {
  getFullPricingConfig,
  formatPricingConfigForAI,
  CakePricingConfig,
  findFlavorWeightPrice,
  parseWeightFromString,
} from './cakePricingService';
import { downloadWhatsAppMedia, storeMediaInSupabase } from './mediaService';
import { notifyBusinessAdmin } from './notificationService';

// ============================================
// GEMINI VISION API FOR IMAGE ANALYSIS
// ============================================

async function analyzeImageWithGemini(
  imageBase64: string,
  mimeType: string,
  pricingConfig: CakePricingConfig,
  customerWeight?: string,
  customerFlavor?: string
): Promise<CakeAIAnalysis | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const pricingText = formatPricingConfigForAI(pricingConfig);

  // Build available elements list
  const elementsText = pricingConfig.designElements
    .map(e => `- ${e.element_key}: "${e.element_label}" (₹${e.price} ${e.price_type === 'per_unit' ? 'per unit' : 'fixed'})`)
    .join('\n');

  // Build available flavors list
  const flavorsText = pricingConfig.flavorsGrouped
    .map(f => {
      const prices = f.weights.map(w => `${w.weight_grams}g: ₹${w.base_price}`).join(', ');
      return `- ${f.flavor_name}: ${prices}`;
    })
    .join('\n');

  // Determine base price from customer specifications or defaults
  let basePriceInfo = '';
  if (customerFlavor && customerWeight) {
    const weightGrams = parseWeightFromString(customerWeight);
    if (weightGrams) {
      const priceResult = findFlavorWeightPrice(customerFlavor, weightGrams, pricingConfig.flavors);
      if (priceResult) {
        basePriceInfo = `\nBase price for ${customerFlavor} ${customerWeight}: ₹${priceResult.price}${priceResult.isCalculated ? ' (calculated)' : ''}`;
      }
    }
  }

  const prompt = `You are a cake pricing assistant for a bakery. Analyze the cake image and identify design elements to calculate pricing.

${pricingText}

## Available Flavors with Pricing:
${flavorsText || 'No flavor pricing configured.'}
${basePriceInfo}

## Available Design Elements to Detect:
${elementsText || 'No elements configured - estimate based on complexity.'}

## Customer Information:
- Requested weight: ${customerWeight || 'not specified (use 1kg default)'}
- Requested flavor: ${customerFlavor || 'not specified (use first available or cheapest)'}

## Your Task:
1. Analyze the cake image carefully
2. Identify all visible design elements from the available list
3. Count quantities where applicable (letters, tiers, decorative pieces)
4. Assess overall complexity level
5. Calculate total price: base_price (flavor+weight) + design_elements

## Price Calculation Rules:
- base_price = price from flavor+weight combination
- For custom weights (2kg, 3kg): calculate from 1kg price (e.g., 2kg = 1kg price × 2)
- design_elements_total = sum of all detected element prices
- grand_total = base_price + design_elements_total

## Response Format (JSON only, no markdown):
{
  "detected_elements": [
    {
      "element_key": "string (from available elements)",
      "element_label": "string",
      "quantity": number,
      "confidence": number (0.0-1.0),
      "unit_price": number,
      "total_price": number,
      "notes": "string (optional observation)"
    }
  ],
  "detected_flavor": "string (flavor identified or suggested)",
  "detected_weight_grams": number,
  "tier_count": number,
  "complexity_level": "simple|moderate|elaborate|premium",
  "complexity_reasoning": "string explaining why",
  "price_breakdown": {
    "base_price": number (flavor+weight price),
    "design_elements_total": number,
    "grand_total": number
  },
  "confidence_score": number (0.0-1.0),
  "suggested_message": "string (friendly message to customer with price breakdown)",
  "warnings": ["string (any concerns)"]
}

## Important Rules:
- Only identify elements you can clearly see
- If unsure about an element, use lower confidence score
- If weight not specified, use 1kg (1000g) as default
- If flavor not specified, use the first available flavor from the list
- base_price already includes the flavor - no separate flavor_addition needed
- Be conservative with pricing
- The suggested_message should be warm, professional, and include itemized breakdown
- Return ONLY valid JSON, no markdown code blocks`;

  // Retry logic for rate limit (429) errors
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_NAME}:generateContent?key=${apiKey}`,
        {
          contents: [
            {
              parts: [
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: imageBase64,
                  },
                },
                {
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8192,
          },
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 60000,
        }
      );

      const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        logger.error('Gemini returned empty response for image analysis');
        return null;
      }

      // Log full response for debugging
      logger.info('Gemini response length:', text.length);
      logger.info('Gemini raw response:', text.substring(0, 2000));
      if (text.length > 2000) {
        logger.info('Gemini response end:', text.substring(text.length - 500));
      }

      // Parse JSON from response - try multiple strategies
      let analysis: CakeAIAnalysis | null = null;
      let parseError: Error | null = null;

      // Strategy 1: Clean markdown and parse directly
      let jsonStr = text.trim();
      // Remove markdown code blocks (handle ```json or ``` at start/end)
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();

      try {
        analysis = JSON.parse(jsonStr) as CakeAIAnalysis;
        logger.info('Strategy 1 succeeded');
      } catch (e) {
        parseError = e as Error;
        logger.info('Strategy 1 failed:', (e as Error).message);
      }

      // Strategy 2: Find first { and last } (simple extraction)
      if (!analysis) {
        const startIdx = text.indexOf('{');
        const endIdx = text.lastIndexOf('}');
        if (startIdx !== -1 && endIdx > startIdx) {
          const extracted = text.substring(startIdx, endIdx + 1);
          logger.info(`Strategy 2 - Extracted from ${startIdx} to ${endIdx}, length: ${extracted.length}`);
          try {
            analysis = JSON.parse(extracted) as CakeAIAnalysis;
            logger.info('Strategy 2 succeeded');
          } catch (e) {
            parseError = e as Error;
            logger.error('Strategy 2 failed: ' + (e as Error).message);
          }
        } else {
          logger.error(`Strategy 2: No valid JSON boundaries found, startIdx: ${startIdx}, endIdx: ${endIdx}`);
        }
      }

      if (!analysis) {
        logger.error('All JSON parsing strategies failed. Full response:', text);
        throw parseError || new Error('Failed to parse Gemini response');
      }

      logger.info('Cake image analysis completed', {
        elements: analysis.detected_elements?.length || 0,
        total: analysis.price_breakdown?.grand_total || 0,
        confidence: analysis.confidence_score || 0,
      });

      return analysis;
    } catch (error: any) {
      lastError = error;

      // Check if it's a rate limit error (429)
      if (error.response?.status === 429 && attempt < maxRetries) {
        // Try to extract retry delay from error message (e.g., "Please retry in 39.621233397s")
        const retryMatch = error.response?.data?.error?.message?.match(/retry in ([\d.]+)s/);
        const suggestedWait = retryMatch ? Math.ceil(parseFloat(retryMatch[1]) * 1000) : null;
        const waitTime = suggestedWait || Math.pow(2, attempt) * 10000; // Use suggested or 10s, 20s, 40s

        logger.warn(`Gemini quota/rate limit hit, retrying in ${Math.round(waitTime / 1000)}s (attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      // For non-429 errors or final attempt, break out
      break;
    }
  }

  // All retries failed
  logger.error('Failed to analyze image with Gemini after retries', lastError);
  return null;
}

// ============================================
// QUOTE CRUD OPERATIONS
// ============================================

export async function createCakeQuote(
  businessId: string,
  sessionId: string,
  customerId: string,
  imageUrl: string,
  aiAnalysis: CakeAIAnalysis | null,
  customerWeight?: string,
  customerFlavor?: string,
  expiryHours: number = 24
): Promise<CakePriceQuote> {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + expiryHours);

  const { data, error } = await supabase
    .from('cake_price_quotes')
    .insert({
      business_id: businessId,
      session_id: sessionId,
      customer_id: customerId,
      image_url: imageUrl,
      customer_weight: customerWeight,
      customer_flavor: customerFlavor,
      ai_analysis: aiAnalysis,
      suggested_price: aiAnalysis?.price_breakdown.grand_total || null,
      suggested_message: aiAnalysis?.suggested_message || null,
      status: 'pending',
      created_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create cake quote', error);
    throw new Error('Failed to create cake quote');
  }

  return data as CakePriceQuote;
}

export async function getCakeQuoteById(id: string): Promise<CakePriceQuoteWithCustomer | null> {
  const { data, error } = await supabase
    .from('cake_price_quotes')
    .select(`
      *,
      customer:customers(id, name, phone)
    `)
    .eq('id', id)
    .single();

  if (error || !data) {
    return null;
  }

  return data as CakePriceQuoteWithCustomer;
}

export async function getCakeQuotesByBusiness(
  businessId: string,
  status?: CakePriceQuoteStatus,
  page: number = 1,
  limit: number = 20
): Promise<{ quotes: CakePriceQuoteWithCustomer[]; total: number }> {
  let query = supabase
    .from('cake_price_quotes')
    .select(`
      *,
      customer:customers(id, name, phone)
    `, { count: 'exact' })
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }

  const offset = (page - 1) * limit;
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    logger.error('Failed to fetch cake quotes', error);
    return { quotes: [], total: 0 };
  }

  return {
    quotes: (data || []) as CakePriceQuoteWithCustomer[],
    total: count || 0,
  };
}

export async function getPendingQuoteForSession(sessionId: string): Promise<CakePriceQuote | null> {
  const { data, error } = await supabase
    .from('cake_price_quotes')
    .select('*')
    .eq('session_id', sessionId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  return data as CakePriceQuote;
}

export async function updateQuoteStatus(
  quoteId: string,
  status: CakePriceQuoteStatus,
  adminId?: string,
  finalMessage?: string,
  finalPrice?: number
): Promise<CakePriceQuote | null> {
  const updates: Record<string, unknown> = { status };

  if (status === 'sent' || status === 'cancelled') {
    updates.reviewed_at = new Date().toISOString();
    if (adminId) {
      updates.reviewed_by = adminId;
    }
  }

  if (finalMessage !== undefined) {
    updates.admin_final_message = finalMessage;
  }

  if (finalPrice !== undefined) {
    updates.admin_final_price = finalPrice;
  }

  const { data, error } = await supabase
    .from('cake_price_quotes')
    .update(updates)
    .eq('id', quoteId)
    .select()
    .single();

  if (error) {
    logger.error('Failed to update quote status', error);
    return null;
  }

  return data as CakePriceQuote;
}

export async function markQuoteAsSent(
  quoteId: string,
  adminId: string,
  finalMessage?: string,
  finalPrice?: number
): Promise<CakePriceQuote | null> {
  return updateQuoteStatus(quoteId, 'sent', adminId, finalMessage, finalPrice);
}

export async function cancelQuote(quoteId: string, adminId?: string): Promise<CakePriceQuote | null> {
  return updateQuoteStatus(quoteId, 'cancelled', adminId);
}

/**
 * Get the most recent 'sent' quote for a session (customer needs to accept)
 */
export async function getSentQuoteForSession(sessionId: string): Promise<CakePriceQuote | null> {
  const { data, error } = await supabase
    .from('cake_price_quotes')
    .select('*')
    .eq('session_id', sessionId)
    .eq('status', 'sent')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  return data as CakePriceQuote;
}

/**
 * Mark a quote as accepted by customer
 */
export async function markQuoteAsAccepted(quoteId: string): Promise<CakePriceQuote | null> {
  const { data, error } = await supabase
    .from('cake_price_quotes')
    .update({
      status: 'accepted',
      accepted_at: new Date().toISOString(),
    })
    .eq('id', quoteId)
    .select()
    .single();

  if (error) {
    logger.error('Failed to mark quote as accepted', error);
    return null;
  }

  logger.info(`Cake quote accepted: ${quoteId}`);
  return data as CakePriceQuote;
}

/**
 * Get accepted quote for session (for time confirmation flow)
 */
export async function getAcceptedQuoteForSession(sessionId: string): Promise<CakePriceQuote | null> {
  const { data, error } = await supabase
    .from('cake_price_quotes')
    .select('*')
    .eq('session_id', sessionId)
    .eq('status', 'accepted')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  return data as CakePriceQuote;
}

/**
 * Update quote with requested delivery/pickup time (pending admin confirmation)
 */
export async function updateQuoteTimeRequest(
  quoteId: string,
  requestedTime: string,
  fulfillmentType: 'delivery' | 'takeaway'
): Promise<CakePriceQuote | null> {
  const { data, error } = await supabase
    .from('cake_price_quotes')
    .update({
      requested_delivery_time: requestedTime,
      requested_fulfillment_type: fulfillmentType,
      time_confirmed: false,
    })
    .eq('id', quoteId)
    .select()
    .single();

  if (error) {
    logger.error('Failed to update quote time request', error);
    return null;
  }

  logger.info(`Time request saved for quote ${quoteId}: ${requestedTime}`);
  return data as CakePriceQuote;
}

/**
 * Admin confirms the requested time
 */
export async function confirmQuoteTime(quoteId: string): Promise<CakePriceQuote | null> {
  const { data, error } = await supabase
    .from('cake_price_quotes')
    .update({
      time_confirmed: true,
      time_confirmed_at: new Date().toISOString(),
    })
    .eq('id', quoteId)
    .select()
    .single();

  if (error) {
    logger.error('Failed to confirm quote time', error);
    return null;
  }

  logger.info(`Time confirmed for quote: ${quoteId}`);
  return data as CakePriceQuote;
}

/**
 * Create a revision quote when customer requests weight/design change
 * Reuses the existing quote's image but with new weight, status = pending
 */
export async function createQuoteRevision(
  existingQuote: CakePriceQuote,
  newWeight: string,
  _revisionNote?: string
): Promise<CakePriceQuote> {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);

  const { data, error } = await supabase
    .from('cake_price_quotes')
    .insert({
      business_id: existingQuote.business_id,
      session_id: existingQuote.session_id,
      customer_id: existingQuote.customer_id,
      image_url: existingQuote.image_url,
      customer_weight: newWeight,
      customer_flavor: existingQuote.customer_flavor,
      ai_analysis: existingQuote.ai_analysis, // Keep elements from original quote
      suggested_price: null,
      suggested_message: null,
      status: 'pending',
      created_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create quote revision', error);
    throw new Error('Failed to create quote revision');
  }

  logger.info(`Quote revision created: ${data.id} (from ${existingQuote.id}, new weight: ${newWeight})`);
  return data as CakePriceQuote;
}

export async function expireOldQuotes(): Promise<number> {
  const { data, error } = await supabase
    .from('cake_price_quotes')
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString())
    .select('id');

  if (error) {
    logger.error('Failed to expire old quotes', error);
    return 0;
  }

  const count = data?.length || 0;
  if (count > 0) {
    logger.info(`Expired ${count} old cake quotes`);
  }
  return count;
}

// ============================================
// PROCESS CAKE IMAGE (MAIN ENTRY POINT)
// ============================================

export async function processCakeImage(
  businessId: string,
  sessionId: string,
  customerId: string,
  customerPhone: string,
  mediaId: string,
  mimeType: string,
  accessToken?: string,
  customerWeight?: string,
  customerFlavor?: string
): Promise<{
  success: boolean;
  quote?: CakePriceQuote;
  holdingMessage: string;
  error?: string;
}> {
  try {
    // 1. Check if custom cake pricing is enabled for this business
    const { data: business } = await supabase
      .from('businesses')
      .select('custom_cake_enabled, custom_cake_auto_send, custom_cake_quote_expiry_hours')
      .eq('id', businessId)
      .single();

    if (!business?.custom_cake_enabled) {
      return {
        success: false,
        holdingMessage: '',
        error: 'Custom cake pricing not enabled for this business',
      };
    }

    // 2. Download image from WhatsApp
    logger.info(`Downloading cake image: ${mediaId}`);
    const { buffer, mimeType: actualMimeType } = await downloadWhatsAppMedia(mediaId, accessToken);

    // 3. Store in Supabase
    const { publicUrl } = await storeMediaInSupabase(buffer, actualMimeType, businessId, mediaId);
    logger.info(`Cake image stored: ${publicUrl}`);

    // 4. Get business pricing config
    const pricingConfig = await getFullPricingConfig(businessId);

    // 5. Analyze image with Gemini
    const imageBase64 = buffer.toString('base64');
    const aiAnalysis = await analyzeImageWithGemini(
      imageBase64,
      actualMimeType,
      pricingConfig,
      customerWeight,
      customerFlavor
    );

    // 6. Create quote record
    const expiryHours = business.custom_cake_quote_expiry_hours || 24;
    const quote = await createCakeQuote(
      businessId,
      sessionId,
      customerId,
      publicUrl,
      aiAnalysis,
      customerWeight,
      customerFlavor,
      expiryHours
    );

    // 7. Create notification for admin
    await notifyBusinessAdmin(businessId, {
      type: 'cake_quote_ready',
      customerId,
      phone: customerPhone,
      message: `Custom cake quote ready for review (₹${aiAnalysis?.price_breakdown.grand_total || 'N/A'})`,
    });

    // 8. Check if auto-send is enabled
    if (business.custom_cake_auto_send && aiAnalysis) {
      // Auto-send the quote to customer
      return {
        success: true,
        quote,
        holdingMessage: aiAnalysis.suggested_message,
      };
    }

    // 9. Return holding message (quote pending admin approval)
    const holdingMessage = `Thank you for sharing your cake design! 🎂\n\nOur team is preparing a customized quote for you. You'll receive it shortly.`;

    return {
      success: true,
      quote,
      holdingMessage,
    };
  } catch (error) {
    logger.error('Failed to process cake image', error);
    return {
      success: false,
      holdingMessage: 'Sorry, we had trouble processing your image. Please try again or describe your cake design.',
      error: (error as Error).message,
    };
  }
}

// ============================================
// GET QUOTE SUMMARY FOR ADMIN
// ============================================

export function formatQuoteSummaryForAdmin(quote: CakePriceQuoteWithCustomer): string {
  const analysis = quote.ai_analysis;
  if (!analysis) {
    return 'AI analysis not available for this quote.';
  }

  let summary = `**Customer:** ${quote.customer?.name || quote.customer?.phone || 'Unknown'}\n`;
  summary += `**Flavor:** ${analysis.detected_flavor || quote.customer_flavor || 'Not specified'}\n`;
  summary += `**Weight:** ${analysis.detected_weight_grams ? `${analysis.detected_weight_grams}g` : quote.customer_weight || 'Not specified'}\n\n`;

  summary += `**Detected Elements:**\n`;
  if (analysis.detected_elements.length === 0) {
    summary += `_No design elements detected_\n`;
  } else {
    analysis.detected_elements.forEach(e => {
      summary += `- ${e.element_label}: ${e.quantity}x @ ₹${e.unit_price} = ₹${e.total_price} (${Math.round(e.confidence * 100)}% conf)\n`;
    });
  }

  summary += `\n**Complexity:** ${analysis.complexity_level}\n`;
  summary += `_${analysis.complexity_reasoning}_\n\n`;

  summary += `**Price Breakdown:**\n`;
  summary += `- Base (${analysis.detected_flavor || 'flavor'} + ${analysis.detected_weight_grams ? `${analysis.detected_weight_grams}g` : 'weight'}): ₹${analysis.price_breakdown.base_price}\n`;
  summary += `- Design Elements: ₹${analysis.price_breakdown.design_elements_total}\n`;
  summary += `- **Total: ₹${analysis.price_breakdown.grand_total}**\n\n`;

  summary += `**Confidence:** ${Math.round(analysis.confidence_score * 100)}%\n`;

  if (analysis.warnings && analysis.warnings.length > 0) {
    summary += `\n**Warnings:**\n`;
    analysis.warnings.forEach(w => {
      summary += `- ${w}\n`;
    });
  }

  return summary;
}
