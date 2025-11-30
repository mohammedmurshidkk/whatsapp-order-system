-- Run these in Supabase SQL Editor

-- Business/Tenant table (for SaaS multi-tenancy)
CREATE TABLE IF NOT EXISTS businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  phone VARCHAR(20) UNIQUE NOT NULL,  -- WhatsApp business number
  address TEXT,
  welcome_message TEXT DEFAULT 'Welcome! How can I help you today?',
  closing_message TEXT DEFAULT 'Thank you for ordering with us! Have a great day!',
  currency VARCHAR(10) DEFAULT 'INR',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Menu categories
CREATE TABLE IF NOT EXISTS menu_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  display_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Menu items
CREATE TABLE IF NOT EXISTS menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  category_id UUID REFERENCES menu_categories(id) ON DELETE SET NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  price DECIMAL(10,2),
  sizes JSONB,  -- e.g., [{"name": "500g", "price": 350}, {"name": "1kg", "price": 600}]
  is_customizable BOOLEAN DEFAULT false,  -- Can have custom text (like cakes)
  requires_date BOOLEAN DEFAULT false,  -- Needs delivery/pickup date
  is_available BOOLEAN DEFAULT true,
  special_notes TEXT,  -- Notes shown to customer (e.g., "Best before 6 hours", "Shake before use")
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add business_id to existing tables
ALTER TABLE customers ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);

-- Add AI pause columns to sessions (for human takeover)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ai_paused BOOLEAN DEFAULT false;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS paused_at TIMESTAMP;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS paused_by VARCHAR(100);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_menu_items_business ON menu_items(business_id);
CREATE INDEX IF NOT EXISTS idx_menu_categories_business ON menu_categories(business_id);
CREATE INDEX IF NOT EXISTS idx_customers_business ON customers(business_id);
CREATE INDEX IF NOT EXISTS idx_sessions_business ON sessions(business_id);

-- Insert sample business (replace with your actual WhatsApp number)
INSERT INTO businesses (name, phone, address, welcome_message, closing_message)
VALUES (
  'Sample Cafe & Bakery',
  '15551454496',  -- Your WhatsApp business number without +
  'Main Street, Kerala',
  'Welcome to Sample Cafe! 🎂☕ What would you like to order today?',
  'Thank you for your order! We look forward to serving you. Have a wonderful day! 🙏'
) ON CONFLICT (phone) DO NOTHING;

-- Get the business ID for sample data
DO $$
DECLARE
  biz_id UUID;
BEGIN
  SELECT id INTO biz_id FROM businesses WHERE phone = '15551454496';

  -- Insert categories
  INSERT INTO menu_categories (business_id, name, description, display_order) VALUES
    (biz_id, 'Cakes', 'Fresh baked cakes for all occasions', 1),
    (biz_id, 'Hot Beverages', 'Coffee, tea and more', 2),
    (biz_id, 'Cold Beverages', 'Refreshing cold drinks', 3),
    (biz_id, 'Snacks', 'Quick bites and sandwiches', 4);
END $$;

-- Insert menu items (run after categories are created)
DO $$
DECLARE
  biz_id UUID;
  cake_cat UUID;
  hot_cat UUID;
  cold_cat UUID;
  snack_cat UUID;
BEGIN
  SELECT id INTO biz_id FROM businesses WHERE phone = '15551454496';
  SELECT id INTO cake_cat FROM menu_categories WHERE business_id = biz_id AND name = 'Cakes';
  SELECT id INTO hot_cat FROM menu_categories WHERE business_id = biz_id AND name = 'Hot Beverages';
  SELECT id INTO cold_cat FROM menu_categories WHERE business_id = biz_id AND name = 'Cold Beverages';
  SELECT id INTO snack_cat FROM menu_categories WHERE business_id = biz_id AND name = 'Snacks';

  -- Cakes
  INSERT INTO menu_items (business_id, category_id, name, description, sizes, is_customizable, requires_date) VALUES
    (biz_id, cake_cat, 'Black Forest', 'Classic black forest cake with cherries', '[{"name": "500g", "price": 400}, {"name": "1kg", "price": 750}, {"name": "2kg", "price": 1400}]', true, true),
    (biz_id, cake_cat, 'Chocolate Cake', 'Rich chocolate truffle cake', '[{"name": "500g", "price": 350}, {"name": "1kg", "price": 650}, {"name": "2kg", "price": 1200}]', true, true),
    (biz_id, cake_cat, 'Pineapple Cake', 'Fresh pineapple cream cake', '[{"name": "500g", "price": 350}, {"name": "1kg", "price": 650}, {"name": "2kg", "price": 1200}]', true, true),
    (biz_id, cake_cat, 'Red Velvet', 'Premium red velvet cake', '[{"name": "500g", "price": 450}, {"name": "1kg", "price": 850}, {"name": "2kg", "price": 1600}]', true, true),
    (biz_id, cake_cat, 'Butterscotch', 'Creamy butterscotch cake', '[{"name": "500g", "price": 350}, {"name": "1kg", "price": 650}, {"name": "2kg", "price": 1200}]', true, true);

  -- Hot Beverages
  INSERT INTO menu_items (business_id, category_id, name, description, sizes, is_customizable, requires_date) VALUES
    (biz_id, hot_cat, 'Coffee', 'Fresh brewed coffee', '[{"name": "small", "price": 30}, {"name": "medium", "price": 50}, {"name": "large", "price": 70}]', false, false),
    (biz_id, hot_cat, 'Tea', 'Kerala style chai', '[{"name": "small", "price": 20}, {"name": "medium", "price": 30}, {"name": "large", "price": 40}]', false, false),
    (biz_id, hot_cat, 'Hot Chocolate', 'Rich hot chocolate', '[{"name": "small", "price": 60}, {"name": "medium", "price": 80}, {"name": "large", "price": 100}]', false, false);

  -- Cold Beverages
  INSERT INTO menu_items (business_id, category_id, name, description, sizes, is_customizable, requires_date) VALUES
    (biz_id, cold_cat, 'Cool Coffee', 'Iced coffee', '[{"name": "small", "price": 50}, {"name": "medium", "price": 70}, {"name": "large", "price": 90}]', false, false),
    (biz_id, cold_cat, 'Mango Shake', 'Fresh mango milkshake', '[{"name": "medium", "price": 80}, {"name": "large", "price": 100}]', false, false),
    (biz_id, cold_cat, 'Fresh Lime', 'Refreshing lime soda', '[{"name": "regular", "price": 40}]', false, false);

  -- Snacks
  INSERT INTO menu_items (business_id, category_id, name, description, sizes, is_customizable, requires_date) VALUES
    (biz_id, snack_cat, 'Sandwich', 'Veg club sandwich', '[{"name": "regular", "price": 80}]', false, false),
    (biz_id, snack_cat, 'Burger', 'Veg burger with fries', '[{"name": "regular", "price": 120}]', false, false),
    (biz_id, snack_cat, 'Samosa', 'Crispy samosa (2 pcs)', '[{"name": "regular", "price": 30}]', false, false);
END $$;
