/**
 * Speech-to-Text Service using Google Gemini AI
 * Converts voice messages to text for processing
 *
 * Uses Gemini's multimodal capabilities for audio transcription
 * Supports: English, Malayalam, and mixed (Manglish)
 */

import axios from 'axios';
import { logger } from '../utils/logger';
import { GEMINI_MODEL_NAME } from '../config/constants';
import { getMetaCredentials } from './whatsappConnectionService';

// Gemini API endpoint for multimodal content
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_NAME}:generateContent`;

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Convert speech audio to text using Google Gemini AI
 * @param audioBuffer - Audio file buffer (OGG/OPUS from WhatsApp)
 * @param languageCode - Primary language hint (default: en-IN for Indian English)
 * @returns Transcribed text
 */
export async function convertSpeechToText(
  audioBuffer: Buffer,
  languageCode: string = 'en-IN'
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    logger.error('GEMINI_API_KEY not configured');
    throw new Error('Speech-to-text service not configured');
  }

  // Convert buffer to base64
  const audioContent = audioBuffer.toString('base64');

  // Prompt for transcription - handles English, Malayalam, and Manglish
  const transcriptionPrompt = `You are a transcription assistant. Transcribe the following audio message exactly as spoken.

Instructions:
- Output ONLY the transcribed text, nothing else
- If the audio contains Malayalam words mixed with English (Manglish), transcribe them as spoken
- Preserve the natural flow and meaning
- If the audio is unclear or empty, respond with: [UNCLEAR]
- Do not add any explanations, just the transcription`;

  try {
    const response = await axios.post<GeminiResponse>(
      `${GEMINI_API_URL}?key=${apiKey}`,
      {
        contents: [
          {
            parts: [
              { text: transcriptionPrompt },
              {
                inline_data: {
                  mime_type: 'audio/ogg',
                  data: audioContent,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1, // Low temperature for accurate transcription
          maxOutputTokens: 500,
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 30000, // 30 second timeout
      }
    );

    if (response.data.error) {
      logger.error('Gemini API error', response.data.error);
      throw new Error(`Speech API error: ${response.data.error.message}`);
    }

    // Extract transcription from response
    const transcription = response.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    if (!transcription || transcription === '[UNCLEAR]') {
      logger.warn('No clear transcription returned');
      return '';
    }

    logger.info(`Transcription successful: "${transcription.substring(0, 50)}${transcription.length > 50 ? '...' : ''}"`);
    return transcription;

  } catch (error) {
    if (axios.isAxiosError(error)) {
      const errorMessage = error.response?.data?.error?.message || error.message;
      logger.error('Speech-to-text API request failed', { error: errorMessage });
      throw new Error(`Speech-to-text failed: ${errorMessage}`);
    }
    throw error;
  }
}

/**
 * Download media (audio/voice) from WhatsApp
 * @param mediaId - WhatsApp media ID
 * @param businessId - Optional business ID for multi-tenant credential lookup
 * @returns Audio buffer
 */
export async function downloadWhatsAppMedia(mediaId: string, businessId?: string): Promise<Buffer> {
  let accessToken: string | undefined;

  // Try to get credentials from business config first
  const credentials = await getMetaCredentials(businessId);
  accessToken = credentials?.accessToken;

  if (!accessToken) {
    throw new Error('WhatsApp access token not configured');
  }

  try {
    // Step 1: Get media URL from WhatsApp
    const urlResponse = await axios.get(
      `https://graph.facebook.com/v18.0/${mediaId}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
        timeout: 10000,
      }
    );

    const mediaUrl = urlResponse.data.url;
    if (!mediaUrl) {
      throw new Error('Media URL not found in response');
    }

    logger.debug(`Media URL retrieved: ${mediaUrl.substring(0, 50)}...`);

    // Step 2: Download the actual media file
    const mediaResponse = await axios.get(mediaUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
      responseType: 'arraybuffer',
      timeout: 30000, // 30 second timeout for download
    });

    const buffer = Buffer.from(mediaResponse.data);
    logger.info(`Media downloaded: ${buffer.length} bytes`);

    return buffer;

  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('Failed to download WhatsApp media', {
        status: error.response?.status,
        message: error.message,
      });
    }
    throw new Error(`Failed to download media: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Process a voice message end-to-end
 * Downloads from WhatsApp and converts to text
 * @param mediaId - WhatsApp media ID
 * @param businessId - Optional business ID for multi-tenant credential lookup
 * @returns Transcribed text
 */
export async function processVoiceMessage(mediaId: string, businessId?: string): Promise<string> {
  logger.info(`Processing voice message: ${mediaId}`);

  // Download audio from WhatsApp (with business credentials)
  const audioBuffer = await downloadWhatsAppMedia(mediaId, businessId);

  // Convert to text
  const transcription = await convertSpeechToText(audioBuffer);

  if (!transcription) {
    throw new Error('Could not transcribe voice message');
  }

  return transcription;
}

/**
 * Check if speech service is configured and available
 */
export function isSpeechServiceAvailable(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

/**
 * Check if voice feature is enabled (premium feature)
 */
export function isVoiceEnabled(): boolean {
  return process.env.VOICE_ENABLED === 'true';
}
