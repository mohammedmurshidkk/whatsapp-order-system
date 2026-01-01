import { supabase } from '../config/database';
import { Message, MessageDirection } from '../types';
import { MESSAGE_HISTORY_LIMIT } from '../config/constants';
import { logger } from '../utils/logger';
import { emitNewMessage } from './socketService';

export async function getRecentMessages(
  sessionId: string,
  limit: number = MESSAGE_HISTORY_LIMIT
): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error('Failed to fetch recent messages', error);
    throw new Error('Failed to fetch recent messages');
  }

  // Return in chronological order (oldest first)
  return ((data || []) as Message[]).reverse();
}

export interface SaveMessageOptions {
  messageType?: string;
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  mediaCaption?: string | null;
  mediaFilename?: string | null;
  mediaDuration?: number | null;
  mediaSize?: number | null;
  whatsappMessageId?: string | null;
}

export async function saveMessage(
  sessionId: string,
  content: string,
  direction: MessageDirection,
  options?: SaveMessageOptions
): Promise<Message> {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      session_id: sessionId,
      content,
      direction,
      is_read: direction === 'inbound' ? false : true,
      message_type: options?.messageType || 'text',
      media_url: options?.mediaUrl || null,
      media_mime_type: options?.mediaMimeType || null,
      media_caption: options?.mediaCaption || null,
      media_filename: options?.mediaFilename || null,
      media_duration: options?.mediaDuration || null,
      media_size: options?.mediaSize || null,
      whatsapp_message_id: options?.whatsappMessageId || null,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to save message', error);
    throw new Error('Failed to save message');
  }

  const savedMessage = data as Message;
  logger.debug(`Message saved (${direction}): ${content.substring(0, 50)}...`);

  // Emit real-time event to admin (get business_id from session)
  try {
    const { data: session } = await supabase
      .from('sessions')
      .select('business_id')
      .eq('id', sessionId)
      .single();

    if (session?.business_id) {
      emitNewMessage(session.business_id, {
        id: savedMessage.id,
        session_id: sessionId,
        direction: savedMessage.direction,
        content: savedMessage.content,
        message_type: (savedMessage as any).message_type || 'text',
        media_url: (savedMessage as any).media_url,
        media_mime_type: (savedMessage as any).media_mime_type,
        media_caption: (savedMessage as any).media_caption,
        media_filename: (savedMessage as any).media_filename,
        media_duration: (savedMessage as any).media_duration,
        created_at: savedMessage.created_at,
      });
    }
  } catch (emitError) {
    // Don't fail the save if emit fails
    logger.warn('Failed to emit new message event', emitError);
  }

  return savedMessage;
}

export async function saveIncomingMessage(
  sessionId: string,
  content: string,
  options?: SaveMessageOptions
): Promise<Message> {
  return saveMessage(sessionId, content, 'inbound', options);
}

export async function saveOutgoingMessage(
  sessionId: string,
  content: string,
  options?: SaveMessageOptions
): Promise<Message> {
  return saveMessage(sessionId, content, 'outgoing', options);
}

export async function saveIncomingMediaMessage(
  sessionId: string,
  messageType: 'image' | 'video' | 'audio' | 'document' | 'sticker',
  mediaUrl: string,
  mimeType: string,
  options?: {
    caption?: string;
    filename?: string;
    duration?: number;
    size?: number;
  }
): Promise<Message> {
  const content = options?.caption || `[${messageType.charAt(0).toUpperCase() + messageType.slice(1)}]`;

  return saveMessage(sessionId, content, 'inbound', {
    messageType,
    mediaUrl,
    mediaMimeType: mimeType,
    mediaCaption: options?.caption || null,
    mediaFilename: options?.filename || null,
    mediaDuration: options?.duration || null,
    mediaSize: options?.size || null,
  });
}

export function formatMessagesForAI(messages: Message[]): string {
  return messages
    .map((msg) => {
      const role = msg.direction === 'inbound' ? 'Customer' : 'Assistant';
      return `${role}: ${msg.content}`;
    })
    .join('\n');
}
