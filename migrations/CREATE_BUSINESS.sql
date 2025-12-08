-- ============================================
-- CREATE BUSINESS - Add a new business/tenant
-- ============================================

-- Example: Create a new business
-- Replace the values below with actual business details

INSERT INTO businesses (
  name,
  phone,
  address,
  welcome_message,
  closing_message,
  currency,
  is_active,
  supports_delivery,
  supports_takeaway,
  delivery_fee,
  free_delivery_above,
  delivery_radius_km
) VALUES (
  'My Bakery Shop',                                          -- Business name
  '919876543210',                                            -- WhatsApp phone number (country code + number)
  '123 Main Street, City, State 12345',                     -- Business address
  'Welcome to My Bakery! How can I help you today?',        -- Welcome message
  'Thank you for ordering! We''ll prepare your order soon.', -- Closing message
  '₹',                                                       -- Currency symbol
  true,                                                      -- Is active
  true,                                                      -- Supports delivery
  true,                                                      -- Supports takeaway
  50.00,                                                     -- Delivery fee
  500.00,                                                    -- Free delivery above this amount
  10.00                                                      -- Delivery radius in km
) RETURNING id, name, phone;

-- ============================================
-- After creating the business, note down the ID
-- Use this ID to upload menu and add-ons via the upload interface at:
-- http://localhost:3000/upload.html
-- ============================================

O - 0ddd0592-88c3-4c57-bc92-6c431fc589c0