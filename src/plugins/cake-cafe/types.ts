// src/plugins/food-ordering/types.ts
// Food ordering plugin specific types

export interface FoodOrderingConfig {
  // Business customization
  supportsCakes: boolean;
  supportsCustomWeight: boolean;
  minimumWaitMinutes: number;

  // Fulfillment options
  supportsDelivery: boolean;
  supportsTakeaway: boolean;

  // Feature flags
  enableAddons: boolean;
  enableCustomText: boolean;
  enablePopularItems: boolean;
}

export interface CartItem {
  id: string;
  menuItemId: string;
  name: string;
  quantity: number;
  size?: string;
  unitPrice: number;
  specialInstructions?: string;
  customText?: string;
  deliveryDate?: string;
  addons?: CartItemAddon[];
}

export interface CartItemAddon {
  id: string;
  addonId: string;
  name: string;
  price: number;
  quantity: number;
}

// Food ordering specific intents
export type FoodOrderingIntent =
  | 'add_item'
  | 'modify_order'
  | 'show_menu'
  | 'show_photos'
  | 'show_popular_items'
  | 'item_not_available'
  | 'suggest_addons'
  | 'add_addon'
  | 'decline_addon'
  | 'remove_addon'
  | 'continue_ordering'
  | 'ready_for_checkout'
  | 'confirm_items'
  | 'ask_fulfillment_type'
  | 'collect_delivery_info'
  | 'collect_pickup_info'
  | 'confirm_order'
  | 'cancel'
  | 'cancel_existing_order'
  | 'check_order_status'
  | 'ask_question'
  | 'smalltalk'
  | 'conversation_ended'
  | 'modify_custom_text'
  | 'remove_custom_text'
  | 'custom_cake_inquiry'
  | 'requires_intervention'
  | 'amenity_inquiry'
  | 'amenity_booking_request';

// Custom cake specific types (used in custom cake flow)
export interface CakeQuote {
  id: string;
  sessionId: string;
  imageUrl?: string;
  customerWeight?: string;
  customerFlavor?: string;
  suggestedPrice?: number;
  adminFinalPrice?: number;
  status: 'pending' | 'sent' | 'accepted' | 'rejected';
}
