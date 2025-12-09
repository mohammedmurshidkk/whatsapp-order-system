export const SESSION_TIMEOUT_HOURS = 2;
export const MESSAGE_HISTORY_LIMIT = 10;

// AI Provider Configuration
export const AI_PROVIDER = process.env.AI_PROVIDER || 'GEMINI';
export const GEMINI_MODEL_NAME = process.env.GEMINI_MODEL_NAME || 'gemini-2.5-flash';
export const OPENROUTER_MODEL_NAME = process.env.OPENROUTER_MODEL_NAME || 'anthropic/claude-3-haiku';
export const GROQ_MODEL_NAME = process.env.GROQ_MODEL_NAME || 'llama3-8b-8192';

export const WHATSAPP_API_VERSION = 'v18.0';

// Session status constants
export const SESSION_STATUS = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
  EXPIRED: 'expired',
} as const;

// Order status constants
export const ORDER_STATUS = {
  CONFIRMED: 'confirmed',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

// Message direction constants
export const MESSAGE_DIRECTION = {
  INCOMING: 'incoming',
  OUTGOING: 'outgoing',
} as const;

// Fulfillment type constants
export const FULFILLMENT_TYPE = {
  DELIVERY: 'delivery',
  TAKEAWAY: 'takeaway',
  MIXED: 'mixed',
} as const;

// Add-on category constants
export const ADDON_CATEGORY = {
  CANDLE: 'candle',
  PACKING: 'packing',
  TOPPING: 'topping',
  EXTRA: 'extra',
  BEVERAGE_EXTRA: 'beverage_extra',
} as const;
