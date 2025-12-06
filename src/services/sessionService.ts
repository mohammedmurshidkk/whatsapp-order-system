import { supabase } from '../config/database';
import { Session, SessionWithItems, SessionItem, SessionState, OrderType } from '../types';
import { SESSION_TIMEOUT_HOURS } from '../config/constants';
import { logger } from '../utils/logger';

export async function findOrCreateSession(customerId: string): Promise<Session> {
  const timeoutThreshold = new Date();
  timeoutThreshold.setHours(timeoutThreshold.getHours() - SESSION_TIMEOUT_HOURS);

  // Find active session within timeout window
  const { data: existingSession, error: findError } = await supabase
    .from('sessions')
    .select('*')
    .eq('customer_id', customerId)
    .eq('status', 'active')
    .gte('last_message_at', timeoutThreshold.toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (existingSession && !findError) {
    logger.debug(`Active session found: ${existingSession.id}`);
    return existingSession as Session;
  }

  // Create new session
  const now = new Date().toISOString();
  const { data: newSession, error: createError } = await supabase
    .from('sessions')
    .insert({
      customer_id: customerId,
      status: 'active',
      created_at: now,
      last_message_at: now,
      total_items: 0,
      session_state: 'ordering',
    })
    .select()
    .single();

  if (createError) {
    logger.error('Failed to create session', createError);
    throw new Error('Failed to create session');
  }

  logger.info(`New session created: ${newSession.id}`);
  return newSession as Session;
}

export async function updateSessionActivity(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from('sessions')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', sessionId);

  if (error) {
    logger.error('Failed to update session activity', error);
    throw new Error('Failed to update session activity');
  }
}

export async function getSessionWithItems(
  sessionId: string
): Promise<SessionWithItems | null> {
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (sessionError || !session) {
    logger.debug(`Session not found: ${sessionId}`);
    return null;
  }

  const { data: items, error: itemsError } = await supabase
    .from('session_items')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (itemsError) {
    logger.error('Failed to fetch session items', itemsError);
    throw new Error('Failed to fetch session items');
  }

  return {
    ...session,
    items: (items || []) as SessionItem[],
  } as SessionWithItems;
}

export async function completeSession(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from('sessions')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  if (error) {
    logger.error('Failed to complete session', error);
    throw new Error('Failed to complete session');
  }

  logger.info(`Session completed: ${sessionId}`);
}

export async function updateSessionItemCount(sessionId: string): Promise<void> {
  // Get count of items in session
  const { count, error: countError } = await supabase
    .from('session_items')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId);

  if (countError) {
    logger.error('Failed to count session items', countError);
    throw new Error('Failed to count session items');
  }

  const { error: updateError } = await supabase
    .from('sessions')
    .update({ total_items: count || 0 })
    .eq('id', sessionId);

  if (updateError) {
    logger.error('Failed to update session item count', updateError);
    throw new Error('Failed to update session item count');
  }
}

export async function getSessionById(sessionId: string): Promise<Session | null> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (error) {
    return null;
  }

  return data as Session;
}

// Pause AI for a session (human takeover)
export async function pauseAI(
  sessionId: string,
  pausedBy: string = 'Business Owner'
): Promise<void> {
  const { error } = await supabase
    .from('sessions')
    .update({
      ai_paused: true,
      paused_at: new Date().toISOString(),
      paused_by: pausedBy,
    })
    .eq('id', sessionId);

  if (error) {
    logger.error('Failed to pause AI', error);
    throw new Error('Failed to pause AI');
  }

  logger.info(`AI paused for session ${sessionId} by ${pausedBy}`);
}

// Resume AI for a session
export async function resumeAI(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from('sessions')
    .update({
      ai_paused: false,
      paused_at: null,
      paused_by: null,
    })
    .eq('id', sessionId);

  if (error) {
    logger.error('Failed to resume AI', error);
    throw new Error('Failed to resume AI');
  }

  logger.info(`AI resumed for session ${sessionId}`);
}

// Check if AI is paused for a session
export async function isAIPaused(sessionId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('sessions')
    .select('ai_paused')
    .eq('id', sessionId)
    .single();

  if (error || !data) {
    return false;
  }

  return data.ai_paused === true;
}

// Get active sessions for a business (for dashboard)
export async function getActiveSessionsForBusiness(
  businessId: string
): Promise<Session[]> {
  const timeoutThreshold = new Date();
  timeoutThreshold.setHours(timeoutThreshold.getHours() - SESSION_TIMEOUT_HOURS);

  const { data, error } = await supabase
    .from('sessions')
    .select(`
      *,
      customer:customers(phone, name)
    `)
    .eq('business_id', businessId)
    .eq('status', 'active')
    .gte('last_message_at', timeoutThreshold.toISOString())
    .order('last_message_at', { ascending: false });

  if (error) {
    logger.error('Failed to fetch active sessions', error);
    return [];
  }

  return (data || []) as Session[];
}

// Get session by customer phone (for dashboard lookup)
export async function getSessionByCustomerPhone(
  phone: string
): Promise<Session | null> {
  const timeoutThreshold = new Date();
  timeoutThreshold.setHours(timeoutThreshold.getHours() - SESSION_TIMEOUT_HOURS);

  const { data, error } = await supabase
    .from('sessions')
    .select(`
      *,
      customer:customers!inner(phone, name)
    `)
    .eq('customers.phone', phone)
    .eq('status', 'active')
    .gte('last_message_at', timeoutThreshold.toISOString())
    .order('last_message_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  return data as Session;
}

// Update the state of the conversation session
export async function updateSessionState(sessionId: string, state: SessionState): Promise<void> {
  const { error } = await supabase
    .from('sessions')
    .update({ session_state: state })
    .eq('id', sessionId);

  if (error) {
    logger.error(`Failed to update session state to ${state}`, error);
    throw new Error('Failed to update session state');
  }
  logger.info(`Session ${sessionId} state updated to: ${state}`);
}

// Update fulfillment details for the session
export async function updateSessionFulfillment(
  sessionId: string,
  fulfillmentData: {
    type?: OrderType;
    details?: string;
    time?: string;
  }
): Promise<void> {
  const updatePayload: Record<string, any> = {};
  if (fulfillmentData.type) updatePayload.fulfillment_type = fulfillmentData.type;
  if (fulfillmentData.details) updatePayload.fulfillment_details = fulfillmentData.details;
  if (fulfillmentData.time) updatePayload.fulfillment_time = fulfillmentData.time;

  if (Object.keys(updatePayload).length === 0) return;

  const { error } = await supabase
    .from('sessions')
    .update(updatePayload)
    .eq('id', sessionId);

  if (error) {
    logger.error('Failed to update session fulfillment details', error);
    throw new Error('Failed to update session fulfillment details');
  }
  logger.info(`Session ${sessionId} fulfillment details updated.`);
}
