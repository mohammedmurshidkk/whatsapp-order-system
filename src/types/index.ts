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
  // Distance-based delivery pricing
  free_radius_meters?: number;
  minimum_delivery_charge?: number;
  minimum_charge_distance_meters?: number;
  increment_per_km?: number;
  max_delivery_radius_meters?: number;
  // Road distance calculation
  road_distance_multiplier?: number; // Multiplier for straight-line distance (default 1.3)
  use_road_distance_api?: boolean; // Use Google Maps API for accurate road distance
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

// Business Amenity types (generic amenities like party hall, catering, etc.)
export interface BusinessAmenity {
  id: string;
  business_id: string;
  name: string;           // Display name: "Party Hall", "Catering", etc.
  slug: string;           // For AI matching: "party_hall", "catering"
  description: string;    // Info message to send to customer
  image_url: string | null; // Supabase storage URL (legacy single image)
  images: string[];       // Array of image URLs for multiple images
  is_active: boolean;
  display_order: number;
  created_at: string;
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
  // Operating hours
  opening_time?: string | null; // e.g., "10:00" (24-hour format)
  closing_time?: string | null; // e.g., "22:00" (24-hour format)
  opening_buffer_minutes?: number; // Buffer after opening (default 0)
  closing_buffer_minutes?: number; // Buffer before closing (default 0)
  opening_days?: string[]; // e.g., ["monday", "tuesday", "wednesday", ...]
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
  custom_text_prompt?: string | null; // e.g., "What should we write on the cake?" (expects input)
  category_note?: string | null; // Display-only message (no input expected)
  // Custom weight pricing (e.g., cakes can be ordered in any weight)
  allows_custom_weight?: boolean;
  custom_weight_base_size?: string | null; // e.g., "1kg" - size to use for per-kg rate
  custom_weight_min_grams?: number | null; // e.g., 500 - minimum weight allowed
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
  is_available: boolean;
  image_url?: string | null;  // Menu item photo URL
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
  custom_cake_context?: CustomCakeContext | null; // Pending custom cake inquiry context
  fulfillment_type?: FulfillmentType | null;
  delivery_address?: string | null;
  delivery_geocoded_address?: string | null;
  delivery_latitude?: number | null;
  delivery_longitude?: number | null;
  delivery_time?: string | null;
  pickup_outlet_id?: string | null;
  pickup_time?: string | null;
  fulfillment_notes?: string | null;
  // Beyond radius approval
  delivery_pending_approval?: boolean;
  delivery_approval_status?: 'pending' | 'approved' | 'rejected' | null;
  custom_delivery_fee?: number | null; // Admin-set delivery fee for out-of-radius deliveries
  // i18n: Customer preferred language (ml=Malayalam, en=English)
  language?: 'en' | 'ml';
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
export type MessageDirection = 'inbound' | 'outbound' | 'outgoing';

export interface Message {
  id: string;
  session_id: string;
  direction: MessageDirection;
  content: string;
  created_at: string;
  // Media fields (for images, videos, audio, stickers, documents)
  message_type?: 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'location';
  media_url?: string | null;
  media_mime_type?: string | null;
  media_caption?: string | null;
  media_filename?: string | null;
  media_duration?: number | null;
  media_size?: number | null;
  // Location fields
  latitude?: number | null;
  longitude?: number | null;
}

// Order types
export type OrderStatus = 'confirmed' | 'processing' | 'out_for_delivery' | 'completed' | 'cancelled';

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
  delivery_geocoded_address?: string | null;
  delivery_latitude?: number | null;
  delivery_longitude?: number | null;
  delivery_time?: string | null;
  pickup_outlet_id?: string | null;
  pickup_time?: string | null;
  fulfillment_notes?: string | null;
  delivery_fee?: number;
  updated_at?: string;
  // Delivery boy assignment
  delivery_boy_id?: string | null;
  delivery_assigned_at?: string | null;
  delivery_assigned_by?: string | null;
  delivery_admin_note?: string | null;
}

// Delivery fee calculation result
export interface DeliveryFeeResult {
  fee: number;
  distance_meters: number;
  is_beyond_max_radius: boolean;
  suggested_fee?: number; // Calculated fee for beyond-radius (auto-fill for admin)
}

export interface OrderItemData {
  name: string;
  quantity: number;
  size_or_weight?: string;
  unit_price?: number;
  line_total?: number;
  custom_text?: string;
  custom_text_prompt?: string; // The question asked (from category)
  delivery_date?: string;
  notes?: string;
  addons?: Array<{
    addon_name: string;
    quantity: number;
    unit_price?: number;
    line_total?: number;
  }>;
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
  | 'remove_addon'          // Customer wants to remove an add-on
  | 'continue_ordering'     // Continue after add-ons (ask for more items)
  | 'save_custom_text'      // Save custom text response (e.g., cake message)
  | 'modify_custom_text'    // Customer wants to change cake writing
  | 'remove_custom_text'    // Customer wants to remove cake writing
  | 'custom_cake_inquiry'   // Customer asking about custom/personalized cake design
  | 'confirm_order'         // Final confirmation (step 2 of 2-step checkout)
  | 'cancel'
  | 'cancel_existing_order' // Cancel a confirmed order
  | 'check_order_status'    // Check status of an existing order
  | 'smalltalk'
  | 'show_menu'
  | 'conversation_ended'
  | 'item_not_available'
  | 'amenity_inquiry'        // Customer asking about an amenity (party hall, etc.)
  | 'amenity_booking_request' // Customer wants to book/reserve an amenity
  | 'requires_intervention' // Generic intervention needed (admin attention)
  | 'show_photos';          // Customer wants to see photos of menu items/category

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

export interface AIAmenityResponse {
  amenity_slug: string;      // Which amenity the customer is asking about
  amenity_name?: string;     // Display name (optional, for logging)
}

export interface AIResponse {
  analysis?: Record<string, unknown> | undefined;
  reply: string;
  intent: AIIntent;
  item?: AIItemResponse;
  items?: AIItemResponse[]; // For multiple items with individual notes
  order_id?: string; // For cancel_existing_order intent
  fulfillment?: AIFulfillmentResponse; // For fulfillment info
  addon?: AIAddonResponse; // NEW: For add-on responses
  suggested_addons?: string[]; // NEW: List of addon IDs to suggest
  customText?: string; // For save_custom_text intent (e.g., cake message)
  amenity?: AIAmenityResponse; // For amenity inquiry/booking intents
  photoRequest?: {
    category?: string;    // Category name to show photos for
    item_name?: string;   // Specific item name (optional)
  };
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
  video: any;
  document: any;
  from: string;
  id: string;
  timestamp: string;
  type: string; // 'text' | 'interactive' | 'location' | 'image' | 'audio' | 'voice'
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
  audio?: {
    id: string;
    mime_type: string;
  };
  voice?: {
    id: string;
    mime_type: string;
  };
  sticker?: {
    id: string;
    mime_type: string;
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

// Delivery Boy types
export interface DeliveryBoy {
  id: string;
  business_id: string;
  name: string;
  phone: string;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

// Delivery assignment on orders
export interface DeliveryAssignment {
  delivery_boy_id: string;
  assigned_at: string;
  assigned_by?: string;
  admin_note?: string;
}

// ============================================
// CUSTOM CAKE PRICING TYPES
// ============================================

// Cake flavor size (like MenuItem sizes)
export interface CakeFlavorSize {
  name: string;      // e.g., "500g", "1kg", "2kg"
  price: number;     // price for this size
  is_base: boolean;  // if true, used to calculate custom weights (e.g., 2kg = base * 2)
}

// Combined Flavor + Size pricing (like MenuItem with sizes)
export interface CakeFlavorPricing {
  id: string;
  business_id: string;
  flavor_name: string;
  sizes: CakeFlavorSize[];  // Array of size options with prices
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Grouped format for display (flavor with all its weight options)
// Kept for backward compatibility with AI prompt formatting
export interface CakeFlavorWithWeights {
  flavor_name: string;
  weights: Array<{
    weight_grams: number;
    base_price: number;
    is_base?: boolean;
  }>;
}

export type CakeDesignPriceType = 'fixed' | 'per_unit';

export interface CakeDesignElement {
  id: string;
  business_id: string;
  element_key: string;
  element_label: string;
  price: number;
  price_type: CakeDesignPriceType;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type CakePriceQuoteStatus = 'pending' | 'sent' | 'accepted' | 'cancelled' | 'expired';

export interface CakeAIDetectedElement {
  element_key: string;
  element_label: string;
  quantity: number;
  confidence: number;
  unit_price: number;
  total_price: number;
  notes?: string;
}

export interface CakeAIAnalysis {
  detected_elements: CakeAIDetectedElement[];
  detected_flavor?: string;
  detected_weight_grams?: number;
  tier_count: number;
  complexity_level: 'simple' | 'moderate' | 'elaborate' | 'premium';
  complexity_reasoning: string;
  price_breakdown: {
    base_price: number;           // Combined flavor + weight price
    design_elements_total: number;
    grand_total: number;
  };
  confidence_score: number;
  suggested_message: string;
  warnings: string[];
}

export interface CakePriceQuote {
  final_price: any;
  id: string;
  business_id: string;
  session_id: string | null;
  customer_id: string | null;
  image_url: string | null;
  customer_weight: string | null;
  customer_flavor: string | null;
  ai_analysis: CakeAIAnalysis | null;
  suggested_price: number | null;
  suggested_message: string | null;
  status: CakePriceQuoteStatus;
  admin_final_message: string | null;
  admin_final_price: number | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  accepted_at: string | null;
  // Time confirmation for custom cakes
  requested_delivery_time: string | null;
  requested_fulfillment_type: 'delivery' | 'takeaway' | null;
  time_confirmed: boolean;
  time_confirmed_at: string | null;
  created_at: string;
  expires_at: string;
}

export interface CakePriceQuoteWithCustomer extends CakePriceQuote {
  customer?: {
    id: string;
    name: string | null;
    phone: string;
  };
}

// Business extension for cake pricing
export interface BusinessWithCakePricing extends Business {
  custom_cake_enabled?: boolean;
  custom_cake_auto_send?: boolean;
  custom_cake_quote_expiry_hours?: number;
}

// Standard design element keys (for seeding)
export const STANDARD_CAKE_DESIGN_ELEMENTS: Array<{
  element_key: string;
  element_label: string;
  default_price: number;
  price_type: CakeDesignPriceType;
}> = [
    { element_key: 'extra_tier', element_label: 'Extra Tier', default_price: 500, price_type: 'fixed' },
    { element_key: 'fondant_covering', element_label: 'Fondant Covering', default_price: 300, price_type: 'fixed' },
    { element_key: 'buttercream_finish', element_label: 'Buttercream Finish', default_price: 0, price_type: 'fixed' },
    { element_key: 'fondant_bow', element_label: 'Fondant Bow', default_price: 100, price_type: 'fixed' },
    { element_key: 'crown_topper', element_label: 'Crown/Tiara Topper', default_price: 150, price_type: 'fixed' },
    { element_key: 'doll_topper', element_label: 'Doll/Figurine Topper', default_price: 250, price_type: 'fixed' },
    { element_key: 'number_topper', element_label: 'Number Topper', default_price: 80, price_type: 'fixed' },
    { element_key: 'name_letters', element_label: 'Name Letters', default_price: 30, price_type: 'per_unit' },
    { element_key: 'decorative_spheres', element_label: 'Decorative Spheres/Balls', default_price: 100, price_type: 'fixed' },
    { element_key: 'edible_print', element_label: 'Edible Print', default_price: 200, price_type: 'fixed' },
    { element_key: 'hand_painted', element_label: 'Hand-Painted Details', default_price: 400, price_type: 'fixed' },
    { element_key: 'quilted_pattern', element_label: 'Quilted/Textured Pattern', default_price: 200, price_type: 'fixed' },
    { element_key: 'gold_accents', element_label: 'Gold Accents', default_price: 150, price_type: 'fixed' },
    { element_key: 'silver_accents', element_label: 'Silver Accents', default_price: 150, price_type: 'fixed' },
    { element_key: 'fresh_flowers', element_label: 'Fresh Flowers', default_price: 300, price_type: 'fixed' },
    { element_key: 'chocolate_drizzle', element_label: 'Chocolate Drizzle', default_price: 100, price_type: 'fixed' },
    { element_key: 'macarons', element_label: 'Macarons', default_price: 50, price_type: 'per_unit' },
    { element_key: 'meringue_kisses', element_label: 'Meringue Kisses', default_price: 30, price_type: 'per_unit' },
    { element_key: 'butterfly_decor', element_label: 'Butterfly Decorations', default_price: 80, price_type: 'fixed' },
    { element_key: 'theme_decorations', element_label: 'Theme Decorations', default_price: 200, price_type: 'fixed' },
  ];

// ============================================
// CUSTOM CAKE CONTEXT
// ============================================

export interface CustomCakeContext {
  awaiting_image?: boolean;
  pending_image_id?: string;
  pending_image_timestamp?: string;
  image_url?: string;
  weight?: string;
  flavor?: string;
  inquiry_type?: 'text_first' | 'image_first';
  awaiting_clarification?: boolean;
}

// ============================================
// MENU PDF CONFIG
// ============================================

export interface MenuPdfConfig {
  id: string;
  business_id: string;
  name: string;
  slug: string;
  category_ids: string[];
  pdf_url: string | null;
  is_active: boolean;
  name_en: string | null;
  name_local: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================
// INTERVENTION TYPES
// ============================================

export type InterventionType = 'custom_cake' | 'custom_cake_time_confirmation' | 'urgent_delivery' | 'out_of_radius' | 'party_hall' | 'other';
export type InterventionStatus = 'pending' | 'in_review' | 'resolved' | 'cancelled' | 'expired';

export interface InterventionRequest {
  id: string;
  business_id: string;
  session_id: string;
  customer_id: string;
  type: InterventionType;
  status: InterventionStatus;
  request_data: Record<string, unknown>;
  ai_analysis?: Record<string, unknown>;
  admin_response?: {
    approved: boolean;
    price?: number;
    message?: string;
    notes?: string;
  };
  resolved_by?: string;
  resolved_at?: string;
  created_at: string;
  expires_at?: string;
}
