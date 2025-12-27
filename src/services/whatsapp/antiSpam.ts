/**
 * Anti-Spam & Human-Like Behavior Utilities
 * Prevents WhatsApp ban by simulating human behavior
 */

import { Message, Chat } from 'whatsapp-web.js';
import { logger } from '../../utils/logger';

// ============================================
// CONFIGURATION - Adjust based on your needs
// ============================================

// Set to true to disable all delays (for testing)
// In production, set this to false
const TESTING_MODE = true;

const CONFIG = {
  // Typing simulation: ~40-60 words per minute typing speed
  CHARS_PER_SECOND: 8,
  MIN_TYPING_MS: TESTING_MODE ? 0 : 1000,      // Minimum 1 second typing
  MAX_TYPING_MS: TESTING_MODE ? 0 : 5000,      // Maximum 5 seconds typing

  // Response delays
  MIN_RESPONSE_DELAY_MS: TESTING_MODE ? 0 : 1500,   // Minimum delay before responding
  MAX_RESPONSE_DELAY_MS: TESTING_MODE ? 0 : 3500,   // Maximum delay before responding

  // Rate limiting
  MAX_MESSAGES_PER_MINUTE: 10,   // Per user
  MAX_MESSAGES_PER_HOUR: 100,    // Per user
  MAX_MESSAGES_PER_DAY: 500,     // Global limit
  COOLDOWN_PERIOD_MS: 60000,     // 1 minute cooldown if limit hit

  // Multi-message delays (when sending multiple messages)
  MULTI_MSG_MIN_DELAY_MS: 2000,
  MULTI_MSG_MAX_DELAY_MS: 4000,
};

// ============================================
// RATE LIMITING
// ============================================

interface RateLimitEntry {
  count: number;
  firstMessageAt: number;
  lastMessageAt: number;
  hourlyCounts: number[];
}

// In-memory rate limit store (per phone number)
const rateLimitStore = new Map<string, RateLimitEntry>();

// Global daily counter
let dailyMessageCount = 0;
let dailyResetAt = Date.now() + 24 * 60 * 60 * 1000;

/**
 * Check if we can send a message to this user
 */
export function canSendMessage(phone: string): { allowed: boolean; reason?: string; waitMs?: number } {
  const now = Date.now();

  // Reset daily counter if needed
  if (now > dailyResetAt) {
    dailyMessageCount = 0;
    dailyResetAt = now + 24 * 60 * 60 * 1000;
    logger.info('[AntiSpam] Daily counter reset');
  }

  // Check global daily limit
  if (dailyMessageCount >= CONFIG.MAX_MESSAGES_PER_DAY) {
    logger.warn('[AntiSpam] Daily message limit reached');
    return {
      allowed: false,
      reason: 'daily_limit',
      waitMs: dailyResetAt - now,
    };
  }

  // Get or create user entry
  let entry = rateLimitStore.get(phone);
  if (!entry) {
    entry = {
      count: 0,
      firstMessageAt: now,
      lastMessageAt: 0,
      hourlyCounts: [],
    };
    rateLimitStore.set(phone, entry);
  }

  // Reset minute counter if over 1 minute
  if (now - entry.firstMessageAt > 60000) {
    entry.hourlyCounts.push(entry.count);
    entry.count = 0;
    entry.firstMessageAt = now;

    // Keep only last 60 entries (1 hour of minute buckets)
    if (entry.hourlyCounts.length > 60) {
      entry.hourlyCounts.shift();
    }
  }

  // Check per-minute limit
  if (entry.count >= CONFIG.MAX_MESSAGES_PER_MINUTE) {
    const waitMs = 60000 - (now - entry.firstMessageAt);
    logger.warn(`[AntiSpam] Per-minute limit hit for ${phone}, wait ${waitMs}ms`);
    return {
      allowed: false,
      reason: 'minute_limit',
      waitMs,
    };
  }

  // Check hourly limit
  const hourlyTotal = entry.hourlyCounts.reduce((a, b) => a + b, 0) + entry.count;
  if (hourlyTotal >= CONFIG.MAX_MESSAGES_PER_HOUR) {
    logger.warn(`[AntiSpam] Hourly limit hit for ${phone}`);
    return {
      allowed: false,
      reason: 'hourly_limit',
      waitMs: CONFIG.COOLDOWN_PERIOD_MS,
    };
  }

  return { allowed: true };
}

/**
 * Record that a message was sent
 */
export function recordMessageSent(phone: string): void {
  const now = Date.now();
  dailyMessageCount++;

  let entry = rateLimitStore.get(phone);
  if (!entry) {
    entry = {
      count: 0,
      firstMessageAt: now,
      lastMessageAt: now,
      hourlyCounts: [],
    };
    rateLimitStore.set(phone, entry);
  }

  entry.count++;
  entry.lastMessageAt = now;
}

/**
 * Get current rate limit stats (for monitoring)
 */
export function getRateLimitStats(): {
  dailyCount: number;
  dailyLimit: number;
  activeUsers: number;
} {
  return {
    dailyCount: dailyMessageCount,
    dailyLimit: CONFIG.MAX_MESSAGES_PER_DAY,
    activeUsers: rateLimitStore.size,
  };
}

// ============================================
// HUMAN-LIKE DELAYS
// ============================================

/**
 * Generate random delay within range
 */
function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate typing duration based on message length
 * Simulates human typing speed
 */
export function calculateTypingDuration(message: string): number {
  const charCount = message.length;
  const baseTime = (charCount / CONFIG.CHARS_PER_SECOND) * 1000;

  // Add some randomness (±20%)
  const variance = baseTime * 0.2;
  const typingTime = baseTime + randomDelay(-variance, variance);

  // Clamp to min/max
  return Math.max(CONFIG.MIN_TYPING_MS, Math.min(CONFIG.MAX_TYPING_MS, typingTime));
}

/**
 * Get random response delay (before starting to type)
 */
export function getResponseDelay(): number {
  return randomDelay(CONFIG.MIN_RESPONSE_DELAY_MS, CONFIG.MAX_RESPONSE_DELAY_MS);
}

/**
 * Get delay between multiple messages
 */
export function getMultiMessageDelay(): number {
  return randomDelay(CONFIG.MULTI_MSG_MIN_DELAY_MS, CONFIG.MULTI_MSG_MAX_DELAY_MS);
}

// ============================================
// HUMAN-LIKE MESSAGE SENDING
// ============================================

/**
 * Send a reply with human-like behavior
 * - Waits before responding (reading time)
 * - Shows typing indicator
 * - Types at realistic speed
 */
export async function sendHumanLikeReply(
  message: Message,
  replyText: string,
  phone: string
): Promise<boolean> {
  try {
    // Check rate limit first (skip in testing mode)
    if (!TESTING_MODE) {
      const rateCheck = canSendMessage(phone);
      if (!rateCheck.allowed) {
        logger.warn(`[AntiSpam] Rate limited: ${rateCheck.reason}`);
        return false;
      }
    }

    // In testing mode, just send directly
    if (TESTING_MODE) {
      await message.reply(replyText);
      recordMessageSent(phone);
      return true;
    }

    // Get the chat for typing indicator
    const chat: Chat = await message.getChat();

    // Step 1: Initial delay (simulates reading the message)
    const readingDelay = getResponseDelay();
    logger.debug(`[AntiSpam] Reading delay: ${readingDelay}ms`);
    await sleep(readingDelay);

    // Step 2: Start typing indicator
    await chat.sendStateTyping();

    // Step 3: Wait for "typing" duration
    const typingDuration = calculateTypingDuration(replyText);
    logger.debug(`[AntiSpam] Typing duration: ${typingDuration}ms for ${replyText.length} chars`);
    await sleep(typingDuration);

    // Step 4: Clear typing state
    await chat.clearState();

    // Step 5: Small pause before sending (like hitting enter)
    await sleep(randomDelay(200, 500));

    // Step 6: Send the message
    await message.reply(replyText);

    // Record the message
    recordMessageSent(phone);

    logger.debug(`[AntiSpam] Message sent to ${phone} (daily: ${dailyMessageCount})`);
    return true;
  } catch (error) {
    logger.error('[AntiSpam] Error sending human-like reply:', error);
    // Fallback to direct send if something fails
    try {
      await message.reply(replyText);
      recordMessageSent(phone);
      return true;
    } catch (fallbackError) {
      logger.error('[AntiSpam] Fallback send also failed:', fallbackError);
      return false;
    }
  }
}

/**
 * Send multiple messages with natural delays between them
 */
export async function sendMultipleMessages(
  message: Message,
  messages: string[],
  phone: string
): Promise<boolean> {
  try {
    const chat: Chat = await message.getChat();

    for (let i = 0; i < messages.length; i++) {
      const text = messages[i];

      // Check rate limit for each message
      const rateCheck = canSendMessage(phone);
      if (!rateCheck.allowed) {
        logger.warn(`[AntiSpam] Rate limited during multi-message: ${rateCheck.reason}`);
        return false;
      }

      // Typing indicator
      await chat.sendStateTyping();
      await sleep(calculateTypingDuration(text));
      await chat.clearState();

      // Send message
      if (i === 0) {
        await message.reply(text);
      } else {
        await chat.sendMessage(text);
      }
      recordMessageSent(phone);

      // Delay before next message (if not last)
      if (i < messages.length - 1) {
        await sleep(getMultiMessageDelay());
      }
    }

    return true;
  } catch (error) {
    logger.error('[AntiSpam] Error sending multiple messages:', error);
    return false;
  }
}

// ============================================
// CLEANUP
// ============================================

/**
 * Clean up old rate limit entries (call periodically)
 */
export function cleanupRateLimitStore(): void {
  const now = Date.now();
  const staleThreshold = 2 * 60 * 60 * 1000; // 2 hours

  for (const [phone, entry] of rateLimitStore.entries()) {
    if (now - entry.lastMessageAt > staleThreshold) {
      rateLimitStore.delete(phone);
    }
  }

  logger.debug(`[AntiSpam] Cleanup complete. Active entries: ${rateLimitStore.size}`);
}

// Run cleanup every hour
setInterval(cleanupRateLimitStore, 60 * 60 * 1000);
