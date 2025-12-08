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

-- Add image URLs to menu tables
ALTER TABLE menu_categories ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE menu_addons ADD COLUMN IF NOT EXISTS image_url TEXT;

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
-- DONE
-- ============================================
