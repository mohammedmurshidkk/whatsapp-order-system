import axios from 'axios';
import { supabase } from '../config/database';
import { WHATSAPP_API_VERSION } from '../config/constants';
import { logger } from '../utils/logger';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

const WHATSAPP_API_BASE = `https://graph.facebook.com/${WHATSAPP_API_VERSION}`;

// Allowed media types and size limits
export const MEDIA_LIMITS = {
  image: { maxSize: 5 * 1024 * 1024, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'] },
  video: { maxSize: 16 * 1024 * 1024, mimeTypes: ['video/mp4', 'video/3gpp'] },
  audio: { maxSize: 16 * 1024 * 1024, mimeTypes: ['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/webm', 'audio/amr'] },
  document: { maxSize: 100 * 1024 * 1024, mimeTypes: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
};

export type MediaType = 'image' | 'video' | 'audio' | 'document';

interface MediaUrlResponse {
  url: string;
  mime_type: string;
  sha256: string;
  file_size: number;
  id: string;
}

/**
 * Get media URL from WhatsApp (URL expires in ~5 minutes)
 */
export async function getWhatsAppMediaUrl(mediaId: string, accessToken?: string): Promise<MediaUrlResponse> {
  const token = accessToken || process.env.WHATSAPP_ACCESS_TOKEN;

  if (!token) {
    throw new Error('WhatsApp access token not configured');
  }

  try {
    const response = await axios.get<MediaUrlResponse>(
      `${WHATSAPP_API_BASE}/${mediaId}`,
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    return response.data;
  } catch (error) {
    logger.error('Failed to get media URL from WhatsApp', error);
    throw new Error('Failed to get media URL');
  }
}

/**
 * Download media from WhatsApp
 */
export async function downloadWhatsAppMedia(mediaId: string, accessToken?: string): Promise<{ buffer: Buffer; mimeType: string; size: number }> {
  const token = accessToken || process.env.WHATSAPP_ACCESS_TOKEN;

  if (!token) {
    throw new Error('WhatsApp access token not configured');
  }

  // First get the media URL
  const mediaInfo = await getWhatsAppMediaUrl(mediaId, token);

  // Then download the actual file
  try {
    const response = await axios.get(mediaInfo.url, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
      timeout: 60000, // 60 seconds for large files
    });

    return {
      buffer: Buffer.from(response.data),
      mimeType: mediaInfo.mime_type,
      size: mediaInfo.file_size,
    };
  } catch (error) {
    logger.error('Failed to download media from WhatsApp', error);
    throw new Error('Failed to download media');
  }
}

/**
 * Store media in Supabase Storage
 */
export async function storeMediaInSupabase(
  buffer: Buffer,
  mimeType: string,
  businessId: string,
  mediaId: string
): Promise<{ filePath: string; publicUrl: string }> {
  // Determine file extension from mime type
  const ext = getExtensionFromMimeType(mimeType);
  const fileName = `${businessId}/${Date.now()}_${mediaId}.${ext}`;

  const { data, error } = await supabase.storage
    .from('media')
    .upload(fileName, buffer, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) {
    logger.error('Failed to upload media to Supabase', error);
    throw new Error('Failed to store media');
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from('media')
    .getPublicUrl(fileName);

  return {
    filePath: fileName,
    publicUrl: urlData.publicUrl,
  };
}

/**
 * Process incoming WhatsApp media: download and store
 */
export async function processIncomingMedia(
  mediaId: string,
  mimeType: string,
  businessId: string,
  accessToken?: string
): Promise<{ mediaUrl: string; fileSize: number } | null> {
  try {
    // Download from WhatsApp
    const { buffer, size } = await downloadWhatsAppMedia(mediaId, accessToken);

    // Store in Supabase
    const { publicUrl } = await storeMediaInSupabase(buffer, mimeType, businessId, mediaId);

    logger.info(`Media processed and stored: ${mediaId} -> ${publicUrl}`);

    return {
      mediaUrl: publicUrl,
      fileSize: size,
    };
  } catch (error) {
    logger.error(`Failed to process incoming media: ${mediaId}`, error);
    return null;
  }
}

/**
 * Upload media to WhatsApp for sending
 */
export async function uploadMediaToWhatsApp(
  buffer: Buffer,
  mimeType: string,
  phoneNumberId?: string,
  accessToken?: string
): Promise<string> {
  const token = accessToken || process.env.WHATSAPP_ACCESS_TOKEN;
  const numId = phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !numId) {
    throw new Error('WhatsApp credentials not configured');
  }

  try {
    // WhatsApp requires form-data upload
    const FormData = (await import('form-data')).default;
    const formData = new FormData();
    formData.append('messaging_product', 'whatsapp');
    formData.append('file', buffer, {
      contentType: mimeType,
      filename: `upload.${getExtensionFromMimeType(mimeType)}`,
    });
    formData.append('type', mimeType);

    const response = await axios.post(
      `${WHATSAPP_API_BASE}/${numId}/media`,
      formData,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          ...formData.getHeaders(),
        },
        timeout: 60000,
      }
    );

    return response.data.id;
  } catch (error) {
    logger.error('Failed to upload media to WhatsApp', error);
    throw new Error('Failed to upload media to WhatsApp');
  }
}

/**
 * Send image message via WhatsApp
 */
export async function sendWhatsAppImage(
  to: string,
  imageUrl: string,
  caption?: string,
  phoneNumberId?: string,
  accessToken?: string
): Promise<string | null> {
  const token = accessToken || process.env.WHATSAPP_ACCESS_TOKEN;
  const numId = phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !numId) {
    logger.info(`[WhatsApp Mock] Image to: ${to}, URL: ${imageUrl}, Caption: ${caption}`);
    return null;
  }

  const payload: any = {
    messaging_product: 'whatsapp',
    to,
    type: 'image',
    image: {
      link: imageUrl,
    },
  };

  if (caption) {
    payload.image.caption = caption;
  }

  try {
    const response = await axios.post(
      `${WHATSAPP_API_BASE}/${numId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    logger.info(`WhatsApp image sent to ${to}`);
    return response.data.messages?.[0]?.id || null;
  } catch (error) {
    logger.error('Failed to send WhatsApp image', error);
    throw error;
  }
}

/**
 * Send video message via WhatsApp
 */
export async function sendWhatsAppVideo(
  to: string,
  videoUrl: string,
  caption?: string,
  phoneNumberId?: string,
  accessToken?: string
): Promise<string | null> {
  const token = accessToken || process.env.WHATSAPP_ACCESS_TOKEN;
  const numId = phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !numId) {
    logger.info(`[WhatsApp Mock] Video to: ${to}, URL: ${videoUrl}`);
    return null;
  }

  const payload: any = {
    messaging_product: 'whatsapp',
    to,
    type: 'video',
    video: {
      link: videoUrl,
    },
  };

  if (caption) {
    payload.video.caption = caption;
  }

  try {
    const response = await axios.post(
      `${WHATSAPP_API_BASE}/${numId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    logger.info(`WhatsApp video sent to ${to}`);
    return response.data.messages?.[0]?.id || null;
  } catch (error) {
    logger.error('Failed to send WhatsApp video', error);
    throw error;
  }
}

/**
 * Convert webm audio to ogg/opus format using ffmpeg
 * WhatsApp doesn't support webm - only: aac, mp4, mpeg, amr, ogg, opus
 */
async function convertWebmToOgg(inputBuffer: Buffer): Promise<Buffer> {
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');

  const tempDir = os.tmpdir();
  const inputPath = path.join(tempDir, `input_${Date.now()}.webm`);
  const outputPath = path.join(tempDir, `output_${Date.now()}.ogg`);

  try {
    // Write input buffer to temp file
    fs.writeFileSync(inputPath, inputBuffer);

    // Convert using ffmpeg (opus codec for best WhatsApp compatibility)
    await execAsync(`ffmpeg -i "${inputPath}" -c:a libopus -b:a 64k "${outputPath}" -y`);

    // Read output file
    const outputBuffer = fs.readFileSync(outputPath);

    // Cleanup
    fs.unlinkSync(inputPath);
    fs.unlinkSync(outputPath);

    logger.info('Audio converted from webm to ogg/opus');
    return outputBuffer;
  } catch (error) {
    // Cleanup on error
    try {
      const fs = await import('fs');
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    } catch {}
    logger.error('Failed to convert audio', error);
    throw new Error('Failed to convert audio format');
  }
}

/**
 * Send audio message via WhatsApp
 * Converts webm to ogg/opus since WhatsApp doesn't support webm
 */
export async function sendWhatsAppAudio(
  to: string,
  audioUrl: string,
  phoneNumberId?: string,
  accessToken?: string
): Promise<string | null> {
  const token = accessToken || process.env.WHATSAPP_ACCESS_TOKEN;
  const numId = phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !numId) {
    logger.info(`[WhatsApp Mock] Audio to: ${to}, URL: ${audioUrl}`);
    return null;
  }

  try {
    // Download the audio file from Supabase
    const audioResponse = await axios.get(audioUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });
    let audioBuffer = Buffer.from(audioResponse.data);
    let mimeType = 'audio/ogg';

    // Check if webm and convert to ogg
    const isWebm = audioUrl.includes('.webm') || audioUrl.includes('audio/webm');
    if (isWebm) {
      logger.info('Converting webm audio to ogg/opus for WhatsApp');
      audioBuffer = await convertWebmToOgg(audioBuffer);
      mimeType = 'audio/ogg';
    } else if (audioUrl.includes('.mp3')) {
      mimeType = 'audio/mpeg';
    } else if (audioUrl.includes('.m4a')) {
      mimeType = 'audio/mp4';
    } else if (audioUrl.includes('.aac')) {
      mimeType = 'audio/aac';
    } else if (audioUrl.includes('.ogg')) {
      mimeType = 'audio/ogg';
    }

    // Upload to WhatsApp to get media ID
    const mediaId = await uploadMediaToWhatsApp(audioBuffer, mimeType, numId, token);

    // Send using media ID instead of link
    const response = await axios.post(
      `${WHATSAPP_API_BASE}/${numId}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'audio',
        audio: {
          id: mediaId,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    logger.info(`WhatsApp audio sent to ${to} using media ID: ${mediaId}`);
    return response.data.messages?.[0]?.id || null;
  } catch (error) {
    logger.error('Failed to send WhatsApp audio', error);
    throw error;
  }
}

/**
 * Send document message via WhatsApp
 */
export async function sendWhatsAppDocument(
  to: string,
  documentUrl: string,
  filename: string,
  caption?: string,
  phoneNumberId?: string,
  accessToken?: string
): Promise<string | null> {
  const token = accessToken || process.env.WHATSAPP_ACCESS_TOKEN;
  const numId = phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !numId) {
    logger.info(`[WhatsApp Mock] Document to: ${to}, URL: ${documentUrl}, Filename: ${filename}`);
    return null;
  }

  const payload: any = {
    messaging_product: 'whatsapp',
    to,
    type: 'document',
    document: {
      link: documentUrl,
      filename,
    },
  };

  if (caption) {
    payload.document.caption = caption;
  }

  try {
    const response = await axios.post(
      `${WHATSAPP_API_BASE}/${numId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    logger.info(`WhatsApp document sent to ${to}: ${filename}`);
    return response.data.messages?.[0]?.id || null;
  } catch (error) {
    logger.error('Failed to send WhatsApp document', error);
    throw error;
  }
}

/**
 * Send text message via WhatsApp (with message ID return)
 */
export async function sendWhatsAppText(
  to: string,
  text: string,
  phoneNumberId?: string,
  accessToken?: string
): Promise<string | null> {
  const token = accessToken || process.env.WHATSAPP_ACCESS_TOKEN;
  const numId = phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !numId) {
    logger.info(`[WhatsApp Mock] Text to: ${to}, Message: ${text}`);
    return null;
  }

  try {
    const response = await axios.post(
      `${WHATSAPP_API_BASE}/${numId}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    logger.info(`WhatsApp text sent to ${to}`);
    return response.data.messages?.[0]?.id || null;
  } catch (error) {
    logger.error('Failed to send WhatsApp text', error);
    throw error;
  }
}

/**
 * Save uploaded media record to database
 */
export async function saveMediaUpload(
  businessId: string,
  filePath: string,
  fileUrl: string,
  mimeType: string,
  fileSize: number,
  originalFilename?: string,
  duration?: number
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('media_uploads')
    .insert({
      business_id: businessId,
      file_path: filePath,
      file_url: fileUrl,
      mime_type: mimeType,
      file_size: fileSize,
      original_filename: originalFilename,
      duration,
    })
    .select('id')
    .single();

  if (error) {
    logger.error('Failed to save media upload record', error);
    throw new Error('Failed to save media upload');
  }

  return { id: data.id };
}

/**
 * Get media upload by ID
 */
export async function getMediaUpload(mediaId: string): Promise<{
  id: string;
  file_url: string;
  mime_type: string;
  file_size: number;
  duration?: number;
  original_filename?: string;
} | null> {
  const { data, error } = await supabase
    .from('media_uploads')
    .select('id, file_url, mime_type, file_size, duration, original_filename')
    .eq('id', mediaId)
    .single();

  if (error || !data) {
    return null;
  }

  return data;
}

/**
 * Validate media file
 */
export function validateMediaFile(
  mimeType: string,
  fileSize: number,
  mediaType: MediaType
): { valid: boolean; error?: string } {
  const limits = MEDIA_LIMITS[mediaType];

  if (!limits) {
    return { valid: false, error: `Invalid media type: ${mediaType}` };
  }

  if (!limits.mimeTypes.includes(mimeType)) {
    return { valid: false, error: `Invalid file type: ${mimeType}. Allowed: ${limits.mimeTypes.join(', ')}` };
  }

  if (fileSize > limits.maxSize) {
    const maxMB = limits.maxSize / (1024 * 1024);
    return { valid: false, error: `File too large. Maximum size: ${maxMB}MB` };
  }

  return { valid: true };
}

/**
 * Get file extension from mime type
 */
function getExtensionFromMimeType(mimeType: string): string {
  const mimeMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/3gpp': '3gp',
    'audio/aac': 'aac',
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
    'audio/amr': 'amr',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  };

  return mimeMap[mimeType] || mimeType.split('/')[1]?.split(';')[0] || 'bin';
}

/**
 * Determine media type from mime type
 */
export function getMediaTypeFromMimeType(mimeType: string): MediaType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}
