export const SESSION_TIMEOUT_HOURS = 2;
export const MESSAGE_HISTORY_LIMIT = 10;
export const GEMINI_MODEL = 'gemini-2.5-flash';
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
