import crypto from 'crypto';
import { logger } from '../utils/logger';

// Redis client - lazy initialized
let redis: any = null;
let redisInitialized = false;

async function getRedisClient() {
  if (redisInitialized) return redis;

  redisInitialized = true;

  if (!process.env.UPSTASH_REDIS_URL || !process.env.UPSTASH_REDIS_TOKEN) {
    logger.debug('Upstash Redis not configured - caching disabled');
    return null;
  }

  try {
    const { Redis } = await import('@upstash/redis');
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_URL,
      token: process.env.UPSTASH_REDIS_TOKEN,
    });
    logger.info('Upstash Redis connected');
    return redis;
  } catch (error) {
    logger.warn('Failed to initialize Upstash Redis', error);
    return null;
  }
}

function hashMessage(businessId: string, message: string): string {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto.createHash('md5').update(`${businessId}:${normalized}`).digest('hex');
}

// AI Response Cache (30 min TTL)
export async function getCachedAIResponse(businessId: string, message: string): Promise<string | null> {
  const client = await getRedisClient();
  if (!client) return null;

  try {
    const key = `ai:${hashMessage(businessId, message)}`;
    return await client.get<string>(key);
  } catch (error) {
    logger.debug('Cache miss (error)', { error });
    return null;
  }
}

export async function setCachedAIResponse(
  businessId: string,
  message: string,
  response: string,
  ttlSeconds = 1800 // 30 minutes
): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;

  try {
    const key = `ai:${hashMessage(businessId, message)}`;
    await client.set(key, response, { ex: ttlSeconds });
  } catch (error) {
    logger.debug('Cache set failed', { error });
  }
}

// Menu Cache (5 min TTL)
export async function getCachedMenu(businessId: string): Promise<any | null> {
  const client = await getRedisClient();
  if (!client) return null;

  try {
    const cached = await client.get(`menu:${businessId}`);
    return cached ? JSON.parse(cached as string) : null;
  } catch (error) {
    logger.debug('Menu cache miss', { error });
    return null;
  }
}

export async function setCachedMenu(businessId: string, menu: any, ttlSeconds = 300): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;

  try {
    await client.set(`menu:${businessId}`, JSON.stringify(menu), { ex: ttlSeconds });
  } catch (error) {
    logger.debug('Menu cache set failed', { error });
  }
}

// Business Config Cache (10 min TTL)
export async function getCachedBusinessConfig(businessId: string): Promise<any | null> {
  const client = await getRedisClient();
  if (!client) return null;

  try {
    const cached = await client.get(`business:${businessId}`);
    return cached ? JSON.parse(cached as string) : null;
  } catch (error) {
    logger.debug('Business config cache miss', { error });
    return null;
  }
}

export async function setCachedBusinessConfig(businessId: string, config: any, ttlSeconds = 600): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;

  try {
    await client.set(`business:${businessId}`, JSON.stringify(config), { ex: ttlSeconds });
  } catch (error) {
    logger.debug('Business config cache set failed', { error });
  }
}

// FAQ/Template Cache (1 hour TTL)
export async function getCachedFAQ(businessId: string, intent: string): Promise<string | null> {
  const client = await getRedisClient();
  if (!client) return null;

  try {
    return await client.get<string>(`faq:${businessId}:${intent}`);
  } catch (error) {
    logger.debug('FAQ cache miss', { error });
    return null;
  }
}

export async function setCachedFAQ(
  businessId: string,
  intent: string,
  response: string,
  ttlSeconds = 3600
): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;

  try {
    await client.set(`faq:${businessId}:${intent}`, response, { ex: ttlSeconds });
  } catch (error) {
    logger.debug('FAQ cache set failed', { error });
  }
}

// Greeting Cache (24 hour TTL)
export async function getCachedGreeting(businessId: string): Promise<string | null> {
  const client = await getRedisClient();
  if (!client) return null;

  try {
    return await client.get<string>(`greeting:${businessId}`);
  } catch (error) {
    return null;
  }
}

export async function setCachedGreeting(businessId: string, greeting: string): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;

  try {
    await client.set(`greeting:${businessId}`, greeting, { ex: 86400 }); // 24 hours
  } catch (error) {
    logger.debug('Greeting cache set failed', { error });
  }
}

// Cache invalidation helpers
export async function invalidateMenuCache(businessId: string): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;

  try {
    await client.del(`menu:${businessId}`);
  } catch (error) {
    logger.debug('Menu cache invalidation failed', { error });
  }
}

export async function invalidateBusinessCache(businessId: string): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;

  try {
    await client.del(`business:${businessId}`);
    await client.del(`greeting:${businessId}`);
  } catch (error) {
    logger.debug('Business cache invalidation failed', { error });
  }
}
