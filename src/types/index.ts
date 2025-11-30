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
}

export interface MenuItemSize {
  name: string;
  price: number;
}

export interface AddOn {
  id: string;
  business_id: string;
  name: string;
  price: number;
  created_at: string;
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
  add_ons?: AddOn[];
  related_items?: MenuItem[];
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
  ai_paused: boolean; // True when human has taken over
  paused_at: string | null;
  paused_by: string | null; // Who paused (business owner name/id)
}

export interface SessionWithItems extends Session {
  items: SessionItem[];
}

// Data for a selected add-on attached to an order item
export interface OrderItemAddonData {
  name: string;
  price: number;
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
  add_ons?: OrderItemAddonData[] | null;
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
  session_id: string;
  customer_id: string;
  items: OrderItemData[];
  total_items: number;
  total_amount: number;
  order_summary: string;
  status: OrderStatus;
  created_at: string;
  delivery_date: string | null;
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
  add_ons?: OrderItemAddonData[];
}

// AI types
export type AIIntent =
  | 'add_item'
  | 'modify_order'
  | 'ask_question'
  | 'ready_for_checkout'
  | 'confirm_order'
  | 'cancel'
  | 'cancel_existing_order'
  | 'smalltalk'
  | 'show_menu'
  | 'conversation_ended'
  | 'item_not_available';

export interface AIItemResponse {
  name: string;
  quantity: number;
  size_or_weight?: string;
  custom_text?: string;
  delivery_date?: string;
  notes?: string;
  add_ons?: string[]; // Names of add-ons
}

export interface AIResponse {
  reply: string;
  intent: AIIntent;
  item?: AIItemResponse;
  order_id?: string; // For cancel_existing_order intent
}

// WhatsApp webhook types
export interface WhatsAppWebhookMessage {
  from: string;
  id: string;
  timestamp: string;
  text?: {
    body: string;
  };
  type: string;
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
