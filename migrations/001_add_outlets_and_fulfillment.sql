-- Migration: Add Outlets and Fulfillment Support
-- Run this in your Supabase SQL Editor

-- ============================================
-- 1. CREATE OUTLETS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS business_outlets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  outlet_name VARCHAR(100) NOT NULL,
  address TEXT NOT NULL,
  phone VARCHAR(20),
  latitude DECIMAL(10, 8), -- For future map integration
  longitude DECIMAL(11, 8),
  is_active BOOLEAN DEFAULT true,
  display_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_outlets_business
  ON business_outlets(business_id) WHERE is_active = true;

-- ============================================
-- 2. EXTEND SESSIONS TABLE
-- ============================================
ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS fulfillment_type VARCHAR(20), -- 'delivery', 'takeaway', 'mixed'
ADD COLUMN IF NOT EXISTS delivery_address TEXT,
ADD COLUMN IF NOT EXISTS delivery_latitude DECIMAL(10, 8),
ADD COLUMN IF NOT EXISTS delivery_longitude DECIMAL(11, 8),
ADD COLUMN IF NOT EXISTS delivery_time TIMESTAMP,
ADD COLUMN IF NOT EXISTS pickup_outlet_id UUID REFERENCES business_outlets(id),
ADD COLUMN IF NOT EXISTS pickup_time TIMESTAMP,
ADD COLUMN IF NOT EXISTS fulfillment_notes TEXT; -- Special delivery instructions

-- ============================================
-- 3. EXTEND SESSION_ITEMS TABLE (for split orders)
-- ============================================
ALTER TABLE session_items
ADD COLUMN IF NOT EXISTS item_fulfillment_type VARCHAR(20); -- 'delivery' or 'takeaway' for mixed orders

-- ============================================
-- 4. EXTEND ORDERS TABLE
-- ============================================
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS fulfillment_type VARCHAR(20),
ADD COLUMN IF NOT EXISTS delivery_address TEXT,
ADD COLUMN IF NOT EXISTS delivery_latitude DECIMAL(10, 8),
ADD COLUMN IF NOT EXISTS delivery_longitude DECIMAL(11, 8),
ADD COLUMN IF NOT EXISTS delivery_time TIMESTAMP,
ADD COLUMN IF NOT EXISTS pickup_outlet_id UUID REFERENCES business_outlets(id),
ADD COLUMN IF NOT EXISTS pickup_time TIMESTAMP,
ADD COLUMN IF NOT EXISTS fulfillment_notes TEXT,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- ============================================
-- 5. EXTEND BUSINESSES TABLE
-- ============================================
ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS supports_delivery BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS supports_takeaway BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS delivery_fee DECIMAL(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS free_delivery_above DECIMAL(10, 2), -- Free delivery above this amount
ADD COLUMN IF NOT EXISTS delivery_radius_km DECIMAL(5, 2), -- Delivery radius in kilometers
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- ============================================
-- 6. INSERT SAMPLE OUTLETS (for demo)
-- ============================================
-- Note: Replace 'c3150207-4bf9-4ce4-8478-2e6369c46749' with your actual business_id

INSERT INTO business_outlets (business_id, outlet_name, address, phone, display_order, is_active)
VALUES
  ('c3150207-4bf9-4ce4-8478-2e6369c46749', 'Main Branch - Downtown', '123 Main Street, Downtown Area', '+919876543210', 1, true),
  ('c3150207-4bf9-4ce4-8478-2e6369c46749', 'North Branch - Mall Road', '456 Mall Road, North Shopping Complex', '+919876543211', 2, true),
  ('c3150207-4bf9-4ce4-8478-2e6369c46749', 'South Branch - Lake View', '789 Lake View Avenue, South District', '+919876543212', 3, true)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 7. UPDATE EXISTING BUSINESS
-- ============================================
UPDATE businesses
SET
  supports_delivery = true,
  supports_takeaway = true,
  delivery_fee = 40,
  free_delivery_above = 500,
  delivery_radius_km = 10.0
WHERE id = 'c3150207-4bf9-4ce4-8478-2e6369c46749';

-- ============================================
-- 8. CREATE HELPER VIEWS
-- ============================================

-- View for active sessions with fulfillment details
CREATE OR REPLACE VIEW sessions_with_fulfillment AS
SELECT
  s.*,
  bo.outlet_name,
  bo.address as outlet_address,
  bo.phone as outlet_phone,
  c.phone as customer_phone,
  c.name as customer_name
FROM sessions s
LEFT JOIN business_outlets bo ON s.pickup_outlet_id = bo.id
LEFT JOIN customers c ON s.customer_id = c.id;

-- ============================================
-- DONE!
-- ============================================
-- Next: Run the TypeScript type updates
