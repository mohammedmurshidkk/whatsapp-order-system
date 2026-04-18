import axios from 'axios';
import { Message, AIResponse, Session, Business, MenuItem, MenuCategory, BusinessOutlet, MenuAddon, BusinessAmenity } from '../types';
import { formatMessagesForAI } from './messageService';
import { logger } from '../utils/logger';
import { getAIClient } from './aiClient';
import { formatWeight } from '../utils/weightUtils';
import { trackAIUsage, AIProvider } from './usageService';
import { getPopularItemsForAI } from '../plugins/cake-cafe/services/popularItemsService';
import { aiPromptService } from './aiPromptService';

// Import system prompt from cake-cafe plugin
import { getSystemPrompt, PopularItem, FoodOrderingPromptContext } from '../plugins/cake-cafe/prompts/systemPrompt';

// Re-export PopularItem for backward compatibility
export type { PopularItem };

// AIContext is now an alias for the plugin's prompt context
export type AIContext = FoodOrderingPromptContext;

// NOTE: formatStrictMenuForAI and getSystemPrompt are now in the cake-cafe plugin
// See: src/plugins/cake-cafe/prompts/systemPrompt.ts

// REMOVED: Local formatStrictMenuForAI and getSystemPrompt functions
// These are now imported from the plugin above

function buildPrompt(
  currentMessage: string,
  conversationHistory: Message[],
  context: AIContext,
  systemPromptOverride?: string
): string {
  const historyText = formatMessagesForAI(conversationHistory);
  let prompt = systemPromptOverride ?? getSystemPrompt(context);

  if (historyText) {
    prompt += `\n\nConversation history:\n${historyText}`;
  }

  prompt += `\n\nCustomer: ${currentMessage}\n\nRespond with valid JSON only:`;

  return prompt;
}

function parseAIResponse(responseText: string): AIResponse {
  let jsonStr = responseText.trim();

  // Remove markdown code blocks
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.slice(7);
  }
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.slice(3);
  }
  if (jsonStr.endsWith('```')) {
    jsonStr = jsonStr.slice(0, -3);
  }

  jsonStr = jsonStr.trim();

  // ROBUST FIX: Extract only the first complete JSON object
  const firstBrace = jsonStr.indexOf('{');
  if (firstBrace !== -1) {
    let braceCount = 0;
    let endIndex = -1;
    for (let i = firstBrace; i < jsonStr.length; i++) {
      if (jsonStr[i] === '{') braceCount++;
      else if (jsonStr[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          endIndex = i;
          break;
        }
      }
    }
    if (endIndex !== -1) {
      jsonStr = jsonStr.substring(firstBrace, endIndex + 1);
    }
  }

  try {
    const parsed = JSON.parse(jsonStr);

    if (!parsed.reply || !parsed.intent) {
      throw new Error('Missing required fields');
    }

    return {
      reply: parsed.reply,
      intent: parsed.intent,
      item: parsed.item,
      items: parsed.items,
      order_id: parsed.order_id,
      fulfillment: parsed.fulfillment,
      addon: parsed.addon,
      customText: parsed.customText,
      amenity: parsed.amenity,
      photoRequest: parsed.photoRequest,
      analysis: parsed.analysis,
    };
  } catch (error) {
    logger.warn('Failed to parse AI response as JSON', { error, responseText });
    throw new Error('AI_PARSE_ERROR');
  }
}

// Calculate Levenshtein distance for fuzzy matching
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

// Normalize item name - handle plurals, common variations
function normalizeItemName(name: string): string {
  let normalized = name.toLowerCase().trim();

  // Remove common plurals (s, es, ies -> y)
  if (normalized.endsWith('ies')) {
    normalized = normalized.slice(0, -3) + 'y';
  } else if (normalized.endsWith('es')) {
    normalized = normalized.slice(0, -2);
  } else if (normalized.endsWith('s') && !normalized.endsWith('ss')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

// Validate that item name exists in menu with fuzzy matching
export function validateItemAgainstMenu(
  itemName: string,
  menuItems: MenuItem[]
): MenuItem | null {
  if (!itemName || !menuItems || menuItems.length === 0) {
    return null;
  }

  const normalizedInput = normalizeItemName(itemName);

  // 1. Exact match first
  let found = menuItems.find(
    item => item.name.toLowerCase() === normalizedInput
  );

  if (found) return found;

  // 2. Normalized match (handles plurals like "burgers" -> "burger")
  found = menuItems.find(
    item => normalizeItemName(item.name) === normalizedInput
  );

  if (found) return found;

  // 3. Partial/substring match
  found = menuItems.find(
    item =>
      item.name.toLowerCase().includes(normalizedInput) ||
      normalizedInput.includes(item.name.toLowerCase())
  );

  if (found) return found;

  // 4. Fuzzy match using Levenshtein distance
  const maxDistance = normalizedInput.length <= 5 ? 2 : 3;
  let bestMatch: MenuItem | null = null;
  let bestDistance = Infinity;

  for (const item of menuItems) {
    const itemNormalized = normalizeItemName(item.name);
    const distance = levenshteinDistance(normalizedInput, itemNormalized);

    if (distance < bestDistance && distance <= maxDistance) {
      bestDistance = distance;
      bestMatch = item;
    }
  }

  return bestMatch;
}

// Validate size exists for item OR is valid custom weight
export function validateSizeForItem(
  size: string,
  menuItem: MenuItem,
  category?: MenuCategory | null
): boolean {
  if (!size) {
    return true; // No size to validate
  }

  // Check for exact size match first
  if (menuItem.sizes && menuItem.sizes.length > 0) {
    const normalizedSize = size.toLowerCase().trim();
    const exactMatch = menuItem.sizes.some(
      s => s.name.toLowerCase() === normalizedSize
    );
    if (exactMatch) {
      return true;
    }
  }

  // Check if custom weight is allowed
  if (category?.allows_custom_weight) {
    const { parseWeight, validateMinWeight } = require('../utils/weightUtils');
    const parsed = parseWeight(size);
    if (parsed.isValid) {
      const minGrams = category.custom_weight_min_grams || 500;
      const validation = validateMinWeight(parsed.grams, minGrams);
      return validation.isValid;
    }
  }

  if (!menuItem.sizes || menuItem.sizes.length === 0) {
    return true;
  }

  return false;
}

// Extract size from message
export function extractSizeFromMessage(
  message: string,
  menuItem: MenuItem
): { size: string | null; cleanedMessage: string } {
  if (!menuItem.sizes || menuItem.sizes.length === 0) {
    return { size: null, cleanedMessage: message };
  }

  const normalizedMessage = message.toLowerCase().trim();

  for (const sizeOption of menuItem.sizes) {
    const sizeName = sizeOption.name.toLowerCase();
    const sizePatterns = [
      new RegExp(`\\b${sizeName}\\b`, 'i'),
      new RegExp(`\\b${sizeName.replace(/(\d+)/, '$1\\s*')}\\b`, 'i'),
    ];

    for (const pattern of sizePatterns) {
      if (pattern.test(normalizedMessage)) {
        const cleanedMessage = message.replace(pattern, '').trim();
        return { size: sizeOption.name, cleanedMessage };
      }
    }
  }

  return { size: null, cleanedMessage: message };
}

export interface CustomTextClassification {
  isValidText: boolean;
  cleanedText: string | null;
  isQuestion: boolean;
  isAffirmation: boolean;
}

export async function classifyCustomTextResponse(
  userResponse: string,
  customTextPrompt: string
): Promise<CustomTextClassification> {
  const classificationPrompt = `You are classifying a customer's response to a prompt asking for text to write on a cake/item.

PROMPT ASKED TO CUSTOMER: "${customTextPrompt}"
CUSTOMER'S RESPONSE: "${userResponse}"

Classify the response:
1. VALID_TEXT: Customer provided text to write (even with "yes"/"ok" prefix, or in Malayalam/other languages)
2. QUESTION: Customer is asking a question (price, availability, "how much", "rate ethra", etc.)
3. AFFIRMATION: Customer said just "yes"/"yeah"/"ok"/"sure"/"athe"/"sheri" alone - meaning they WANT to provide text but haven't given it yet
4. SKIP: Customer wants to skip (no, nothing, skip, none, venda, etc.)

If VALID_TEXT: Extract ONLY the text to write on cake
If QUESTION, AFFIRMATION, or SKIP: cleanedText should be null

Respond with JSON only:
{"isValidText": boolean, "cleanedText": "string or null", "isQuestion": boolean, "isAffirmation": boolean}`;

  try {
    const aiClient = getAIClient();
    const responseText = await aiClient.processMessage(classificationPrompt);

    if (!responseText) {
      logger.warn('Empty response from AI for custom text classification');
      return { isValidText: true, cleanedText: userResponse, isQuestion: false, isAffirmation: false };
    }

    let jsonStr = responseText.trim();
    if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
    if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
    jsonStr = jsonStr.trim();

    const parsed = JSON.parse(jsonStr);
    logger.info(`Custom text classification: "${userResponse}" → valid=${parsed.isValidText}, question=${parsed.isQuestion}, affirmation=${parsed.isAffirmation}, cleaned="${parsed.cleanedText}"`);

    return {
      isValidText: parsed.isValidText === true,
      cleanedText: parsed.cleanedText || null,
      isQuestion: parsed.isQuestion === true,
      isAffirmation: parsed.isAffirmation === true,
    };
  } catch (error) {
    logger.error('Failed to classify custom text response', { error, userResponse });
    const affirmationOnly = /^(yes|yeah|yep|yup|ok|okay|sure|athe|ath|sheri)$/i.test(userResponse.trim());
    if (affirmationOnly) {
      return { isValidText: false, cleanedText: null, isQuestion: false, isAffirmation: true };
    }
    let cleaned = userResponse;
    cleaned = cleaned.replace(/^(yes|yeah|yep|yup|ok|okay|sure|athe|ath|sheri)[,.\s]+/i, '').trim();
    return { isValidText: true, cleanedText: cleaned, isQuestion: false, isAffirmation: false };
  }
}

export async function processMessageWithAI(
  currentMessage: string,
  conversationHistory: Message[],
  _sessionContext: Session,
  context: AIContext = {},
  systemPromptOverride?: string
): Promise<AIResponse> {
  if (context.business) {
    const popularItems = await getPopularItemsForAI(context.business.id);
    if (popularItems && popularItems.length > 0) {
      context.popularItems = popularItems;
    }

    // Fetch dynamic AI templates
    const [greeting, farewell] = await Promise.all([
      aiPromptService.getEffectiveTemplate(context.business.id, 'greeting'),
      aiPromptService.getEffectiveTemplate(context.business.id, 'farewell')
    ]);

    if (greeting) context.aiGreetingTemplate = aiPromptService.renderTemplate(greeting, { business_name: context.business.name });
    if (farewell) context.aiFarewellTemplate = aiPromptService.renderTemplate(farewell, { business_name: context.business.name });
  }

  const prompt = buildPrompt(currentMessage, conversationHistory, context, systemPromptOverride);

  const MAX_PARSE_RETRIES = 2;
  const aiClient = getAIClient();

  for (let attempt = 0; attempt <= MAX_PARSE_RETRIES; attempt++) {
    try {
      const result = await aiClient.processMessageWithUsage(prompt);

      if (context.business?.id) {
        trackAIUsage({
          businessId: context.business.id,
          provider: aiClient.getProvider() as AIProvider,
          tokensInput: result.usage.inputTokens,
          tokensOutput: result.usage.outputTokens,
          latencyMs: result.usage.latencyMs,
          success: !!result.text,
          errorMessage: result.text ? undefined : 'Empty AI response',
        }).catch(err => logger.warn('Failed to track AI usage', err));
      }

      const responseText = result.text;
      if (!responseText) {
        logger.error('Empty response from AI provider');
        throw new Error('Empty AI response');
      }

      logger.debug('AI raw response', responseText);
      let aiResponse = parseAIResponse(responseText);

      // VALIDATION: If AI tries to add an item, verify it exists in menu
      if (aiResponse.intent === 'add_item' && aiResponse.item?.name && context.menuItems) {
        const validItem = validateItemAgainstMenu(aiResponse.item.name, context.menuItems);

        if (!validItem) {
          logger.warn(`AI tried to add non-menu item: ${aiResponse.item.name}`);
          const availableItems = context.menuItems.map(i => i.name).slice(0, 5).join(', ');
          aiResponse = {
            reply: `Sorry, "${aiResponse.item.name}" is not on our menu. We have: ${availableItems}. What would you like?`,
            intent: 'item_not_available' as any,
          };
        } else {
          aiResponse.item.name = validItem.name;

          if (!aiResponse.item.size_or_weight && validItem.sizes && validItem.sizes.length > 0) {
            const { size } = extractSizeFromMessage(currentMessage, validItem);
            if (size) {
              logger.info(`Extracted size from message: ${size}`);
              aiResponse.item.size_or_weight = size;
            }
          }

          const itemCategory = context.menuCategories?.find(c => c.id === validItem.category_id);
          if (aiResponse.item.size_or_weight && !validateSizeForItem(aiResponse.item.size_or_weight, validItem, itemCategory)) {
            let availableSizes = validItem.sizes?.map(s => s.name).join(', ') || 'standard';
            if (itemCategory?.allows_custom_weight) {
              const minGrams = itemCategory.custom_weight_min_grams || 500;
              availableSizes += ` (or custom weight from ${formatWeight(minGrams)})`;
            }
            aiResponse = {
              reply: `Sorry, we don't have that size for ${validItem.name}. Available: ${availableSizes}. Which would you like?`,
              intent: 'ask_question',
              item: { ...aiResponse.item, size_or_weight: undefined },
            };
          }
        }
      }

      // FALLBACK: If AI is asking for size but size was in the original message
      if (aiResponse.intent === 'ask_question' && aiResponse.item?.name && context.menuItems) {
        const validItem = validateItemAgainstMenu(aiResponse.item.name, context.menuItems);
        if (validItem && validItem.sizes && validItem.sizes.length > 0) {
          const { size } = extractSizeFromMessage(currentMessage, validItem);
          if (size) {
            logger.info(`AI asked for size but it was in message. Converting to add_item with size: ${size}`);
            aiResponse = {
              reply: `Added ${validItem.name} (${size}) to your cart! Anything else?`,
              intent: 'add_item',
              item: {
                name: validItem.name,
                quantity: aiResponse.item.quantity || 1,
                size_or_weight: size,
              },
            };
          }
        }
      }

      logger.info(`AI Intent: ${aiResponse.intent}`);
      return aiResponse;

    } catch (error: any) {
      if (error.message === 'AI_PARSE_ERROR' && attempt < MAX_PARSE_RETRIES) {
        logger.warn(`AI response parse failed. Retry ${attempt + 1}/${MAX_PARSE_RETRIES}...`);
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      if (error.message === 'AI_PARSE_ERROR') {
        logger.error('AI parse error after all retries');
        return {
          reply: "I didn't quite understand that. Could you please rephrase? For example: 'I want a chocolate cake' or 'Show me the menu'.",
          intent: 'ask_question',
        };
      }

      logger.error('Error processing message with AI', { error });
      let errorReply = "We're experiencing a temporary issue processing your request. Please try again in a moment.";
      if (context.business?.customer_support_phone) {
        errorReply += `\n\n📞 Need immediate assistance? Contact us: ${context.business.customer_support_phone}`;
      }
      errorReply += "\n\n_Tip: You can continue ordering by telling us what you'd like._";

      return {
        reply: errorReply,
        intent: 'ask_question',
      };
    }
  }

  return {
    reply: "I didn't quite understand that. Could you please rephrase?",
    intent: 'ask_question',
  };
}

// ============================================
// IMAGE CLASSIFICATION (Gemini Vision)
// ============================================

export type ImageClassification =
  | 'cake_design'
  | 'menu_screenshot'
  | 'food_photo'
  | 'other';

export interface ImageClassificationResult {
  classification: ImageClassification;
  confidence: number;
  isCake: boolean;
  detectedItemName?: string;
  reasoning: string;
}

export async function classifyImageWithGemini(
  imageBase64: string,
  mimeType: string,
  menuItemNames?: string[]
): Promise<ImageClassificationResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.error('GEMINI_API_KEY not configured for image classification');
    return {
      classification: 'other',
      confidence: 0,
      isCake: false,
      reasoning: 'API key not configured',
    };
  }

  const menuContext = menuItemNames && menuItemNames.length > 0
    ? `\n\nMENU ITEMS (for matching screenshots): ${menuItemNames.join(', ')}`
    : '';

  const prompt = `You are an image classifier for a bakery/cafe ordering system. Analyze this image and classify it.

CLASSIFICATION TYPES:
1. "cake_design" - A photo of a cake, cake design, or reference image for custom cake order
2. "menu_screenshot" - A screenshot of a menu, price list, or specific menu item
3. "food_photo" - Other food photos (not cakes)
4. "other" - Non-food related images
${menuContext}

IMPORTANT RULES:
- If the image shows ANY type of cake, classify as "cake_design"
- Be generous with "cake_design" - if it looks like a cake reference, it probably is
- For menu screenshots, try to identify the item name if visible

Respond with JSON only (no markdown):
{"classification": "cake_design|menu_screenshot|food_photo|other", "confidence": 0.0-1.0, "isCake": true/false, "detectedItemName": "item name if menu screenshot", "reasoning": "brief explanation"}`;

  try {
    const { GEMINI_MODEL_NAME } = await import('../config/constants');

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
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 500,
        },
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      }
    );

    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      logger.warn('Empty response from Gemini for image classification');
      return {
        classification: 'other',
        confidence: 0.5,
        isCake: false,
        reasoning: 'Empty API response',
      };
    }

    let jsonStr = text.trim();
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();

    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
    }

    const parsed = JSON.parse(jsonStr);

    const result: ImageClassificationResult = {
      classification: parsed.classification || 'other',
      confidence: parsed.confidence || 0.5,
      isCake: parsed.isCake === true || parsed.classification === 'cake_design',
      detectedItemName: parsed.detectedItemName,
      reasoning: parsed.reasoning || 'No reasoning provided',
    };

    logger.info(`Image classified: ${result.classification} (${Math.round(result.confidence * 100)}% confidence) - ${result.reasoning}`);
    return result;

  } catch (error: any) {
    logger.error('Failed to classify image with Gemini', error);
    return {
      classification: 'other',
      confidence: 0.3,
      isCake: false,
      reasoning: `Classification failed: ${error.message}`,
    };
  }
}

