// Business types (for SaaS multi-tenancy)
export interface Business {
  id: string;
  name: string;
  phone: string;
  address: string | null;
  welcome_message: string;
  closing_message: string;
  currency: string;
  is_active: boolean;
  created_at: string;
  supports_delivery?: boolean;
  supports_takeaway?: boolean;
  delivery_fee?: number;
  free_delivery_above?: number;
  delivery_radius_km?: number;
  minimum_wait_minutes?: number; // Minimum wait time for orders (no ASAP)
  // Custom AI behavior
  custom_ai_prompt?: string | null; // Business-specific AI instructions
  critical_message?: string | null; // Message to send instead of AI (emergencies)
  critical_message_enabled?: boolean; // When true, send critical_message instead of AI
  // Order numbering
  order_number_prefix?: string | null; // e.g., "OKS" -> "OKS-1", "OKS-2"
  // Customer support
  customer_support_phone?: string | null; // Fallback phone number for customer support
  // Timezone for date/time display (IANA timezone, e.g., 'Asia/Kolkata')
  timezone?: string;
  updated_at?: string;
}

// Outlet types
export interface BusinessOutlet {
  id: string;
  business_id: string;
  outlet_name: string;
  address: string;
  phone: string | null;
  latitude?: number | null;
  longitude?: number | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at?: string;
}

// Fulfillment types (one order = one type, no mixing)
export type FulfillmentType = 'delivery' | 'takeaway';

// Add-on types
export interface MenuAddon {
  id: string;
  business_id: string;
  name: string;
  category: string; // 'candle', 'packing', 'topping', 'extra', etc.
  description: string | null;
  price: number | null; // NULL = free
  is_available: boolean;
  display_order: number;
  created_at: string;
  updated_at?: string;
}

export interface CategoryAddon {
  id: string;
  menu_category_id: string;
  addon_id: string;
  is_auto_suggested: boolean;
  suggestion_priority: number;
  created_at: string;
  addon?: MenuAddon; // Populated via join
}

export interface SessionItemAddon {
  id: string;
  session_item_id: string;
  addon_id: string;
  addon_name: string;
  quantity: number;
  unit_price: number | null;
  created_at: string;
}

// Menu types
export interface MenuCategory {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
  custom_text_prompt?: string | null; // e.g., "What should we write on the cake?"
}

export interface MenuItemSize {
  name: string;
  price: number;
}

export interface MenuItem {
  id: string;
  business_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: number | null;
  sizes: MenuItemSize[] | null;
  is_customizable: boolean;
  requires_date: boolean;
  is_available: boolean;
  special_notes: string | null;
  created_at: string;
  category?: MenuCategory;
}

// Customer types
export interface Customer {
  id: string;
  phone: string;
  name: string | null;
  business_id: string | null;
  created_at: string;
}

// Session types
export type SessionStatus = 'active' | 'completed' | 'expired';

export interface Session {
  id: string;
  customer_id: string;
  business_id: string | null;
  status: SessionStatus;
  created_at: string;
  last_message_at: string;
  completed_at: string | null;
  total_items: number;
  ai_paused: boolean;  // True when human has taken over
  paused_at: string | null;
  paused_by: string | null;  // Who paused (business owner name/id)
  fulfillment_type?: FulfillmentType | null;
  delivery_address?: string | null;
  delivery_latitude?: number | null;
  delivery_longitude?: number | null;
  delivery_time?: string | null;
  pickup_outlet_id?: string | null;
  pickup_time?: string | null;
  fulfillment_notes?: string | null;
}

export interface SessionWithItems extends Session {
  items: SessionItem[];
}

// Session item types
export interface SessionItem {
  id: string;
  session_id: string;
  item_name: string;
  quantity: number;
  size_or_weight: string | null;
  unit_price: number | null;
  custom_text: string | null;
  delivery_date: string | null;
  notes: string | null;
  ai_raw: Record<string, unknown> | null;
  created_at: string;
  item_fulfillment_type?: 'delivery' | 'takeaway' | null; // For mixed orders
  addons?: SessionItemAddon[]; // Add-ons for this item
}

// Message types
export type MessageDirection = 'incoming' | 'outgoing';

export interface Message {
  id: string;
  session_id: string;
  direction: MessageDirection;
  content: string;
  created_at: string;
}

// Order types
export type OrderStatus = 'confirmed' | 'processing' | 'completed' | 'cancelled';

export interface Order {
  id: string;
  order_number: string; // User-friendly order ID (e.g., "OKS-1")
  business_id: string;
  session_id: string;
  customer_id: string;
  items: OrderItemData[];
  total_items: number;
  total_amount: number;
  order_summary: string;
  status: OrderStatus;
  created_at: string;
  delivery_date: string | null;
  fulfillment_type?: FulfillmentType | null;
  delivery_address?: string | null;
  delivery_latitude?: number | null;
  delivery_longitude?: number | null;
  delivery_time?: string | null;
  pickup_outlet_id?: string | null;
  pickup_time?: string | null;
  fulfillment_notes?: string | null;
  updated_at?: string;
}

export interface OrderItemData {
  name: string;
  quantity: number;
  size_or_weight?: string;
  unit_price?: number;
  line_total?: number;
  custom_text?: string;
  delivery_date?: string;
  notes?: string;
  addons?: Array<{
    addon_name: string;
    quantity: number;
    unit_price?: number;
    line_total?: number;
  }>; // NEW: Add-ons for this item
}

// AI types
export type AIIntent =
  | 'add_item'
  | 'modify_order'
  | 'ask_question'
  | 'ready_for_checkout'
  | 'confirm_items'         // NEW: Customer confirms items in cart (step 1 of 2-step checkout)
  | 'ask_fulfillment_type'  // Ask delivery or takeaway
  | 'collect_delivery_info' // Collecting delivery address/time
  | 'collect_pickup_info'   // Collecting pickup outlet/time
  | 'suggest_addons'        // Suggest add-ons for item
  | 'add_addon'             // Customer wants to add an add-on
  | 'decline_addon'         // Customer declines add-on
  | 'continue_ordering'     // Continue after add-ons (ask for more items)
  | 'save_custom_text'      // Save custom text response (e.g., cake message)
  | 'confirm_order'         // Final confirmation (step 2 of 2-step checkout)
  | 'cancel'
  | 'cancel_existing_order' // Cancel a confirmed order
  | 'check_order_status'    // Check status of an existing order
  | 'smalltalk'
  | 'show_menu'
  | 'conversation_ended'
  | 'item_not_available';

export interface AIAddonResponse {
  addon_id?: string;
  addon_name: string;
  quantity?: number;
}

export interface AIItemResponse {
  name: string;
  quantity: number;
  size_or_weight?: string;
  custom_text?: string;
  delivery_date?: string;
  notes?: string;
  addons?: AIAddonResponse[]; // NEW: Add-ons for this item
}

export interface AIFulfillmentResponse {
  fulfillment_type?: 'delivery' | 'takeaway';
  delivery_address?: string;
  delivery_time?: string;
  pickup_outlet_id?: string;
  pickup_time?: string;
  fulfillment_notes?: string;
}

export interface AIResponse {
  reply: string;
  intent: AIIntent;
  item?: AIItemResponse;
  order_id?: string; // For cancel_existing_order intent
  fulfillment?: AIFulfillmentResponse; // For fulfillment info
  addon?: AIAddonResponse; // NEW: For add-on responses
  suggested_addons?: string[]; // NEW: List of addon IDs to suggest
  customText?: string; // For save_custom_text intent (e.g., cake message)
}

// Notification types (for admin alerts)
export interface Notification {
  id: string;
  business_id: string;
  type: string; // 'customer_image', 'customer_inquiry', etc.
  customer_id: string | null;
  customer_phone: string | null;
  image_id: string | null;
  message: string | null;
  read: boolean;
  created_at: string;
}

// WhatsApp webhook types
export interface WhatsAppWebhookMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string; // 'text' | 'interactive' | 'location' | 'image'
  text?: {
    body: string;
  };
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: {
      id: string;
      title: string;
    };
    list_reply?: {
      id: string;
      title: string;
      description?: string;
    };
  };
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  image?: {
    id: string;
    mime_type: string;
    sha256: string;
    caption?: string;
  };
}

export interface WhatsAppWebhookEntry {
  id: string;
  changes: Array<{
    value: {
      messaging_product: string;
      metadata: {
        display_phone_number: string;
        phone_number_id: string;
      };
      contacts?: Array<{
        profile: {
          name: string;
        };
        wa_id: string;
      }>;
      messages?: WhatsAppWebhookMessage[];
    };
    field: string;
  }>;
}

export interface WhatsAppWebhookBody {
  object: string;
  entry: WhatsAppWebhookEntry[];
}

// Request types
export interface TestMessageRequest {
  phone: string;
  message: string;
}
