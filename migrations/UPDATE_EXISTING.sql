-- ============================================
-- UPDATE EXISTING - Add missing tables/columns
-- Safe to run on existing databases
-- ============================================

-- Add columns to businesses if they don't exist
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS supports_delivery BOOLEAN DEFAULT true;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS supports_takeaway BOOLEAN DEFAULT true;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS delivery_fee DECIMAL(10, 2) DEFAULT 0;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS free_delivery_above DECIMAL(10, 2);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS delivery_radius_km DECIMAL(5, 2);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS custom_ai_prompt TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS critical_message TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS critical_message_enabled BOOLEAN DEFAULT false;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'Asia/Kolkata';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS minimum_wait_minutes INTEGER DEFAULT 30;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS order_number_prefix VARCHAR(10) DEFAULT 'ORD';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS customer_support_phone VARCHAR(20);

-- WhatsApp Business API fields (for Tech Provider)
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS whatsapp_phone_number VARCHAR(20);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id VARCHAR(50);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS whatsapp_business_account_id VARCHAR(50);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS whatsapp_access_token TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS whatsapp_webhook_verified BOOLEAN DEFAULT false;

-- Add image URLs to menu tables
ALTER TABLE menu_categories ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE menu_addons ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Add custom_text_prompt to menu_categories (e.g., "What should we write on the cake?")
ALTER TABLE menu_categories ADD COLUMN IF NOT EXISTS custom_text_prompt TEXT;
-- Add category_note for display-only messages (no input expected)
ALTER TABLE menu_categories ADD COLUMN IF NOT EXISTS category_note TEXT;

-- Custom weight pricing for categories (e.g., Cakes can be ordered in any weight)
ALTER TABLE menu_categories ADD COLUMN IF NOT EXISTS allows_custom_weight BOOLEAN DEFAULT false;
ALTER TABLE menu_categories ADD COLUMN IF NOT EXISTS custom_weight_base_size VARCHAR(50);
ALTER TABLE menu_categories ADD COLUMN IF NOT EXISTS custom_weight_min_grams INTEGER;

-- Create business_outlets if not exists
CREATE TABLE IF NOT EXISTS business_outlets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  outlet_name VARCHAR(100) NOT NULL,
  address TEXT NOT NULL,
  phone VARCHAR(20),
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  is_active BOOLEAN DEFAULT true,
  display_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outlets_business ON business_outlets(business_id) WHERE is_active = true;

-- Add fulfillment columns to sessions
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS fulfillment_type VARCHAR(20);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS delivery_address TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS delivery_latitude DECIMAL(10, 8);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS delivery_longitude DECIMAL(11, 8);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS delivery_time TIMESTAMP;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS pickup_outlet_id UUID REFERENCES business_outlets(id);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS pickup_time TIMESTAMP;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS fulfillment_notes TEXT;

-- Add item_fulfillment_type to session_items
ALTER TABLE session_items ADD COLUMN IF NOT EXISTS item_fulfillment_type VARCHAR(20);

-- Add fulfillment columns to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_type VARCHAR(20);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_latitude DECIMAL(10, 8);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_longitude DECIMAL(11, 8);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_time TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_outlet_id UUID REFERENCES business_outlets(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_time TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_notes TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Add business_id and order_number to orders (CRITICAL for multi-tenancy)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_orders_business ON orders(business_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(business_id, order_number);

-- Create menu_addons table
CREATE TABLE IF NOT EXISTS menu_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50),
  description TEXT,
  price DECIMAL(10, 2),
  is_available BOOLEAN DEFAULT true,
  display_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add unique constraint if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'menu_addons_business_id_name_key'
  ) THEN
    ALTER TABLE menu_addons ADD CONSTRAINT menu_addons_business_id_name_key UNIQUE (business_id, name);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_addons_business ON menu_addons(business_id) WHERE is_available = true;
CREATE INDEX IF NOT EXISTS idx_addons_category ON menu_addons(category) WHERE is_available = true;

-- Create category_addons junction table
CREATE TABLE IF NOT EXISTS category_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_category_id UUID REFERENCES menu_categories(id) ON DELETE CASCADE,
  addon_id UUID REFERENCES menu_addons(id) ON DELETE CASCADE,
  is_auto_suggested BOOLEAN DEFAULT false,
  suggestion_priority INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(menu_category_id, addon_id)
);

CREATE INDEX IF NOT EXISTS idx_category_addons_category ON category_addons(menu_category_id) WHERE is_auto_suggested = true;

-- Create session_item_addons table
CREATE TABLE IF NOT EXISTS session_item_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_item_id UUID REFERENCES session_items(id) ON DELETE CASCADE,
  addon_id UUID REFERENCES menu_addons(id),
  addon_name VARCHAR(100) NOT NULL,
  quantity INT DEFAULT 1,
  unit_price DECIMAL(10, 2),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_item_addons_session_item ON session_item_addons(session_item_id);

-- ============================================
-- Admin Users Table
-- ============================================
CREATE TABLE IF NOT EXISTS admin_users (
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

CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);
CREATE INDEX IF NOT EXISTS idx_admin_users_business ON admin_users(business_id);

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
-- Super Admins Table (Platform level)
-- ============================================
CREATE TABLE IF NOT EXISTS super_admins (
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

-- Add timezone column to super_admins if it doesn't exist
ALTER TABLE super_admins ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'Asia/Kolkata';

CREATE INDEX IF NOT EXISTS idx_super_admins_email ON super_admins(email);

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

-- Seed default super admin if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM super_admins WHERE email = 'superadmin@system.com') THEN
    PERFORM create_super_admin('superadmin@system.com', 'SuperAdmin@123', 'System Admin');
  END IF;
END $$;

-- ============================================
-- NOTIFICATIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  customer_id UUID,
  customer_phone VARCHAR(20),
  image_id VARCHAR(255),
  message TEXT,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_business_id ON notifications(business_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(business_id, read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- ============================================
-- MESSAGES TABLE - Add media columns
-- ============================================
ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type VARCHAR(20) DEFAULT 'text';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_mime_type VARCHAR(100);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_caption TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_filename TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_duration INTEGER;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_size INTEGER;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS whatsapp_message_id VARCHAR(100);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'sent';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_messages_whatsapp_id ON messages(whatsapp_message_id);

-- ============================================
-- MEDIA UPLOADS TABLE (for admin uploads before sending)
-- ============================================
CREATE TABLE IF NOT EXISTS media_uploads (
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

CREATE INDEX IF NOT EXISTS idx_media_uploads_business ON media_uploads(business_id);

-- ============================================
-- FIX MESSAGE DIRECTION VALUES
-- Migrate from 2-value system to 3-value system:
-- 'incoming' -> 'inbound' (customer messages)
-- 'outgoing' stays 'outgoing' (AI messages)
-- 'outbound' for admin replies (new)
-- ============================================
UPDATE messages SET direction = 'inbound' WHERE direction = 'incoming';

-- ============================================
-- CUSTOM CAKE PRICING TABLES
-- ============================================

-- Add custom cake pricing columns to businesses
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS custom_cake_enabled BOOLEAN DEFAULT false;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS custom_cake_auto_send BOOLEAN DEFAULT false;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS custom_cake_quote_expiry_hours INTEGER DEFAULT 24;

-- Weight-based pricing per business
CREATE TABLE IF NOT EXISTS cake_weight_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  weight_grams INTEGER NOT NULL,
  base_price DECIMAL(10, 2) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(business_id, weight_grams)
);

CREATE INDEX IF NOT EXISTS idx_cake_weight_pricing_business ON cake_weight_pricing(business_id) WHERE is_active = true;

-- Flavor pricing per business
CREATE TABLE IF NOT EXISTS cake_flavor_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  flavor_name VARCHAR(100) NOT NULL,
  additional_price DECIMAL(10, 2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(business_id, flavor_name)
);

CREATE INDEX IF NOT EXISTS idx_cake_flavor_pricing_business ON cake_flavor_pricing(business_id) WHERE is_active = true;

-- Design elements pricing per business
CREATE TABLE IF NOT EXISTS cake_design_elements (
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

CREATE INDEX IF NOT EXISTS idx_cake_design_elements_business ON cake_design_elements(business_id) WHERE is_active = true;

-- Price quotes for custom cakes
CREATE TABLE IF NOT EXISTS cake_price_quotes (
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
  status VARCHAR(20) DEFAULT 'pending', -- pending, sent, cancelled, expired
  admin_final_message TEXT,
  admin_final_price DECIMAL(10, 2),
  reviewed_by UUID REFERENCES admin_users(id),
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX IF NOT EXISTS idx_cake_price_quotes_business ON cake_price_quotes(business_id);
CREATE INDEX IF NOT EXISTS idx_cake_price_quotes_session ON cake_price_quotes(session_id);
CREATE INDEX IF NOT EXISTS idx_cake_price_quotes_status ON cake_price_quotes(business_id, status);
CREATE INDEX IF NOT EXISTS idx_cake_price_quotes_pending ON cake_price_quotes(business_id) WHERE status = 'pending';

-- ============================================
-- DONE
-- ============================================
