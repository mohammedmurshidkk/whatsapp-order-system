-- ============================================
-- FRESH INSTALL - Drop all tables and recreate
-- Run this ONLY for new installations
-- ============================================

-- Drop all tables in correct order (reverse of dependencies)
DROP TABLE IF EXISTS session_item_addons CASCADE;
DROP TABLE IF EXISTS category_addons CASCADE;
DROP TABLE IF EXISTS menu_addons CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS session_items CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS menu_items CASCADE;
DROP TABLE IF EXISTS menu_categories CASCADE;
DROP TABLE IF EXISTS business_outlets CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS admin_users CASCADE;
DROP TABLE IF EXISTS super_admins CASCADE;
DROP TABLE IF EXISTS menu_pdf_configs CASCADE;
DROP TABLE IF EXISTS businesses CASCADE;

-- ============================================
-- BUSINESSES TABLE (Multi-tenancy)
-- ============================================
CREATE TABLE businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) UNIQUE NOT NULL,
  address TEXT,
  welcome_message TEXT DEFAULT NULL,
  closing_message TEXT DEFAULT NULL,
  currency VARCHAR(10) DEFAULT '₹',
  is_active BOOLEAN DEFAULT true,
  supports_delivery BOOLEAN DEFAULT true,
  supports_takeaway BOOLEAN DEFAULT true,
  delivery_fee DECIMAL(10, 2) DEFAULT 0,
  free_delivery_above DECIMAL(10, 2),
  delivery_radius_km DECIMAL(5, 2),
  free_radius_meters INTEGER DEFAULT 3000,
  minimum_delivery_charge DECIMAL(10,2) DEFAULT 30,
  minimum_charge_distance_meters INTEGER DEFAULT 6000,
  increment_per_km DECIMAL(10,2) DEFAULT 10,
  max_delivery_radius_meters INTEGER DEFAULT 15000,
  logo_url TEXT,
  custom_ai_prompt TEXT,
  critical_message TEXT,
  critical_message_enabled BOOLEAN DEFAULT false,
  timezone VARCHAR(50) DEFAULT 'Asia/Kolkata',
  minimum_wait_minutes INTEGER DEFAULT 30,
  order_number_prefix VARCHAR(10) DEFAULT 'ORD',
  customer_support_phone VARCHAR(20),
  -- WhatsApp Business API fields (for Tech Provider)
  whatsapp_phone_number VARCHAR(20),
  whatsapp_phone_number_id VARCHAR(50),
  whatsapp_business_account_id VARCHAR(50),
  whatsapp_access_token TEXT,
  whatsapp_webhook_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- ADMIN USERS TABLE
-- ============================================
CREATE TABLE admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'admin',
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_admin_users_email ON admin_users(email);
CREATE INDEX idx_admin_users_business ON admin_users(business_id);

-- Helper function to create admin user with hashed password
CREATE OR REPLACE FUNCTION create_admin_user(
  p_business_id UUID,
  p_email VARCHAR(255),
  p_password VARCHAR(255),
  p_name VARCHAR(255) DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_user_id UUID;
BEGIN
  INSERT INTO admin_users (business_id, email, password_hash, name)
  VALUES (
    p_business_id,
    LOWER(p_email),
    crypt(p_password, gen_salt('bf')),
    p_name
  )
  RETURNING id INTO v_user_id;
  RETURN v_user_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- SUPER ADMINS TABLE (Platform level)
-- ============================================
CREATE TABLE super_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  timezone VARCHAR(50) DEFAULT 'Asia/Kolkata',
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_super_admins_email ON super_admins(email);

-- Helper function to create super admin
CREATE OR REPLACE FUNCTION create_super_admin(
  p_email VARCHAR(255),
  p_password VARCHAR(255),
  p_name VARCHAR(255) DEFAULT NULL,
  p_timezone VARCHAR(50) DEFAULT 'Asia/Kolkata'
) RETURNS UUID AS $$
DECLARE
  v_user_id UUID;
BEGIN
  INSERT INTO super_admins (email, password_hash, name, timezone)
  VALUES (
    LOWER(p_email),
    crypt(p_password, gen_salt('bf')),
    p_name,
    COALESCE(p_timezone, 'Asia/Kolkata')
  )
  RETURNING id INTO v_user_id;
  RETURN v_user_id;
END;
$$ LANGUAGE plpgsql;

-- Seed default super admin (Email: superadmin@system.com, Password: SuperAdmin@123)
SELECT create_super_admin('superadmin@system.com', 'SuperAdmin@123', 'System Admin');

-- ============================================
-- BUSINESS OUTLETS TABLE
-- ============================================
CREATE TABLE business_outlets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  outlet_name VARCHAR(100) NOT NULL,
  address TEXT NOT NULL,
  phone VARCHAR(20),
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  is_active BOOLEAN DEFAULT true,
  display_order INT DEFAULT 0,
  opening_time TEXT,
  closing_time TEXT,
  opening_buffer_minutes INTEGER DEFAULT 0,
  closing_buffer_minutes INTEGER DEFAULT 0,
  opening_days TEXT[],
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_outlets_business ON business_outlets(business_id) WHERE is_active = true;

-- ============================================
-- CUSTOMERS TABLE
-- ============================================
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) NOT NULL,
  name VARCHAR(100),
  business_id UUID REFERENCES businesses(id),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(phone, business_id)
);

CREATE INDEX idx_customers_phone ON customers(phone);

-- ============================================
-- MENU CATEGORIES TABLE
-- ============================================
CREATE TABLE menu_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  image_url TEXT,
  display_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  custom_text_prompt TEXT,
  category_note TEXT,
  allows_custom_weight BOOLEAN DEFAULT false,
  custom_weight_base_size VARCHAR(50),
  custom_weight_min_grams INTEGER DEFAULT 500,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_menu_categories_business ON menu_categories(business_id) WHERE is_active = true;

-- ============================================
-- MENU ITEMS TABLE
-- ============================================
CREATE TABLE menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  category_id UUID REFERENCES menu_categories(id) ON DELETE SET NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  price DECIMAL(10, 2),
  sizes JSONB,
  image_url TEXT,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_menu_items_business ON menu_items(business_id) WHERE is_available = true;
CREATE INDEX idx_menu_items_category ON menu_items(category_id);

-- ============================================
-- MENU ADD-ONS TABLE
-- ============================================
CREATE TABLE menu_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50),
  description TEXT,
  price DECIMAL(10, 2),
  image_url TEXT,
  is_available BOOLEAN DEFAULT true,
  display_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(business_id, name)
);

CREATE INDEX idx_addons_business ON menu_addons(business_id) WHERE is_available = true;
CREATE INDEX idx_addons_category ON menu_addons(category) WHERE is_available = true;

-- ============================================
-- CATEGORY ADD-ONS JUNCTION TABLE
-- ============================================
CREATE TABLE category_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_category_id UUID REFERENCES menu_categories(id) ON DELETE CASCADE,
  addon_id UUID REFERENCES menu_addons(id) ON DELETE CASCADE,
  is_auto_suggested BOOLEAN DEFAULT false,
  suggestion_priority INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(menu_category_id, addon_id)
);

CREATE INDEX idx_category_addons_category ON category_addons(menu_category_id) WHERE is_auto_suggested = true;

-- ============================================
-- SESSIONS TABLE
-- ============================================
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  business_id UUID REFERENCES businesses(id),
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  last_message_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  total_items INT DEFAULT 0,
  ai_paused BOOLEAN DEFAULT false,
  paused_at TIMESTAMP,
  paused_by VARCHAR(100),
  fulfillment_type VARCHAR(20),
  delivery_address TEXT,
  delivery_latitude DECIMAL(10, 8),
  delivery_longitude DECIMAL(11, 8),
  delivery_time TIMESTAMP,
  pickup_outlet_id UUID REFERENCES business_outlets(id),
  pickup_time TIMESTAMP,
  fulfillment_notes TEXT,
  custom_delivery_fee NUMERIC
);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS language VARCHAR(5) DEFAULT 'ml';
COMMENT ON COLUMN sessions.language IS 'Customer preferred language: ml (Malayalam), en (English)';

-- Add custom_cake_context to sessions table
ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS custom_cake_context JSONB DEFAULT NULL;

CREATE INDEX idx_sessions_customer ON sessions(customer_id);
CREATE INDEX idx_sessions_status ON sessions(status, last_message_at);

-- ============================================
-- SESSION ITEMS TABLE
-- ============================================
CREATE TABLE session_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  item_name VARCHAR(200) NOT NULL,
  quantity INT DEFAULT 1,
  size_or_weight VARCHAR(50),
  unit_price DECIMAL(10, 2),
  custom_text TEXT,
  delivery_date DATE,
  notes TEXT,
  ai_raw JSONB,
  item_fulfillment_type VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_session_items_session ON session_items(session_id);

-- ============================================
-- SESSION ITEM ADD-ONS TABLE
-- ============================================
CREATE TABLE session_item_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_item_id UUID REFERENCES session_items(id) ON DELETE CASCADE,
  addon_id UUID REFERENCES menu_addons(id),
  addon_name VARCHAR(100) NOT NULL,
  quantity INT DEFAULT 1,
  unit_price DECIMAL(10, 2),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_session_item_addons_session_item ON session_item_addons(session_item_id);

-- ============================================
-- MESSAGES TABLE
-- direction values:
--   'inbound'  - Customer messages (from WhatsApp)
--   'outbound' - Admin replies (from dashboard)
--   'outgoing' - AI automated responses
-- ============================================
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  direction VARCHAR(10) NOT NULL,
  content TEXT NOT NULL,
  message_type VARCHAR(20) DEFAULT 'text',
  media_url TEXT,
  media_mime_type VARCHAR(100),
  media_caption TEXT,
  media_filename TEXT,
  media_duration INTEGER,
  media_size INTEGER,
  whatsapp_message_id VARCHAR(100),
  status VARCHAR(20) DEFAULT 'sent',
  is_read BOOLEAN DEFAULT false,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_messages_session ON messages(session_id, created_at);
CREATE INDEX idx_messages_whatsapp_id ON messages(whatsapp_message_id);

-- Add index for location queries (optional, for performance)
CREATE INDEX idx_messages_location ON messages (latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- ============================================
-- MEDIA UPLOADS TABLE (for admin uploads before sending)
-- ============================================
CREATE TABLE media_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  file_url TEXT NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size INTEGER NOT NULL,
  duration INTEGER,
  original_filename TEXT,
  whatsapp_media_id VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX idx_media_uploads_business ON media_uploads(business_id);

-- ============================================
-- ORDERS TABLE
-- ============================================
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id),
  customer_id UUID REFERENCES customers(id),
  order_number VARCHAR(50) NOT NULL,
  items JSONB NOT NULL,
  total_items INT,
  total_amount DECIMAL(10, 2),
  order_summary TEXT,
  status VARCHAR(20) DEFAULT 'confirmed',
  created_at TIMESTAMP DEFAULT NOW(),
  delivery_date DATE,
  fulfillment_type VARCHAR(20),
  delivery_address TEXT,
  delivery_latitude DECIMAL(10, 8),
  delivery_longitude DECIMAL(11, 8),
  delivery_time TIMESTAMP,
  pickup_outlet_id UUID REFERENCES business_outlets(id),
  pickup_time TIMESTAMP,
  fulfillment_notes TEXT,
  delivery_fee DECIMAL(10,2) DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_orders_customer ON orders(customer_id, created_at);
CREATE INDEX idx_orders_status ON orders(status, created_at);
CREATE INDEX idx_orders_business ON orders(business_id);
CREATE INDEX idx_orders_order_number ON orders(business_id, order_number);

-- ============================================
-- NOTIFICATIONS TABLE
-- ============================================
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_phone VARCHAR(20),
  image_id VARCHAR(255),
  message TEXT,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_notifications_business_id ON notifications(business_id);
CREATE INDEX idx_notifications_read ON notifications(business_id, read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);

-- ============================================
-- CUSTOM CAKE PRICING TABLES
-- ============================================

-- Add custom cake pricing columns to businesses
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS custom_cake_enabled BOOLEAN DEFAULT false;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS custom_cake_auto_send BOOLEAN DEFAULT false;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS custom_cake_quote_expiry_hours INTEGER DEFAULT 24;

-- Flavor pricing with sizes array (like menu_items)
-- Each size has: { name: "500g", price: 600, is_base: false }
-- The is_base=true size is used to calculate custom weights (e.g., 2kg = base_price * 2)
CREATE TABLE cake_flavor_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  flavor_name VARCHAR(100) NOT NULL,
  sizes JSONB DEFAULT '[]'::jsonb,  -- Array of { name: string, price: number, is_base: boolean }
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(business_id, flavor_name)
);

CREATE INDEX idx_cake_flavor_pricing_business ON cake_flavor_pricing(business_id) WHERE is_active = true;
CREATE INDEX idx_cake_flavor_pricing_flavor ON cake_flavor_pricing(business_id, flavor_name) WHERE is_active = true;

-- Design elements pricing per business
CREATE TABLE cake_design_elements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  element_key VARCHAR(50) NOT NULL,
  element_label VARCHAR(100) NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  price_type VARCHAR(20) DEFAULT 'fixed', -- 'fixed' or 'per_unit'
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(business_id, element_key)
);

CREATE INDEX idx_cake_design_elements_business ON cake_design_elements(business_id) WHERE is_active = true;

-- Price quotes for custom cakes
CREATE TABLE cake_price_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  image_url TEXT,
  customer_weight VARCHAR(50),
  customer_flavor VARCHAR(100),
  ai_analysis JSONB,
  suggested_price DECIMAL(10, 2),
  suggested_message TEXT,
  status VARCHAR(20) DEFAULT 'pending', -- pending, sent, accepted, cancelled, expired
  admin_final_message TEXT,
  admin_final_price DECIMAL(10, 2),
  reviewed_by UUID REFERENCES admin_users(id),
  reviewed_at TIMESTAMP,
  accepted_at TIMESTAMPTZ, -- When customer accepted the quote
  -- Time confirmation for custom cakes
  requested_delivery_time VARCHAR(100),
  requested_fulfillment_type VARCHAR(20), -- delivery or takeaway
  time_confirmed BOOLEAN DEFAULT false,
  time_confirmed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX idx_cake_price_quotes_business ON cake_price_quotes(business_id);
CREATE INDEX idx_cake_price_quotes_session ON cake_price_quotes(session_id);
CREATE INDEX idx_cake_price_quotes_status ON cake_price_quotes(business_id, status);
CREATE INDEX idx_cake_price_quotes_pending ON cake_price_quotes(business_id) WHERE status = 'pending';

  CREATE TABLE business_amenities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT NOT NULL,
    image_url TEXT,
    images TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ,
    UNIQUE(business_id, slug)
  );

  CREATE INDEX idx_business_amenities_business ON business_amenities(business_id);
  CREATE INDEX idx_business_amenities_slug ON business_amenities(business_id, slug);

-- ============================================
-- MENU PDF CONFIGS TABLE
-- ============================================
CREATE TABLE menu_pdf_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,           -- e.g., "Cakes Menu", "Snacks Menu"
  name_en VARCHAR(100),
  name_local VARCHAR(100),
  slug VARCHAR(100) NOT NULL,           -- e.g., "cakes-menu" (for file naming)
  category_ids UUID[] NOT NULL,         -- Array of category IDs
  pdf_url TEXT,                         -- Supabase Storage URL
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id, slug)
);

COMMENT ON COLUMN menu_pdf_configs.name_en IS 'Menu name in English';
COMMENT ON COLUMN menu_pdf_configs.name_local IS 'Menu name in local language (e.g., Malayalam, Hindi)';

CREATE INDEX idx_menu_pdf_configs_business ON menu_pdf_configs(business_id);

-- ============================================
-- DONE
-- ============================================

-- Create admin_intervention_requests table
CREATE TABLE IF NOT EXISTS admin_intervention_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id),
  session_id UUID NOT NULL REFERENCES sessions(id),
  customer_id UUID NOT NULL REFERENCES customers(id),

  -- Intervention type
  type VARCHAR(50) NOT NULL, -- 'custom_cake', 'urgent_delivery', 'out_of_radius', 'party_hall', 'other'

  -- Status lifecycle
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'in_review', 'resolved', 'cancelled', 'expired'

  -- Request details (flexible JSON for different types)
  request_data JSONB NOT NULL,

  -- AI extracted info (if applicable)
  ai_analysis JSONB,

  -- Admin response
  admin_response JSONB,
  resolved_by UUID, -- References admin_users(id) if it existed, but we'll leave it as UUID for now or check if we need to link to auth.users
  resolved_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,

  -- Indexes for quick lookup
  CONSTRAINT fk_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_session FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_intervention_business_status ON admin_intervention_requests(business_id, status);
CREATE INDEX IF NOT EXISTS idx_intervention_session ON admin_intervention_requests(session_id);

-- Add media_id column to messages table for tracking original WhatsApp media IDs
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_id TEXT;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_messages_media_id ON messages(media_id) WHERE media_id IS NOT NULL;

