/**
 * Intent Handler Types
 *
 * Strategy pattern infrastructure for handling AI intents.
 * Each intent maps to a handler function that processes the intent.
 */

import {
  Business,
  BusinessOutlet,
  Customer,
  Session,
  SessionWithItems,
  SessionItem,
  MenuItem,
  MenuCategory,
  MenuAddon,
  BusinessAmenity,
  AIResponse,
  AIIntent,
  Order,
  Message,
} from '../../types';
import { SupportedLanguage } from '../../i18n';

/**
 * Shared context available to all intent handlers.
 * Built once at the start of processMessage and passed to handlers.
 */
export interface IntentContext {
  // Business & Customer
  phone: string;
  businessId: string;
  business: Business | null;
  customer: Customer;
  session: Session;
  lang: SupportedLanguage;

  // Session State
  sessionWithItems: SessionWithItems;
  existingItems: SessionItem[];
  outlets: BusinessOutlet[];
  activeOrder: Order | null;

  // Menu & Content
  menuItems: MenuItem[];
  menuCategories: MenuCategory[];
  amenities: BusinessAmenity[];

  // Message Data
  messageText: string;
  originalMessage: string;
  businessTimezone: string;
  isFirstMessage: boolean;

  // Messaging Helpers (pre-bound with businessId)
  sendWhatsAppMessage: (phone: string, message: string) => Promise<void>;
  sendButtons: (phone: string, body: string, buttons: Array<{ id: string; title: string }>) => Promise<void>;
  sendList: (phone: string, header: string, body: string, buttonText: string, sections: any[]) => Promise<void>;
  sendLocation: (phone: string, body: string) => Promise<void>;
  sendDoc: (phone: string, url: string, name: string, caption?: string) => Promise<void>;
  sendImage: (phone: string, url: string, caption?: string) => Promise<void>;

  // Message Persistence
  saveOutgoingMessage: (sessionId: string, message: string) => Promise<Message>;
  saveIncomingMessage: (sessionId: string, message: string) => Promise<Message>;
}

/**
 * Result returned by intent handlers.
 */
export interface IntentResult {
  /**
   * Reply message to send to customer.
   * If null, handler already sent a custom message (buttons, list, etc.)
   */
  reply: string | null;

  /**
   * If true, the handler already saved the outgoing message.
   * Prevents double-saving in webhookController.
   */
  messageSaved?: boolean;
}

/**
 * Intent Handler interface.
 * All intent handlers must implement this interface.
 */
export interface IntentHandler {
  /**
   * Handle the intent and return a result.
   *
   * @param ctx - Shared context with session, business, messaging helpers
   * @param aiResponse - AI response containing intent, items, fulfillment data
   * @returns IntentResult with reply message or null if custom message sent
   */
  handle(ctx: IntentContext, aiResponse: AIResponse): Promise<IntentResult>;
}

/**
 * Handler function type (for simple handlers that don't need a class)
 */
export type IntentHandlerFn = (ctx: IntentContext, aiResponse: AIResponse) => Promise<IntentResult>;

/**
 * Registry entry - can be either a handler instance or a function
 */
export type HandlerEntry = IntentHandler | IntentHandlerFn;

/**
 * Intent handler registry type
 */
export type IntentHandlerRegistry = Partial<Record<AIIntent, HandlerEntry>>;
