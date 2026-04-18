import { logger } from '../utils/logger';
import { Business, Session } from '../types';

export interface SessionState {
  hasActiveCart: boolean;
  awaitingConfirmation: boolean;
  fulfillmentType?: 'delivery' | 'takeaway' | null;
  hasPendingCustomText?: boolean;
  hasPendingAddon?: boolean;
  aiPaused?: boolean;
}

export interface ClassifiedIntent {
  tier: 0 | 1 | 2 | 3 | 4;
  intent: string;
  cachedResponse?: string;
  relevantData?: any;
  skipAI: boolean;
}

// Tier 0: No AI needed - cached/template responses
const GREETING_PATTERNS = /^(hi|hello|hey|hai|hlo|hii|good\s*morning|good\s*evening|good\s*afternoon|good\s*night|namaskaram|namaste|vanakkam|namaskar|helo|hallo)\s*[!.?]*$/i;
const CONFIRMATION_PATTERNS = /^(yes|yeah|yep|yup|ok|okay|sure|athe|sheri|sheriyanu|confirm|aam|sari|angane|ho|haa|haan|ji|han)\s*[!.?]*$/i;
const CANCELLATION_PATTERNS = /^(no|nope|nah|venda|cancel|exit|quit|stop|alla|venda|illai|vend|bye|quit)\s*[!.?]*$/i;
const THANKS_PATTERNS = /^(thanks|thank\s*you|ty|thanku|nanni|dhanyavad|shukriya)\s*[!.?]*$/i;

// Tier 1: DB lookup - no AI needed
const BUSINESS_HOURS_PATTERNS = /\b(time|hour|open|close|timing|when|samayam|eppol|evide|what\s*time|opening|closing|timings?|schedule)\b/i;
const LOCATION_PATTERNS = /\b(where|location|address|sthanam|evide|direction|map|directions|located|place|area|branch)\b/i;
const DELIVERY_INFO_PATTERNS = /\b(delivery\s*(charge|fee|cost|area|time|available)?|free\s*delivery|vilavasam|deliver|shipping)\b/i;
const SHOW_MENU_PATTERNS = /^(menu|show\s*menu|what.*have|items|enna.*undo|menu.*kanikku|list|products|what\s*do\s*you\s*have|available\s*items?)\s*[!.?]*$/i;
const ORDER_STATUS_PATTERNS = /\b(order\s*(status)?|where.*order|ente.*order|en.*order|track|tracking|my\s*order|order\s*id)\b/i;

// Tier 3: Complex - needs full AI context
const CUSTOM_CAKE_PATTERNS = /\b(custom|design|photo.*cake|fondant|theme|personalized|special\s*design|customized|decorated|shaped|3d|figure|character)\b/i;
const COMPLAINT_PATTERNS = /\b(complaint|complain|problem|issue|wrong|mistake|bad|terrible|horrible|worst|refund|money\s*back|manager|disappointed)\b/i;
const SPECIAL_REQUEST_PATTERNS = /\b(special|allergy|allergic|dietary|vegan|gluten\s*free|sugar\s*free|eggless|without\s*egg|nut\s*free|lactose)\b/i;

// Tier 4: Human handoff patterns
const HUMAN_PATTERNS = /\b(human|person|agent|manager|owner|staff|talk\s*to\s*(someone|a\s*person)|real\s*person|not\s*a\s*bot)\b/i;

export function classifyIntent(
  message: string,
  sessionState: SessionState,
  business: Business | null
): ClassifiedIntent {
  const trimmed = message.trim();
  const lowered = trimmed.toLowerCase();

  // Check for AI paused state first
  if (sessionState.aiPaused) {
    return {
      tier: 4,
      intent: 'ai_paused',
      skipAI: true,
    };
  }

  // Check for pending states that need special handling
  if (sessionState.hasPendingCustomText || sessionState.hasPendingAddon) {
    return {
      tier: 2,
      intent: 'pending_response',
      skipAI: false,
    };
  }

  // TIER 0: Simple greetings (no cart)
  if (GREETING_PATTERNS.test(lowered) && !sessionState.hasActiveCart) {
    const greeting = business?.greeting_template ||
      `Welcome to ${business?.name || 'our store'}! How can I help you today?`;

    logger.debug('Intent classified: tier=0, intent=greeting');
    return {
      tier: 0,
      intent: 'greeting',
      cachedResponse: greeting,
      skipAI: true,
    };
  }

  // TIER 0: Simple confirmations when awaiting confirmation
  if (CONFIRMATION_PATTERNS.test(lowered) && sessionState.awaitingConfirmation) {
    logger.debug('Intent classified: tier=0, intent=confirm_order');
    return {
      tier: 0,
      intent: 'confirm_order',
      skipAI: false, // Still needs handler but not full AI
    };
  }

  // TIER 0: Simple cancellations
  if (CANCELLATION_PATTERNS.test(lowered)) {
    logger.debug('Intent classified: tier=0, intent=cancel');
    return {
      tier: 0,
      intent: 'cancel',
      skipAI: false, // Needs handler
    };
  }

  // TIER 0: Thanks (farewell)
  if (THANKS_PATTERNS.test(lowered) && !sessionState.hasActiveCart) {
    const farewell = business?.farewell_template ||
      'Thank you! Have a great day!';

    logger.debug('Intent classified: tier=0, intent=farewell');
    return {
      tier: 0,
      intent: 'farewell',
      cachedResponse: farewell,
      skipAI: true,
    };
  }

  // TIER 4: Human handoff request
  if (HUMAN_PATTERNS.test(lowered)) {
    logger.debug('Intent classified: tier=4, intent=human_handoff');
    return {
      tier: 4,
      intent: 'requires_intervention',
      skipAI: false,
    };
  }

  // TIER 3: Complex queries - needs full AI
  if (CUSTOM_CAKE_PATTERNS.test(lowered)) {
    logger.debug('Intent classified: tier=3, intent=custom_cake_inquiry');
    return {
      tier: 3,
      intent: 'custom_cake_inquiry',
      skipAI: false,
    };
  }

  if (COMPLAINT_PATTERNS.test(lowered)) {
    logger.debug('Intent classified: tier=3, intent=complaint');
    return {
      tier: 3,
      intent: 'requires_intervention',
      skipAI: false,
    };
  }

  if (SPECIAL_REQUEST_PATTERNS.test(lowered)) {
    logger.debug('Intent classified: tier=3, intent=special_request');
    return {
      tier: 3,
      intent: 'special_request',
      skipAI: false,
    };
  }

  // TIER 1: FAQ - Business hours (no cart)
  if (BUSINESS_HOURS_PATTERNS.test(lowered) && !sessionState.hasActiveCart) {
    logger.debug('Intent classified: tier=1, intent=business_hours');
    return {
      tier: 1,
      intent: 'business_hours',
      skipAI: true,
    };
  }

  // TIER 1: Location inquiry
  if (LOCATION_PATTERNS.test(lowered) && !sessionState.hasActiveCart && !DELIVERY_INFO_PATTERNS.test(lowered)) {
    logger.debug('Intent classified: tier=1, intent=location');
    return {
      tier: 1,
      intent: 'location',
      skipAI: true,
    };
  }

  // TIER 1: Delivery info
  if (DELIVERY_INFO_PATTERNS.test(lowered) && !sessionState.hasActiveCart) {
    logger.debug('Intent classified: tier=1, intent=delivery_info');
    return {
      tier: 1,
      intent: 'delivery_info',
      skipAI: true,
    };
  }

  // TIER 1: Show menu
  if (SHOW_MENU_PATTERNS.test(lowered)) {
    logger.debug('Intent classified: tier=1, intent=show_menu');
    return {
      tier: 1,
      intent: 'show_menu',
      skipAI: false, // Needs menu handler
    };
  }

  // TIER 1: Order status
  if (ORDER_STATUS_PATTERNS.test(lowered)) {
    logger.debug('Intent classified: tier=1, intent=order_status');
    return {
      tier: 1,
      intent: 'check_order_status',
      skipAI: false, // Needs DB lookup + handler
    };
  }

  // TIER 2: Default - needs AI with optimized context
  logger.debug('Intent classified: tier=2, intent=needs_ai');
  return {
    tier: 2,
    intent: 'needs_ai',
    skipAI: false,
  };
}

// Helper to build session state from session object
export function buildSessionState(
  session: Session | null,
  cartItems: any[],
  fulfillmentComplete: boolean = false
): SessionState {
  return {
    hasActiveCart: cartItems && cartItems.length > 0,
    awaitingConfirmation: fulfillmentComplete && cartItems && cartItems.length > 0,
    fulfillmentType: session?.fulfillment_type || null,
    hasPendingCustomText: !!session?.pending_state?.pendingCustomText,
    hasPendingAddon: !!session?.pending_state?.pendingAddonSelection,
    aiPaused: !!session?.ai_paused,
  };
}

// Tier usage logging for cost tracking
export function logTierUsage(
  tier: number,
  intent: string,
  aiCalled: boolean,
  businessId?: string
): void {
  logger.info(`Message handled: tier=${tier}, intent=${intent}, ai_called=${aiCalled}`, {
    tier,
    intent,
    aiCalled,
    businessId,
  });
}
