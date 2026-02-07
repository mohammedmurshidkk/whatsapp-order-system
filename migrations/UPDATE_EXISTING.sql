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

-- Distance-based delivery pricing columns for businesses
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS free_radius_meters INTEGER DEFAULT 3000;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS minimum_delivery_charge DECIMAL(10,2) DEFAULT 30;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS minimum_charge_distance_meters INTEGER DEFAULT 6000;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS increment_per_km DECIMAL(10,2) DEFAULT 10;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS max_delivery_radius_meters INTEGER DEFAULT 15000;

ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS road_distance_multiplier DECIMAL(3,2) DEFAULT 1.3,
ADD COLUMN IF NOT EXISTS use_road_distance_api BOOLEAN DEFAULT false;

-- Plugin architecture
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS plugin_id VARCHAR(50) DEFAULT 'cake-cafe';

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
  printer_ip VARCHAR(45) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE business_outlets ADD COLUMN IF NOT EXISTS opening_time TEXT;
ALTER TABLE business_outlets ADD COLUMN IF NOT EXISTS closing_time TEXT;
ALTER TABLE business_outlets ADD COLUMN IF NOT EXISTS opening_buffer_minutes INTEGER DEFAULT 0;
ALTER TABLE business_outlets ADD COLUMN IF NOT EXISTS closing_buffer_minutes INTEGER DEFAULT 0;
ALTER TABLE business_outlets ADD COLUMN IF NOT EXISTS opening_days TEXT[];

-- Add printer_ip column to business_outlets for thermal printer support
ALTER TABLE business_outlets
ADD COLUMN IF NOT EXISTS printer_ip VARCHAR(45) DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN business_outlets.printer_ip IS 'IP address of thermal printer for this outlet (e.g., 192.168.18.195)';

CREATE INDEX IF NOT EXISTS idx_outlets_business ON business_outlets(business_id) WHERE is_active = true;

-- Add fulfillment columns to sessions
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS fulfillment_type VARCHAR(20);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS delivery_address TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS delivery_geocoded_address TEXT;
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
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_geocoded_address TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_latitude DECIMAL(10, 8);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_longitude DECIMAL(11, 8);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_time TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_outlet_id UUID REFERENCES business_outlets(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_time TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_notes TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

  -- Store calculated delivery fee on orders
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee DECIMAL(10,2) DEFAULT 0;

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
ALTER TABLE messages ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8);

CREATE INDEX IF NOT EXISTS idx_messages_whatsapp_id ON messages(whatsapp_message_id);

-- Add index for location queries (optional, for performance)
CREATE INDEX IF NOT EXISTS idx_messages_location ON messages (latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

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

-- ============================================
-- MIGRATE cake_flavor_pricing to combined Flavor + Weight structure
-- Old: flavor_name + additional_price (added to base weight price)
-- New: flavor_name + weight_grams + base_price (complete price per flavor+weight)
-- ============================================

-- Step 1: Create new combined table if it doesn't exist with new structure
CREATE TABLE IF NOT EXISTS cake_flavor_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  flavor_name VARCHAR(100) NOT NULL,
  weight_grams INTEGER NOT NULL DEFAULT 1000,
  base_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Step 2: Add new columns if table exists but doesn't have them
ALTER TABLE cake_flavor_pricing ADD COLUMN IF NOT EXISTS weight_grams INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE cake_flavor_pricing ADD COLUMN IF NOT EXISTS base_price DECIMAL(10, 2) NOT NULL DEFAULT 0;

-- Step 3: Migrate data from old structure if additional_price column exists
-- Combine old flavor pricing with weight pricing to create new records
DO $$
DECLARE
  has_additional_price BOOLEAN;
  has_weight_pricing BOOLEAN;
BEGIN
  -- Check if old additional_price column exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cake_flavor_pricing' AND column_name = 'additional_price'
  ) INTO has_additional_price;

  -- Check if old cake_weight_pricing table exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'cake_weight_pricing'
  ) INTO has_weight_pricing;

  -- If old structure exists, migrate data
  IF has_additional_price AND has_weight_pricing THEN
    -- Insert combined records for each flavor + weight combination
    INSERT INTO cake_flavor_pricing (business_id, flavor_name, weight_grams, base_price, is_active, created_at, updated_at)
    SELECT
      f.business_id,
      f.flavor_name,
      w.weight_grams,
      w.base_price + COALESCE(f.additional_price, 0) as base_price,
      f.is_active AND w.is_active,
      NOW(),
      NOW()
    FROM cake_flavor_pricing f
    CROSS JOIN cake_weight_pricing w
    WHERE f.business_id = w.business_id
      AND f.additional_price IS NOT NULL
    ON CONFLICT DO NOTHING;

    -- Drop old additional_price column after migration
    ALTER TABLE cake_flavor_pricing DROP COLUMN IF EXISTS additional_price;
  END IF;
END $$;

-- Step 4: Drop old unique constraint and create new one
DO $$
BEGIN
  -- Drop old constraint if exists (business_id, flavor_name)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cake_flavor_pricing_business_id_flavor_name_key'
  ) THEN
    ALTER TABLE cake_flavor_pricing DROP CONSTRAINT cake_flavor_pricing_business_id_flavor_name_key;
  END IF;

  -- Add new unique constraint (business_id, flavor_name, weight_grams)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cake_flavor_pricing_business_id_flavor_name_weight_grams_key'
  ) THEN
    ALTER TABLE cake_flavor_pricing ADD CONSTRAINT cake_flavor_pricing_business_id_flavor_name_weight_grams_key
      UNIQUE (business_id, flavor_name, weight_grams);
  END IF;
END $$;

-- Step 5: Create indexes
CREATE INDEX IF NOT EXISTS idx_cake_flavor_pricing_business ON cake_flavor_pricing(business_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_cake_flavor_pricing_flavor ON cake_flavor_pricing(business_id, flavor_name) WHERE is_active = true;

-- Step 6: Drop old weight pricing table (deprecated - now combined with flavor)
DROP TABLE IF EXISTS cake_weight_pricing;

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

ALTER TABLE cake_price_quotes ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE cake_price_quotes ADD COLUMN IF NOT EXISTS requested_delivery_time VARCHAR(100);
ALTER TABLE cake_price_quotes ADD COLUMN IF NOT EXISTS requested_fulfillment_type VARCHAR(20);
ALTER TABLE cake_price_quotes ADD COLUMN IF NOT EXISTS time_confirmed BOOLEAN DEFAULT false;
ALTER TABLE cake_price_quotes ADD COLUMN IF NOT EXISTS time_confirmed_at TIMESTAMP;

  CREATE TABLE IF NOT EXISTS business_amenities (
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

  CREATE INDEX IF NOT EXISTS idx_business_amenities_business ON business_amenities(business_id);
  CREATE INDEX IF NOT EXISTS idx_business_amenities_slug ON business_amenities(business_id, slug);

-- Add images column to existing business_amenities table
ALTER TABLE business_amenities ADD COLUMN IF NOT EXISTS images TEXT[] DEFAULT '{}';

-- ============================================
-- i18n: Add language preference to sessions
-- ============================================
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS language VARCHAR(5) DEFAULT 'ml';
COMMENT ON COLUMN sessions.language IS 'Customer preferred language: ml (Malayalam), en (English)';

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS custom_delivery_fee NUMERIC;

-- ============================================
-- Persist In-Memory Conversational State
-- ============================================
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS pending_state JSONB DEFAULT NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_added_item_id UUID;

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

-- Migration from 005_update_cake_flavor_pricing_sizes.sql
-- Migration: Update cake_flavor_pricing to use sizes JSONB array
-- This combines weight_grams and base_price into a sizes array with is_base flag

-- Step 1: Add sizes column
ALTER TABLE cake_flavor_pricing
ADD COLUMN IF NOT EXISTS sizes JSONB DEFAULT '[]'::jsonb;

-- Step 2: Migrate existing data - group by flavor_name and create sizes array
-- This creates a temporary function to help with migration
DO $$
DECLARE
    flavor_record RECORD;
    sizes_array JSONB;
    first_id UUID;
BEGIN
    -- Get unique business_id + flavor_name combinations
    FOR flavor_record IN
        SELECT DISTINCT business_id, flavor_name
        FROM cake_flavor_pricing
        WHERE sizes = '[]'::jsonb OR sizes IS NULL
    LOOP
        -- Build sizes array for this flavor
        SELECT jsonb_agg(
            jsonb_build_object(
                'name', weight_grams || 'g',
                'price', base_price,
                'is_base', CASE WHEN weight_grams = 1000 THEN true ELSE false END
            ) ORDER BY weight_grams
        )
        INTO sizes_array
        FROM cake_flavor_pricing
        WHERE business_id = flavor_record.business_id
          AND flavor_name = flavor_record.flavor_name;

        -- Get the first (lowest weight) record ID to keep
        SELECT id INTO first_id
        FROM cake_flavor_pricing
        WHERE business_id = flavor_record.business_id
          AND flavor_name = flavor_record.flavor_name
        ORDER BY weight_grams ASC
        LIMIT 1;

        -- Update the first record with the sizes array
        UPDATE cake_flavor_pricing
        SET sizes = COALESCE(sizes_array, '[]'::jsonb),
            updated_at = NOW()
        WHERE id = first_id;

        -- Delete duplicate rows (keep only first_id)
        DELETE FROM cake_flavor_pricing
        WHERE business_id = flavor_record.business_id
          AND flavor_name = flavor_record.flavor_name
          AND id != first_id;
    END LOOP;
END $$;

-- Step 3: Drop old columns (weight_grams, base_price)
ALTER TABLE cake_flavor_pricing DROP COLUMN IF EXISTS weight_grams;
ALTER TABLE cake_flavor_pricing DROP COLUMN IF EXISTS base_price;

-- Step 4: Drop old unique constraint and indexes
DROP INDEX IF EXISTS idx_cake_flavor_pricing_business;
DROP INDEX IF EXISTS idx_cake_flavor_pricing_flavor;
ALTER TABLE cake_flavor_pricing DROP CONSTRAINT IF EXISTS cake_flavor_pricing_business_id_flavor_name_weight_grams_key;

-- Step 5: Add new unique constraint (one flavor per business)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cake_flavor_pricing_business_flavor_unique') THEN
    ALTER TABLE cake_flavor_pricing
    ADD CONSTRAINT cake_flavor_pricing_business_flavor_unique UNIQUE(business_id, flavor_name);
  END IF;
END $$;

-- Step 6: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_cake_flavor_pricing_business ON cake_flavor_pricing(business_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_cake_flavor_pricing_flavor ON cake_flavor_pricing(business_id, flavor_name) WHERE is_active = true;

-- Verify migration
-- SELECT id, business_id, flavor_name, sizes, is_active FROM cake_flavor_pricing;

-- Create menu_pdf_configs table for category-filtered PDF menus
CREATE TABLE IF NOT EXISTS menu_pdf_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,           -- e.g., "Cakes Menu", "Snacks Menu"
  slug VARCHAR(100) NOT NULL,           -- e.g., "cakes-menu" (for file naming)
  category_ids UUID[] NOT NULL,         -- Array of category IDs
  pdf_url TEXT,                         -- Supabase Storage URL
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_menu_pdf_configs_business ON menu_pdf_configs(business_id);

-- Add multilingual name support to menu_pdf_configs
-- name_en: English name (default/fallback)
-- name_local: Local language name (could be Malayalam, Hindi, etc.)

ALTER TABLE menu_pdf_configs
ADD COLUMN IF NOT EXISTS name_en VARCHAR(100),
ADD COLUMN IF NOT EXISTS name_local VARCHAR(100);

-- Migrate existing 'name' values to name_en
UPDATE menu_pdf_configs SET name_en = name WHERE name_en IS NULL;

-- Add comment for clarity
COMMENT ON COLUMN menu_pdf_configs.name_en IS 'Menu name in English';
COMMENT ON COLUMN menu_pdf_configs.name_local IS 'Menu name in local language (e.g., Malayalam, Hindi)';

-- Add media_id column to messages table for tracking original WhatsApp media IDs
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_id TEXT;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_messages_media_id ON messages(media_id) WHERE media_id IS NOT NULL;

-- ============================================
-- DELIVERY BOYS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS delivery_boys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for business lookup
CREATE INDEX IF NOT EXISTS idx_delivery_boys_business ON delivery_boys(business_id);

-- Unique phone per business
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_boys_phone_business ON delivery_boys(business_id, phone);

-- Add delivery assignment columns to orders table
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS delivery_boy_id UUID REFERENCES delivery_boys(id),
ADD COLUMN IF NOT EXISTS delivery_assigned_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS delivery_assigned_by VARCHAR(255),
ADD COLUMN IF NOT EXISTS delivery_admin_note TEXT;

-- Index for delivery boy orders
CREATE INDEX IF NOT EXISTS idx_orders_delivery_boy ON orders(delivery_boy_id);

-- ============================================
-- Audit Logs Table
-- Tracks admin/superadmin actions for accountability
-- ============================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who performed the action
  admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  admin_email VARCHAR(255),  -- Denormalized for when admin is deleted
  admin_role VARCHAR(50),    -- 'superadmin', 'owner', 'admin'

  -- What action was performed
  action VARCHAR(100) NOT NULL,  -- e.g., 'business.create', 'menu.update', 'order.status_change'

  -- What entity was affected
  entity_type VARCHAR(50),       -- e.g., 'business', 'menu_item', 'order', 'admin_user'
  entity_id UUID,                -- ID of the affected entity
  business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,  -- For business-scoped actions

  -- Action details
  details JSONB DEFAULT '{}',    -- Additional context (old values, new values, etc.)

  -- Request metadata
  ip_address VARCHAR(45),        -- IPv4 or IPv6
  user_agent TEXT,

  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_id ON audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_business_id ON audit_logs(business_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- Composite index for filtering by business and time
CREATE INDEX IF NOT EXISTS idx_audit_logs_business_time ON audit_logs(business_id, created_at DESC);

-- ============================================
-- Common audit actions reference:
-- ============================================
-- Superadmin actions:
--   business.create, business.update, business.toggle_status
--   business.admin_add, business.admin_delete
--   usage.config_update
--
-- Admin actions:
--   menu.item_create, menu.item_update, menu.item_delete
--   menu.category_create, menu.category_update, menu.category_delete
--   menu.addon_create, menu.addon_update, menu.addon_delete
--   order.status_change, order.cancel
--   session.ai_pause, session.ai_resume
--   business.settings_update
--   intervention.respond
-- ============================================
-- ============================================
-- USAGE TRACKING MIGRATIONS
-- ============================================
-- Usage Tracking Tables for Super Admin Dashboard
-- Run this migration in Supabase SQL Editor

-- ============================================
-- 1. API Usage Logs (Raw Logs)
-- ============================================
CREATE TABLE IF NOT EXISTS api_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- API Type
  api_type VARCHAR(50) NOT NULL, -- 'ai', 'whatsapp', 'google_maps'

  -- Request Details
  provider VARCHAR(50), -- 'gemini', 'openrouter', 'groq', 'meta', 'google'
  endpoint VARCHAR(255),

  -- Token Usage (for AI)
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,

  -- Performance
  latency_ms INTEGER,

  -- Status
  success BOOLEAN DEFAULT true,
  error_message TEXT,

  -- WhatsApp-specific
  message_direction VARCHAR(10), -- 'inbound', 'outbound'
  message_type VARCHAR(50), -- 'text', 'image', 'document', 'interactive'

  -- Google Maps-specific
  distance_meters INTEGER,

  -- Cost (calculated)
  estimated_cost_usd DECIMAL(10, 6) DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_api_usage_business_date ON api_usage_logs(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_type ON api_usage_logs(api_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_created_at ON api_usage_logs(created_at DESC);

-- ============================================
-- 2. Daily Aggregated Stats
-- ============================================
CREATE TABLE IF NOT EXISTS usage_daily_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  stat_date DATE NOT NULL,

  -- AI Usage
  ai_requests_count INTEGER DEFAULT 0,
  ai_tokens_input INTEGER DEFAULT 0,
  ai_tokens_output INTEGER DEFAULT 0,
  ai_errors_count INTEGER DEFAULT 0,
  ai_avg_latency_ms INTEGER DEFAULT 0,
  ai_estimated_cost_usd DECIMAL(10, 4) DEFAULT 0,

  -- WhatsApp Usage
  wa_messages_received INTEGER DEFAULT 0,
  wa_messages_sent INTEGER DEFAULT 0,
  wa_media_sent INTEGER DEFAULT 0,
  wa_estimated_cost_usd DECIMAL(10, 4) DEFAULT 0,

  -- Google Maps Usage
  maps_api_calls INTEGER DEFAULT 0,
  maps_estimated_cost_usd DECIMAL(10, 4) DEFAULT 0,

  -- Business Metrics
  orders_count INTEGER DEFAULT 0,
  orders_revenue DECIMAL(12, 2) DEFAULT 0,
  unique_customers INTEGER DEFAULT 0,

  -- Total Cost
  total_estimated_cost_usd DECIMAL(10, 4) DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint for upsert
  UNIQUE(business_id, stat_date)
);

CREATE INDEX IF NOT EXISTS idx_usage_daily_business ON usage_daily_stats(business_id, stat_date DESC);
CREATE INDEX IF NOT EXISTS idx_usage_daily_date ON usage_daily_stats(stat_date DESC);

-- ============================================
-- 3. Super Admins Table
-- ============================================
CREATE TABLE IF NOT EXISTS super_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

-- ============================================
-- 4. API Cost Configuration
-- ============================================
CREATE TABLE IF NOT EXISTS api_cost_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_type VARCHAR(50) NOT NULL, -- 'ai', 'whatsapp', 'google_maps'
  provider VARCHAR(50), -- 'gemini', 'openrouter', 'groq', 'meta', 'google'

  -- Pricing (USD)
  cost_per_input_token DECIMAL(12, 10) DEFAULT 0,
  cost_per_output_token DECIMAL(12, 10) DEFAULT 0,
  cost_per_request DECIMAL(10, 6) DEFAULT 0,
  cost_per_message DECIMAL(10, 6) DEFAULT 0,

  -- Description
  description TEXT,

  -- Validity
  effective_from DATE DEFAULT CURRENT_DATE,
  effective_to DATE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default pricing
INSERT INTO api_cost_config (api_type, provider, cost_per_input_token, cost_per_output_token, description) VALUES
  ('ai', 'gemini', 0.0000001, 0.0000004, 'Gemini 2.0 Flash: $0.10/1M input, $0.40/1M output'),
  ('ai', 'openrouter', 0.0000001, 0.0000004, 'OpenRouter varies by model'),
  ('ai', 'groq', 0.0000001, 0.0000004, 'Groq varies by model')
ON CONFLICT DO NOTHING;

INSERT INTO api_cost_config (api_type, provider, cost_per_request, description) VALUES
  ('google_maps', 'distance_matrix', 0.005, 'Google Distance Matrix: $5/1000 requests')
ON CONFLICT DO NOTHING;

INSERT INTO api_cost_config (api_type, provider, cost_per_message, description) VALUES
  ('whatsapp', 'meta', 0.005, 'Meta WhatsApp: ~$0.005/conversation (varies by country)')
ON CONFLICT DO NOTHING;

-- ============================================
-- 5. Helper Function: Aggregate Daily Stats
-- ============================================
CREATE OR REPLACE FUNCTION aggregate_daily_usage_stats(target_date DATE)
RETURNS void AS $$
BEGIN
  INSERT INTO usage_daily_stats (
    business_id,
    stat_date,
    ai_requests_count,
    ai_tokens_input,
    ai_tokens_output,
    ai_errors_count,
    ai_avg_latency_ms,
    ai_estimated_cost_usd,
    wa_messages_received,
    wa_messages_sent,
    wa_media_sent,
    wa_estimated_cost_usd,
    maps_api_calls,
    maps_estimated_cost_usd,
    total_estimated_cost_usd
  )
  SELECT
    business_id,
    target_date,
    COUNT(*) FILTER (WHERE api_type = 'ai') as ai_requests_count,
    COALESCE(SUM(tokens_input) FILTER (WHERE api_type = 'ai'), 0) as ai_tokens_input,
    COALESCE(SUM(tokens_output) FILTER (WHERE api_type = 'ai'), 0) as ai_tokens_output,
    COUNT(*) FILTER (WHERE api_type = 'ai' AND NOT success) as ai_errors_count,
    COALESCE(AVG(latency_ms) FILTER (WHERE api_type = 'ai'), 0)::INTEGER as ai_avg_latency_ms,
    COALESCE(SUM(estimated_cost_usd) FILTER (WHERE api_type = 'ai'), 0) as ai_estimated_cost_usd,
    COUNT(*) FILTER (WHERE api_type = 'whatsapp' AND message_direction = 'inbound') as wa_messages_received,
    COUNT(*) FILTER (WHERE api_type = 'whatsapp' AND message_direction = 'outbound') as wa_messages_sent,
    COUNT(*) FILTER (WHERE api_type = 'whatsapp' AND message_direction = 'outbound' AND message_type IN ('image', 'document')) as wa_media_sent,
    COALESCE(SUM(estimated_cost_usd) FILTER (WHERE api_type = 'whatsapp'), 0) as wa_estimated_cost_usd,
    COUNT(*) FILTER (WHERE api_type = 'google_maps') as maps_api_calls,
    COALESCE(SUM(estimated_cost_usd) FILTER (WHERE api_type = 'google_maps'), 0) as maps_estimated_cost_usd,
    COALESCE(SUM(estimated_cost_usd), 0) as total_estimated_cost_usd
  FROM api_usage_logs
  WHERE created_at >= target_date AND created_at < target_date + INTERVAL '1 day'
  GROUP BY business_id
  ON CONFLICT (business_id, stat_date) DO UPDATE SET
    ai_requests_count = EXCLUDED.ai_requests_count,
    ai_tokens_input = EXCLUDED.ai_tokens_input,
    ai_tokens_output = EXCLUDED.ai_tokens_output,
    ai_errors_count = EXCLUDED.ai_errors_count,
    ai_avg_latency_ms = EXCLUDED.ai_avg_latency_ms,
    ai_estimated_cost_usd = EXCLUDED.ai_estimated_cost_usd,
    wa_messages_received = EXCLUDED.wa_messages_received,
    wa_messages_sent = EXCLUDED.wa_messages_sent,
    wa_media_sent = EXCLUDED.wa_media_sent,
    wa_estimated_cost_usd = EXCLUDED.wa_estimated_cost_usd,
    maps_api_calls = EXCLUDED.maps_api_calls,
    maps_estimated_cost_usd = EXCLUDED.maps_estimated_cost_usd,
    total_estimated_cost_usd = EXCLUDED.total_estimated_cost_usd,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 6. RLS Policies
-- ============================================
ALTER TABLE api_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_daily_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE super_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_cost_config ENABLE ROW LEVEL SECURITY;

-- Super admins can read all usage data
DROP POLICY IF EXISTS "Super admins can read all usage logs" ON api_usage_logs;
CREATE POLICY "Super admins can read all usage logs" ON api_usage_logs
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Super admins can read all daily stats" ON usage_daily_stats;
CREATE POLICY "Super admins can read all daily stats" ON usage_daily_stats
  FOR SELECT USING (true);

-- Service role can insert usage logs
DROP POLICY IF EXISTS "Service can insert usage logs" ON api_usage_logs;
CREATE POLICY "Service can insert usage logs" ON api_usage_logs
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Service can manage daily stats" ON usage_daily_stats;
CREATE POLICY "Service can manage daily stats" ON usage_daily_stats
  FOR ALL USING (true);

-- ============================================
-- DONE! Run aggregate function daily via cron:
-- SELECT aggregate_daily_usage_stats(CURRENT_DATE - INTERVAL '1 day');
-- ============================================

-- ============================================
-- MOST MOVABLE ITEMS MIGRATIONS
-- From USAGE_PLAN.md
-- ============================================

-- 1. Create order_item_stats table
CREATE TABLE IF NOT EXISTS order_item_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  menu_item_id UUID REFERENCES menu_items(id) ON DELETE CASCADE,
  item_name VARCHAR(255) NOT NULL,
  period_type VARCHAR(20) NOT NULL, -- 'daily', 'weekly', 'monthly', 'all_time'
  period_start DATE NOT NULL,
  order_count INTEGER DEFAULT 0,
  quantity_sold INTEGER DEFAULT 0,
  revenue DECIMAL(10,2) DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(business_id, menu_item_id, period_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_item_stats_business_period
ON order_item_stats(business_id, period_type, order_count DESC);

CREATE INDEX IF NOT EXISTS idx_item_stats_menu_item
ON order_item_stats(menu_item_id);

-- 2. Add featured columns to menu_items
ALTER TABLE menu_items
ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS featured_order INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_menu_items_featured
ON menu_items(business_id, is_featured, featured_order)
WHERE is_featured = TRUE;

-- 3. Create increment_item_stats RPC function
CREATE OR REPLACE FUNCTION increment_item_stats(
  p_business_id UUID,
  p_menu_item_id UUID,
  p_item_name VARCHAR,
  p_quantity INTEGER,
  p_revenue DECIMAL,
  p_date DATE
) RETURNS VOID AS $$
BEGIN
  INSERT INTO order_item_stats (business_id, menu_item_id, item_name, period_type, period_start, order_count, quantity_sold, revenue)
  VALUES (p_business_id, p_menu_item_id, p_item_name, 'daily', p_date, 1, p_quantity, p_revenue)
  ON CONFLICT (business_id, menu_item_id, period_type, period_start)
  DO UPDATE SET
    order_count = order_item_stats.order_count + 1,
    quantity_sold = order_item_stats.quantity_sold + p_quantity,
    revenue = order_item_stats.revenue + p_revenue,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- 4. Create aggregate_item_stats RPC function (for cron)
CREATE OR REPLACE FUNCTION aggregate_item_stats(p_date DATE DEFAULT CURRENT_DATE)
RETURNS VOID AS $$
BEGIN
  -- Weekly aggregation
  INSERT INTO order_item_stats (business_id, menu_item_id, item_name, period_type, period_start, order_count, quantity_sold, revenue)
  SELECT
    business_id, menu_item_id, item_name, 'weekly',
    date_trunc('week', p_date)::DATE,
    SUM(order_count), SUM(quantity_sold), SUM(revenue)
  FROM order_item_stats
  WHERE period_type = 'daily' AND period_start >= date_trunc('week', p_date)
  GROUP BY business_id, menu_item_id, item_name
  ON CONFLICT (business_id, menu_item_id, period_type, period_start)
  DO UPDATE SET
    order_count = EXCLUDED.order_count,
    quantity_sold = EXCLUDED.quantity_sold,
    revenue = EXCLUDED.revenue,
    updated_at = NOW();

  -- Monthly aggregation
  INSERT INTO order_item_stats (business_id, menu_item_id, item_name, period_type, period_start, order_count, quantity_sold, revenue)
  SELECT
    business_id, menu_item_id, item_name, 'monthly',
    date_trunc('month', p_date)::DATE,
    SUM(order_count), SUM(quantity_sold), SUM(revenue)
  FROM order_item_stats
  WHERE period_type = 'daily' AND period_start >= date_trunc('month', p_date)
  GROUP BY business_id, menu_item_id, item_name
  ON CONFLICT (business_id, menu_item_id, period_type, period_start)
  DO UPDATE SET
    order_count = EXCLUDED.order_count,
    quantity_sold = EXCLUDED.quantity_sold,
    revenue = EXCLUDED.revenue,
    updated_at = NOW();

  -- All-time aggregation
  INSERT INTO order_item_stats (business_id, menu_item_id, item_name, period_type, period_start, order_count, quantity_sold, revenue)
  SELECT
    business_id, menu_item_id, item_name, 'all_time',
    '2024-01-01'::DATE,
    SUM(order_count), SUM(quantity_sold), SUM(revenue)
  FROM order_item_stats
  WHERE period_type = 'daily'
  GROUP BY business_id, menu_item_id, item_name
  ON CONFLICT (business_id, menu_item_id, period_type, period_start)
  DO UPDATE SET
    order_count = EXCLUDED.order_count,
    quantity_sold = EXCLUDED.quantity_sold,
    revenue = EXCLUDED.revenue,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

create or replace function update_menu_item_featured_order(items jsonb, p_business_id uuid)
returns void as $$
declare
  item jsonb;
begin
  for item in select * from jsonb_array_elements(items)
  loop
    update menu_items
    set featured_order = (item->>'featured_order')::integer
    where id = (item->>'id')::uuid and business_id = p_business_id;
  end loop;
end;
$$ language plpgsql;

-- ============================================
-- CAMPAIGN MANAGEMENT TABLES
-- From migrations/004_campaigns.sql
-- ============================================

-- Campaign Management Tables
-- Stores campaign history and media

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- Campaign details
  name VARCHAR(255) NOT NULL,
  description TEXT,
  campaign_type VARCHAR(50) NOT NULL DEFAULT 'template', -- 'template' or 'direct'

  -- Template details (for template campaigns)
  template_name VARCHAR(255), -- e.g., 'seasonal_celebration'
  language_code VARCHAR(10) DEFAULT 'en_US',

  -- Media
  image_url TEXT, -- Public URL of campaign image

  -- Template variables (JSONB for flexibility)
  -- Example: {"header_image": "url", "body_1": "Republic Day", "body_2": "Get 25% off!"}
  template_variables JSONB,

  -- Target audience
  target_type VARCHAR(50) NOT NULL DEFAULT 'all', -- 'all', 'custom', 'segment'
  target_phone_numbers TEXT[], -- Array of phone numbers
  target_user_ids UUID[], -- Array of customer IDs
  filter_tags TEXT[], -- Future: tag-based filtering

  -- Campaign status
  status VARCHAR(50) NOT NULL DEFAULT 'draft', -- 'draft', 'sending', 'completed', 'failed'
  scheduled_at TIMESTAMPTZ, -- Future: scheduled campaigns
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Results
  total_recipients INTEGER DEFAULT 0,
  successful_sends INTEGER DEFAULT 0,
  failed_sends INTEGER DEFAULT 0,
  error_details JSONB, -- Store errors if any

  -- Metadata
  created_by UUID, -- Admin user ID
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_campaigns_business_id ON campaigns(business_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_created_at ON campaigns(created_at DESC);

-- Campaign messages tracking (optional - for detailed tracking)
CREATE TABLE IF NOT EXISTS campaign_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  phone VARCHAR(50) NOT NULL,

  -- Status
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'failed', 'delivered', 'read'
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  error_message TEXT,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for campaign messages
CREATE INDEX IF NOT EXISTS idx_campaign_messages_campaign_id ON campaign_messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_messages_customer_id ON campaign_messages(customer_id);
CREATE INDEX IF NOT EXISTS idx_campaign_messages_status ON campaign_messages(status);

-- Update trigger for campaigns
CREATE OR REPLACE FUNCTION update_campaigns_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_campaigns_updated_at ON campaigns;
CREATE TRIGGER trigger_update_campaigns_updated_at
BEFORE UPDATE ON campaigns
FOR EACH ROW
EXECUTE FUNCTION update_campaigns_updated_at();

-- Comments
COMMENT ON TABLE campaigns IS 'Stores marketing campaigns sent via WhatsApp';
COMMENT ON COLUMN campaigns.template_variables IS 'JSONB storing template parameter values for reusable templates';
COMMENT ON COLUMN campaigns.image_url IS 'Public URL of campaign image hosted on Supabase Storage or external CDN';
COMMENT ON TABLE campaign_messages IS 'Tracks individual message delivery status for each campaign recipient';

-- ============================================
-- WHATSAPP CONNECTIONS MIGRATION
-- From migrations/005_whatsapp_connections.sql
-- ============================================

-- Migration: WhatsApp Connections (Multi-tenant WhatsApp support)
-- This allows each business to have their own WhatsApp number with credentials stored in DB

-- Create whatsapp_connections table
CREATE TABLE IF NOT EXISTS whatsapp_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL DEFAULT 'meta', -- 'meta' | 'webjs'
  phone_number VARCHAR(20) NOT NULL,

  -- Meta API credentials
  meta_phone_number_id VARCHAR(50),
  meta_access_token TEXT,
  meta_business_account_id VARCHAR(50),
  meta_webhook_secret TEXT,
  meta_verify_token VARCHAR(100),

  -- WebJS session (for future use)
  webjs_session_data JSONB,

  -- Status tracking
  status VARCHAR(20) DEFAULT 'active', -- pending, active, disconnected
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  UNIQUE(phone_number)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_whatsapp_connections_phone ON whatsapp_connections(phone_number);
CREATE INDEX IF NOT EXISTS idx_whatsapp_connections_business ON whatsapp_connections(business_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_connections_status ON whatsapp_connections(status);

-- Add trigger for updated_at
CREATE OR REPLACE FUNCTION update_whatsapp_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_whatsapp_connections_updated_at ON whatsapp_connections;
CREATE TRIGGER trigger_whatsapp_connections_updated_at
  BEFORE UPDATE ON whatsapp_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_whatsapp_connections_updated_at();

-- Comments for documentation
COMMENT ON TABLE whatsapp_connections IS 'Stores WhatsApp connection credentials per business for multi-tenant support';
COMMENT ON COLUMN whatsapp_connections.provider IS 'WhatsApp provider: meta (official API) or webjs (unofficial)';
COMMENT ON COLUMN whatsapp_connections.meta_access_token IS 'Meta Graph API access token - consider encryption for production';
COMMENT ON COLUMN whatsapp_connections.status IS 'Connection status: pending (setup), active (working), disconnected (needs reconnection)';


-- ============================================
-- WHATSAPP CONNECTIONS MIGRATION
-- From migrations/005_whatsapp_connections.sql
-- ============================================
-- Migration: WhatsApp Connections (Multi-tenant WhatsApp support)
-- This allows each business to have their own WhatsApp number with credentials stored in DB

-- Create whatsapp_connections table
CREATE TABLE IF NOT EXISTS whatsapp_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL DEFAULT 'meta', -- 'meta' | 'webjs'
  phone_number VARCHAR(20) NOT NULL,

  -- Meta API credentials
  meta_phone_number_id VARCHAR(50),
  meta_access_token TEXT,
  meta_business_account_id VARCHAR(50),
  meta_webhook_secret TEXT,
  meta_verify_token VARCHAR(100),

  -- WebJS session (for future use)
  webjs_session_data JSONB,

  -- Status tracking
  status VARCHAR(20) DEFAULT 'active', -- pending, active, disconnected
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  UNIQUE(phone_number)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_whatsapp_connections_phone ON whatsapp_connections(phone_number);
CREATE INDEX IF NOT EXISTS idx_whatsapp_connections_business ON whatsapp_connections(business_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_connections_status ON whatsapp_connections(status);

-- Add trigger for updated_at
CREATE OR REPLACE FUNCTION update_whatsapp_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_whatsapp_connections_updated_at ON whatsapp_connections;
CREATE TRIGGER trigger_whatsapp_connections_updated_at
  BEFORE UPDATE ON whatsapp_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_whatsapp_connections_updated_at();

-- Comments for documentation
COMMENT ON TABLE whatsapp_connections IS 'Stores WhatsApp connection credentials per business for multi-tenant support';
COMMENT ON COLUMN whatsapp_connections.provider IS 'WhatsApp provider: meta (official API) or webjs (unofficial)';
COMMENT ON COLUMN whatsapp_connections.meta_access_token IS 'Meta Graph API access token - consider encryption for production';
COMMENT ON COLUMN whatsapp_connections.status IS 'Connection status: pending (setup), active (working), disconnected (needs reconnection)';

-- ============================================
-- FEATURE: ANALYTICS DASHBOARD
-- ============================================

-- 1. Create materialized views for metrics
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_order_metrics AS
SELECT
    business_id,
    date_trunc('day', created_at)::date AS date,
    count(*) AS order_count,
    sum(total_amount) AS total_revenue,
    avg(total_amount) AS avg_order_value,
    count(*) FILTER (WHERE status = 'completed') AS completed_count,
    count(*) FILTER (WHERE status = 'cancelled') AS cancelled_count,
    count(*) FILTER (WHERE fulfillment_type = 'delivery') AS delivery_count,
    count(*) FILTER (WHERE fulfillment_type = 'takeaway') AS takeaway_count
FROM orders
GROUP BY business_id, date;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_daily_order_metrics_unique ON mv_daily_order_metrics (business_id, date);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_session_metrics AS
SELECT
    business_id,
    date_trunc('day', created_at)::date AS date,
    count(*) AS session_count,
    count(*) FILTER (WHERE status = 'completed') AS completed_sessions,
    count(*) FILTER (WHERE ai_paused = true) AS ai_paused_count
FROM sessions
WHERE business_id IS NOT NULL
GROUP BY business_id, date;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_daily_session_metrics_unique ON mv_daily_session_metrics (business_id, date);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_customer_metrics AS
SELECT
    business_id,
    date_trunc('day', created_at)::date AS date,
    count(*) AS new_customer_count
FROM customers
WHERE business_id IS NOT NULL
GROUP BY business_id, date;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_daily_customer_metrics_unique ON mv_daily_customer_metrics (business_id, date);

-- 2. Functions for Analytics
CREATE OR REPLACE FUNCTION refresh_analytics_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_order_metrics;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_session_metrics;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_customer_metrics;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_analytics_summary(
    p_business_id UUID,
    p_from_date DATE,
    p_to_date DATE
)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'total_orders', coalesce(sum(order_count), 0),
        'total_revenue', coalesce(sum(total_revenue), 0),
        'avg_order_value', coalesce(avg(avg_order_value), 0),
        'completed_order_rate', CASE WHEN sum(order_count) > 0 THEN (sum(completed_count)::float / sum(order_count)::float) ELSE 0 END,
        'new_customers', (SELECT sum(new_customer_count) FROM mv_daily_customer_metrics WHERE business_id = p_business_id AND date >= p_from_date AND date <= p_to_date),
        'session_completion_rate', (SELECT CASE WHEN sum(session_count) > 0 THEN (sum(completed_sessions)::float / sum(session_count)::float) ELSE 0 END FROM mv_daily_session_metrics WHERE business_id = p_business_id AND date >= p_from_date AND date <= p_to_date)
    ) INTO result
    FROM mv_daily_order_metrics
    WHERE business_id = p_business_id AND date >= p_from_date AND date <= p_to_date;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_analytics_trends(
    p_business_id UUID,
    p_from_date DATE,
    p_to_date DATE,
    p_granularity TEXT DEFAULT 'daily'
)
RETURNS TABLE (
    period DATE,
    order_count BIGINT,
    total_revenue NUMERIC
) AS $$
BEGIN
    IF p_granularity = 'weekly' THEN
        RETURN QUERY
        SELECT
            date_trunc('week', m.date)::date as period,
            sum(m.order_count)::BIGINT,
            sum(m.total_revenue)
        FROM mv_daily_order_metrics m
        WHERE m.business_id = p_business_id AND m.date >= p_from_date AND m.date <= p_to_date
        GROUP BY 1
        ORDER BY 1;
    ELSIF p_granularity = 'monthly' THEN
        RETURN QUERY
        SELECT
            date_trunc('month', m.date)::date as period,
            sum(m.order_count)::BIGINT,
            sum(m.total_revenue)
        FROM mv_daily_order_metrics m
        WHERE m.business_id = p_business_id AND m.date >= p_from_date AND m.date <= p_to_date
        GROUP BY 1
        ORDER BY 1;
    ELSE
        RETURN QUERY
        SELECT
            m.date,
            m.order_count,
            m.total_revenue
        FROM mv_daily_order_metrics m
        WHERE m.business_id = p_business_id AND m.date >= p_from_date AND m.date <= p_to_date
        ORDER BY m.date;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_top_customers(
    p_business_id UUID,
    p_limit INT DEFAULT 10
)
RETURNS TABLE (
    customer_id UUID,
    phone TEXT,
    name TEXT,
    order_count BIGINT,
    total_spent NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.phone::TEXT,
        c.name::TEXT,
        count(o.id) as order_count,
        sum(o.total_amount) as total_spent
    FROM orders o
    JOIN customers c ON o.customer_id = c.id
    WHERE o.business_id = p_business_id AND o.status = 'completed'
    GROUP BY c.id, c.phone, c.name
    ORDER BY total_spent DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- FEATURE: CRM / CUSTOMER PROFILES
-- ============================================

-- 1. Create customer_profiles table
CREATE TABLE IF NOT EXISTS customer_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    total_orders INT DEFAULT 0,
    total_spent NUMERIC DEFAULT 0,
    avg_order_value NUMERIC DEFAULT 0,
    first_order_at TIMESTAMP WITH TIME ZONE,
    last_order_at TIMESTAMP WITH TIME ZONE,
    segment TEXT DEFAULT 'new', -- new | returning | vip | at_risk | churned
    tags TEXT[] DEFAULT ARRAY[]::TEXT[],
    preferences JSONB DEFAULT '{}'::JSONB,
    marketing_opted_in BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(customer_id, business_id)
);

-- 2. Segmentation Logic
CREATE OR REPLACE FUNCTION calculate_customer_segment(
    p_total_orders INT,
    p_total_spent NUMERIC,
    p_last_order_at TIMESTAMP WITH TIME ZONE
)
RETURNS TEXT AS $$
DECLARE
    days_since_last_order INT;
BEGIN
    IF p_total_orders = 0 THEN
        RETURN 'new';
    END IF;

    days_since_last_order := EXTRACT(DAY FROM (NOW() - p_last_order_at));

    IF p_total_orders >= 10 OR p_total_spent >= 10000 THEN
        RETURN 'vip';
    END IF;

    IF days_since_last_order > 90 THEN
        RETURN 'churned';
    END IF;

    IF days_since_last_order > 45 THEN
        RETURN 'at_risk';
    END IF;

    IF p_total_orders >= 2 AND days_since_last_order <= 45 THEN
        RETURN 'returning';
    END IF;

    -- Default to new if they only have 1 order within 45 days
    RETURN 'new';
END;
$$ LANGUAGE plpgsql;

-- 3. Trigger Function to update profile on order completion
CREATE OR REPLACE FUNCTION update_customer_profile_on_order()
RETURNS TRIGGER AS $$
DECLARE
    v_total_orders INT;
    v_total_spent NUMERIC;
    v_first_order_at TIMESTAMP WITH TIME ZONE;
    v_last_order_at TIMESTAMP WITH TIME ZONE;
    v_segment TEXT;
BEGIN
    -- Only update on completion
    IF (TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status != 'completed') OR
       (TG_OP = 'INSERT' AND NEW.status = 'completed') THEN
        
        -- Get stats for this customer & business
        SELECT 
            count(*),
            sum(total_amount),
            min(created_at),
            max(created_at)
        INTO 
            v_total_orders,
            v_total_spent,
            v_first_order_at,
            v_last_order_at
        FROM orders
        WHERE customer_id = NEW.customer_id 
          AND business_id = NEW.business_id
          AND status = 'completed';

        v_segment := calculate_customer_segment(v_total_orders, v_total_spent, v_last_order_at);

        -- Upsert profile
        INSERT INTO customer_profiles (
            customer_id, 
            business_id, 
            total_orders, 
            total_spent, 
            avg_order_value, 
            first_order_at, 
            last_order_at, 
            segment,
            updated_at
        )
        VALUES (
            NEW.customer_id, 
            NEW.business_id, 
            v_total_orders, 
            v_total_spent, 
            CASE WHEN v_total_orders > 0 THEN v_total_spent / v_total_orders ELSE 0 END,
            v_first_order_at, 
            v_last_order_at, 
            v_segment,
            NOW()
        )
        ON CONFLICT (customer_id, business_id) DO UPDATE SET
            total_orders = EXCLUDED.total_orders,
            total_spent = EXCLUDED.total_spent,
            avg_order_value = EXCLUDED.avg_order_value,
            last_order_at = EXCLUDED.last_order_at,
            segment = EXCLUDED.segment,
            updated_at = NOW();
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger
DROP TRIGGER IF EXISTS trg_update_customer_profile ON orders;
CREATE TRIGGER trg_update_customer_profile
AFTER INSERT OR UPDATE ON orders
FOR EACH ROW
EXECUTE FUNCTION update_customer_profile_on_order();

-- 4. Hourly/Daily Cron Logic (to catch at_risk/churned)
CREATE OR REPLACE FUNCTION refresh_all_customer_segments()
RETURNS void AS $$
BEGIN
    UPDATE customer_profiles
    SET 
        segment = calculate_customer_segment(total_orders, total_spent, last_order_at),
        updated_at = NOW()
    WHERE last_order_at IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- FEATURE: DYNAMIC AI PROMPTS
-- ============================================

-- 1. Create ai_prompt_templates table
CREATE TABLE IF NOT EXISTS ai_prompt_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE, -- NULL for system-wide defaults
    plugin_id TEXT DEFAULT 'cake-cafe',
    name TEXT NOT NULL,
    description TEXT,
    template_content TEXT NOT NULL,
    template_type TEXT NOT NULL, -- greeting | farewell | personality | instruction | custom
    is_active BOOLEAN DEFAULT true,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Update businesses table with AI settings
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS ai_personality VARCHAR(50) DEFAULT 'friendly';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS ai_greeting_template_id UUID REFERENCES ai_prompt_templates(id);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS ai_farewell_template_id UUID REFERENCES ai_prompt_templates(id);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS ai_instructions_enabled BOOLEAN DEFAULT true;

-- 3. Functions for Template Rendering
CREATE OR REPLACE FUNCTION get_effective_ai_template(
    p_business_id UUID,
    p_template_type TEXT,
    p_plugin_id TEXT DEFAULT 'cake-cafe'
)
RETURNS TEXT AS $$
DECLARE
    v_content TEXT;
BEGIN
    -- Try to get business-specific active template of that type
    SELECT template_content INTO v_content
    FROM ai_prompt_templates
    WHERE business_id = p_business_id 
      AND template_type = p_template_type 
      AND is_active = true
    LIMIT 1;

    -- Fallback to system default if not found
    IF v_content IS NULL THEN
        SELECT template_content INTO v_content
        FROM ai_prompt_templates
        WHERE business_id IS NULL 
          AND template_type = p_template_type 
          AND plugin_id = p_plugin_id
          AND is_default = true
        LIMIT 1;
    END IF;

    RETURN v_content;
END;
$$ LANGUAGE plpgsql;

-- 4. Initial default templates
INSERT INTO ai_prompt_templates (name, template_type, template_content, is_default, plugin_id)
VALUES
('Default Greeting', 'greeting', 'Hello! Welcome to {business_name}. How can I help you today?', true, 'cake-cafe'),
('Default Farewell', 'farewell', 'Thank you for choosing {business_name}! Have a great day.', true, 'cake-cafe'),
('Default Professional', 'personality', 'You are a professional and efficient ordering assistant.', true, 'cake-cafe')
ON CONFLICT DO NOTHING;

-- ============================================
-- CLEANUP: Remove deprecated columns
-- These are replaced by the new AI Prompt Templates system
-- ============================================
ALTER TABLE businesses DROP COLUMN IF EXISTS welcome_message;
ALTER TABLE businesses DROP COLUMN IF EXISTS closing_message;
ALTER TABLE businesses DROP COLUMN IF EXISTS custom_ai_prompt;
