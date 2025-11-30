import { Request, Response } from 'express';
import {
  getSessionById,
  getSessionWithItems,
  pauseAI,
  resumeAI,
  getActiveSessionsForBusiness,
  getSessionByCustomerPhone,
} from '../services/sessionService';
import { getRecentMessages } from '../services/messageService';
import { logger } from '../utils/logger';

// Get session details with items and messages
export async function getSessionDetails(req: Request, res: Response): Promise<void> {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      res.status(400).json({ error: 'Session ID is required' });
      return;
    }

    const session = await getSessionWithItems(sessionId);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const messages = await getRecentMessages(sessionId, 50);

    res.status(200).json({
      session,
      messages,
    });
  } catch (error) {
    logger.error('Failed to get session details', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
}

// Pause AI for a session (human takeover)
export async function pauseSessionAI(req: Request, res: Response): Promise<void> {
  try {
    const { sessionId } = req.params;
    const { pausedBy } = req.body;

    if (!sessionId) {
      res.status(400).json({ error: 'Session ID is required' });
      return;
    }

    const session = await getSessionById(sessionId);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    await pauseAI(sessionId, pausedBy || 'Business Owner');

    res.status(200).json({
      success: true,
      message: 'AI paused. You can now chat directly with the customer.',
      sessionId,
    });
  } catch (error) {
    logger.error('Failed to pause AI', error);
    res.status(500).json({ error: 'Failed to pause AI' });
  }
}

// Resume AI for a session
export async function resumeSessionAI(req: Request, res: Response): Promise<void> {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      res.status(400).json({ error: 'Session ID is required' });
      return;
    }

    const session = await getSessionById(sessionId);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    await resumeAI(sessionId);

    res.status(200).json({
      success: true,
      message: 'AI resumed. Bot will now respond to customer messages.',
      sessionId,
    });
  } catch (error) {
    logger.error('Failed to resume AI', error);
    res.status(500).json({ error: 'Failed to resume AI' });
  }
}

// Get all active sessions for a business
export async function getActiveSessions(req: Request, res: Response): Promise<void> {
  try {
    const { businessId } = req.params;

    if (!businessId) {
      res.status(400).json({ error: 'Business ID is required' });
      return;
    }

    const sessions = await getActiveSessionsForBusiness(businessId);

    res.status(200).json({
      count: sessions.length,
      sessions,
    });
  } catch (error) {
    logger.error('Failed to get active sessions', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
}

// Find session by customer phone
export async function findSessionByPhone(req: Request, res: Response): Promise<void> {
  try {
    const { phone } = req.params;

    if (!phone) {
      res.status(400).json({ error: 'Phone number is required' });
      return;
    }

    const session = await getSessionByCustomerPhone(phone);

    if (!session) {
      res.status(404).json({ error: 'No active session found for this phone' });
      return;
    }

    const sessionWithItems = await getSessionWithItems(session.id);
    const messages = await getRecentMessages(session.id, 50);

    res.status(200).json({
      session: sessionWithItems,
      messages,
    });
  } catch (error) {
    logger.error('Failed to find session by phone', error);
    res.status(500).json({ error: 'Failed to find session' });
  }
}
