import { supabase } from '../config/database';
import { Message, MessageDirection } from '../types';
import { MESSAGE_HISTORY_LIMIT } from '../config/constants';
import { logger } from '../utils/logger';

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

export async function saveMessage(
  sessionId: string,
  content: string,
  direction: MessageDirection
): Promise<Message> {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      session_id: sessionId,
      content,
      direction,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to save message', error);
    throw new Error('Failed to save message');
  }

  logger.debug(`Message saved (${direction}): ${content.substring(0, 50)}...`);
  return data as Message;
}

export async function saveIncomingMessage(
  sessionId: string,
  content: string
): Promise<Message> {
  return saveMessage(sessionId, content, 'incoming');
}

export async function saveOutgoingMessage(
  sessionId: string,
  content: string
): Promise<Message> {
  return saveMessage(sessionId, content, 'outgoing');
}

export function formatMessagesForAI(messages: Message[]): string {
  return messages
    .map((msg) => {
      const role = msg.direction === 'incoming' ? 'Customer' : 'Assistant';
      return `${role}: ${msg.content}`;
    })
    .join('\n');
}
