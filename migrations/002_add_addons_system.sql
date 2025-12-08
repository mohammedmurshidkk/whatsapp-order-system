-- Migration: Add-ons System (Phase 2)
-- Run this in your Supabase SQL Editor

-- ============================================
-- 1. CREATE MENU ADD-ONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS menu_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50), -- 'candle', 'packing', 'topping', 'extra', etc.
  description TEXT,
  price DECIMAL(10, 2), -- NULL means FREE
  is_available BOOLEAN DEFAULT true,
  display_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_addons_business
  ON menu_addons(business_id) WHERE is_available = true;

CREATE INDEX IF NOT EXISTS idx_addons_category
  ON menu_addons(category) WHERE is_available = true;

-- ============================================
-- 2. CREATE CATEGORY-ADDONS JUNCTION TABLE
-- ============================================
-- Links menu categories to available add-ons
-- with auto-suggestion rules
CREATE TABLE IF NOT EXISTS category_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_category_id UUID REFERENCES menu_categories(id) ON DELETE CASCADE,
  addon_id UUID REFERENCES menu_addons(id) ON DELETE CASCADE,
  is_auto_suggested BOOLEAN DEFAULT false, -- Auto-ask when this category ordered
  suggestion_priority INT DEFAULT 0, -- Order of suggestions (1 = first)
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(menu_category_id, addon_id)
);

CREATE INDEX IF NOT EXISTS idx_category_addons_category
  ON category_addons(menu_category_id) WHERE is_auto_suggested = true;

-- ============================================
-- 3. CREATE SESSION ITEM ADD-ONS TABLE
-- ============================================
-- Tracks which add-ons are added to which session items
CREATE TABLE IF NOT EXISTS session_item_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_item_id UUID REFERENCES session_items(id) ON DELETE CASCADE,
  addon_id UUID REFERENCES menu_addons(id),
  addon_name VARCHAR(100) NOT NULL, -- Denormalized for history
  quantity INT DEFAULT 1,
  unit_price DECIMAL(10, 2), -- Price at time of order (NULL = free)
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_item_addons_session_item
  ON session_item_addons(session_item_id);

-- ============================================
-- 4. INSERT SAMPLE ADD-ONS (for demo)
-- ============================================
-- Note: Replace 'YOUR_BUSINESS_ID' with your actual business_id

-- Candles (for cakes)
INSERT INTO menu_addons (business_id, name, category, description, price, display_order)
VALUES
  ('c3150207-4bf9-4ce4-8478-2e6369c46749', 'Standard Candle (Free)', 'candle', 'Basic birthday candle', NULL, 1),
  ('c3150207-4bf9-4ce4-8478-2e6369c46749', 'Number Candle', 'candle', 'Custom number candle', 50, 2),
  ('c3150207-4bf9-4ce4-8478-2e6369c46749', 'Sparkler Candle', 'candle', 'Musical sparkler candle', 100, 3)
ON CONFLICT (id) DO NOTHING;

-- Packing options
INSERT INTO menu_addons (business_id, name, category, description, price, display_order)
VALUES
  ('c3150207-4bf9-4ce4-8478-2e6369c46749', 'Standard Packing (Free)', 'packing', 'Basic packaging', NULL, 1),
  ('c3150207-4bf9-4ce4-8478-2e6369c46749', 'Gift Box', 'packing', 'Premium gift box with ribbon', 80, 2),
  ('c3150207-4bf9-4ce4-8478-2e6369c46749', 'Thermal Bag', 'packing', 'Insulated thermal bag', 50, 3)
ON CONFLICT (id) DO NOTHING;

-- Toppings/Extras (for snacks/burgers)
INSERT INTO menu_addons (business_id, name, category, description, price, display_order)
VALUES
  ('c3150207-4bf9-4ce4-8478-2e6369c46749', 'Extra Cheese', 'topping', 'Additional cheese slice', 20, 1),
  ('c3150207-4bf9-4ce4-8478-2e6369c46749', 'Extra Sauce', 'topping', 'Extra sauce packet', 10, 2),
  ('c3150207-4bf9-4ce4-8478-2e6369c46749', 'Extra Patty', 'topping', 'Additional burger patty', 50, 3)
ON CONFLICT (id) DO NOTHING;

-- Beverage extras
INSERT INTO menu_addons (business_id, name, category, description, price, display_order)
VALUES
  ('c3150207-4bf9-4ce4-8478-2e6369c46749', 'Extra Shot', 'beverage_extra', 'Extra espresso shot', 30, 1),
  ('c3150207-4bf9-4ce4-8478-2e6369c46749', 'Whipped Cream', 'beverage_extra', 'Whipped cream topping', 20, 2),
  ('c3150207-4bf9-4ce4-8478-2e6369c46749', 'Flavor Syrup', 'beverage_extra', 'Vanilla/Caramel/Hazelnut', 25, 3)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 5. LINK ADD-ONS TO CATEGORIES (Auto-Suggestions)
-- ============================================
-- First, get category IDs (adjust based on your actual categories)

-- Link candles to Cakes category (auto-suggested)
INSERT INTO category_addons (menu_category_id, addon_id, is_auto_suggested, suggestion_priority)
SELECT
  mc.id,
  ma.id,
  true,
  1
FROM menu_categories mc
CROSS JOIN menu_addons ma
WHERE mc.name = 'Cakes'
  AND ma.category = 'candle'
  AND mc.business_id = 'c3150207-4bf9-4ce4-8478-2e6369c46749'
  AND ma.business_id = 'c3150207-4bf9-4ce4-8478-2e6369c46749'
ON CONFLICT (menu_category_id, addon_id) DO NOTHING;

-- Link packing to Cakes category (auto-suggested)
INSERT INTO category_addons (menu_category_id, addon_id, is_auto_suggested, suggestion_priority)
SELECT
  mc.id,
  ma.id,
  true,
  2
FROM menu_categories mc
CROSS JOIN menu_addons ma
WHERE mc.name = 'Cakes'
  AND ma.category = 'packing'
  AND mc.business_id = 'c3150207-4bf9-4ce4-8478-2e6369c46749'
  AND ma.business_id = 'c3150207-4bf9-4ce4-8478-2e6369c46749'
ON CONFLICT (menu_category_id, addon_id) DO NOTHING;

-- Link toppings to Snacks category (auto-suggested)
INSERT INTO category_addons (menu_category_id, addon_id, is_auto_suggested, suggestion_priority)
SELECT
  mc.id,
  ma.id,
  true,
  1
FROM menu_categories mc
CROSS JOIN menu_addons ma
WHERE mc.name = 'Snacks'
  AND ma.category = 'topping'
  AND mc.business_id = 'c3150207-4bf9-4ce4-8478-2e6369c46749'
  AND ma.business_id = 'c3150207-4bf9-4ce4-8478-2e6369c46749'
ON CONFLICT (menu_category_id, addon_id) DO NOTHING;

-- Link beverage extras to Hot Beverages category (auto-suggested)
INSERT INTO category_addons (menu_category_id, addon_id, is_auto_suggested, suggestion_priority)
SELECT
  mc.id,
  ma.id,
  true,
  1
FROM menu_categories mc
CROSS JOIN menu_addons ma
WHERE mc.name = 'Hot Beverages'
  AND ma.category = 'beverage_extra'
  AND mc.business_id = 'c3150207-4bf9-4ce4-8478-2e6369c46749'
  AND ma.business_id = 'c3150207-4bf9-4ce4-8478-2e6369c46749'
ON CONFLICT (menu_category_id, addon_id) DO NOTHING;

-- Link beverage extras to Cold Beverages category (auto-suggested)
INSERT INTO category_addons (menu_category_id, addon_id, is_auto_suggested, suggestion_priority)
SELECT
  mc.id,
  ma.id,
  true,
  1
FROM menu_categories mc
CROSS JOIN menu_addons ma
WHERE mc.name = 'Cold Beverages'
  AND ma.category = 'beverage_extra'
  AND mc.business_id = 'c3150207-4bf9-4ce4-8478-2e6369c46749'
  AND ma.business_id = 'c3150207-4bf9-4ce4-8478-2e6369c46749'
ON CONFLICT (menu_category_id, addon_id) DO NOTHING;

-- ============================================
-- 6. CREATE HELPER VIEWS
-- ============================================

-- View for session items with add-ons
CREATE OR REPLACE VIEW session_items_with_addons AS
SELECT
  si.*,
  json_agg(
    json_build_object(
      'id', sia.id,
      'addon_id', sia.addon_id,
      'addon_name', sia.addon_name,
      'quantity', sia.quantity,
      'unit_price', sia.unit_price
    )
  ) FILTER (WHERE sia.id IS NOT NULL) as addons
FROM session_items si
LEFT JOIN session_item_addons sia ON si.id = sia.session_item_id
GROUP BY si.id;

-- View for category add-ons (for easy lookup)
CREATE OR REPLACE VIEW category_available_addons AS
SELECT
  ca.menu_category_id,
  mc.name as category_name,
  ma.*,
  ca.is_auto_suggested,
  ca.suggestion_priority
FROM category_addons ca
JOIN menu_addons ma ON ca.addon_id = ma.id
JOIN menu_categories mc ON ca.menu_category_id = mc.id
WHERE ma.is_available = true
ORDER BY ca.menu_category_id, ca.suggestion_priority, ma.display_order;

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check add-ons
-- SELECT * FROM menu_addons WHERE business_id = 'YOUR_BUSINESS_ID';

-- Check category-addon relationships
-- SELECT * FROM category_available_addons;

-- Check session item add-ons
-- SELECT * FROM session_items_with_addons;

-- ============================================
-- DONE!
-- ============================================
-- Next: Update TypeScript types
