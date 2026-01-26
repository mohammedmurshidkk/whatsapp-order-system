// src/plugins/types.ts
// Plugin architecture type definitions

// Re-export types from main types file to avoid duplication
import {
  Session,
  Customer,
  Business,
  Order,
  MenuItem,
  MenuCategory,
  MenuAddon,
  BusinessOutlet,
  SessionItem,
  AIResponse,
  SessionWithItems,
  BusinessAmenity,
} from '../types';

// Re-export for plugin consumers
export type {
  Session,
  Customer,
  Business,
  Order,
  MenuItem,
  MenuCategory,
  MenuAddon,
  BusinessOutlet,
  SessionItem,
  AIResponse,
  SessionWithItems,
  BusinessAmenity,
};

/**
 * Core plugin interface that all business verticals must implement
 */
export interface BusinessPlugin {
  // Identity
  id: string;                  // 'food-ordering', 'appointments', etc.
  name: string;                // 'Food Ordering'
  version: string;             // '1.0.0'

  // AI Configuration
  getSystemPrompt(business: Business, context: PluginPromptContext): string;
  getIntents(): PluginIntent[];

  // Intent Handlers
  handleIntent(
    intent: string,
    context: ConversationContext
  ): Promise<IntentResult>;

  // Lifecycle Hooks (optional)
  onSessionStart?(session: Session): Promise<void>;
  onSessionEnd?(session: Session): Promise<void>;
  onOrderComplete?(order: Order): Promise<void>;

  // Validation
  validateBusinessConfig?(business: Business): ValidationResult;
}

/**
 * Context passed to getSystemPrompt for building AI prompts
 */
export interface PluginPromptContext {
  menu?: MenuItem[];
  categories?: MenuCategory[];
  addons?: MenuAddon[];
  outlets?: BusinessOutlet[];
  cartItems?: SessionItem[];
  session?: Session;
}

/**
 * Intent definition for AI classification
 */
export interface PluginIntent {
  name: string;                // 'add_item'
  description: string;         // 'Customer wants to add item to cart'
  examples: string[];          // ['I want chocolate cake', 'Add 2 coffees']
}

/**
 * Messaging functions passed to intent handlers
 */
export interface MessagingHelpers {
  sendWhatsAppMessage: (to: string, message: string) => Promise<void>;
  sendButtons: (to: string, body: string, buttons: Array<{ id: string; title: string }>) => Promise<void>;
  sendList: (to: string, header: string, body: string, buttonText: string, sections: any[]) => Promise<void>;
  sendLocation: (to: string, body: string) => Promise<void>;
  sendDoc: (to: string, url: string, name: string, caption?: string) => Promise<void>;
  sendImage: (to: string, url: string, caption?: string) => Promise<void>;
  saveOutgoingMessage: (sessionId: string, message: string) => Promise<any>;
  saveIncomingMessage: (sessionId: string, message: string) => Promise<any>;
}

/**
 * Full context passed to intent handlers
 */
export interface ConversationContext {
  // Core entities
  session: Session;
  sessionWithItems: SessionWithItems;
  customer: Customer;
  business: Business;

  // Message data
  message: string;
  originalMessage: string;
  aiResponse: AIResponse;
  language: string;

  // Phone for messaging
  phone: string;
  businessTimezone: string;
  isFirstMessage: boolean;

  // Menu & content
  menu: MenuItem[];
  categories: MenuCategory[];
  addons: MenuAddon[];
  outlets: BusinessOutlet[];
  cartItems: SessionItem[];
  amenities: BusinessAmenity[];
  activeOrder: Order | null;

  // Messaging helpers
  messaging: MessagingHelpers;
}

/**
 * Result returned by intent handlers
 */
export interface IntentResult {
  response: string;            // Message to send to customer
  shouldEnd?: boolean;         // End conversation?
  updateSession?: Partial<SessionUpdate>;
  createOrder?: boolean;
  skipResponse?: boolean;      // Don't send response (already sent)
}

/**
 * Session update fields that handlers can modify
 */
export interface SessionUpdate {
  status: string;
  fulfillment_type: string;
  delivery_address: string;
  delivery_time: string;
  pickup_outlet_id: string;
  pickup_time: string;
  ai_paused: boolean;
  ai_paused_reason: string;
}

/**
 * Validation result for business configuration
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
