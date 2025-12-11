-- Migration: Add admin users table and business custom fields
-- Run this after 002_add_addons_system.sql

-- =====================================================
-- 1. Admin Users Table
-- =====================================================
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'admin', -- 'owner', 'admin', 'staff'
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for email lookup
CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);
CREATE INDEX IF NOT EXISTS idx_admin_users_business ON admin_users(business_id);

-- =====================================================
-- 2. Add new fields to businesses table
-- =====================================================

-- Logo URL
ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Custom AI prompt - business-specific instructions for AI
-- Examples: "If customer orders cake, always ask for delivery date"
-- "For Fruits category, inform no delivery available"
ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS custom_ai_prompt TEXT;

-- Critical message - when enabled, this message is sent instead of AI responses
-- Use case: Business temporarily closed, phone number change, emergencies
ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS critical_message TEXT;

ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS critical_message_enabled BOOLEAN DEFAULT false;

-- =====================================================
-- 3. Add image_url to menu_items
-- =====================================================
ALTER TABLE menu_items
ADD COLUMN IF NOT EXISTS image_url TEXT;

-- =====================================================
-- 4. Create storage buckets (run in Supabase Dashboard > Storage)
-- =====================================================
-- Note: These need to be created via Supabase Dashboard or API:
-- 1. menu-images bucket (public)
-- 2. business-assets bucket (public)

-- SQL to make buckets public (run in SQL editor):
-- INSERT INTO storage.buckets (id, name, public) VALUES ('menu-images', 'menu-images', true);
-- INSERT INTO storage.buckets (id, name, public) VALUES ('business-assets', 'business-assets', true);

-- =====================================================
-- 5. Helper function to create admin user with hashed password
-- =====================================================
-- Usage: SELECT create_admin_user('business-uuid', 'admin@example.com', 'password123', 'Admin Name');

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

-- =====================================================
-- 6. RLS Policies for admin_users
-- =====================================================
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role has full access to admin_users" ON admin_users
  FOR ALL USING (true);

-- =====================================================
-- Sample: Create an admin user (update with your business ID)
-- =====================================================
-- Replace 'your-business-uuid' with actual business ID
-- SELECT create_admin_user(
--   'your-business-uuid',
--   'admin@yourbusiness.com',
--   'your-secure-password',
--   'Admin Name'
-- );

-- =====================================================
-- Quick verification queries
-- =====================================================
-- Check admin_users table exists:
-- SELECT * FROM admin_users LIMIT 1;

-- Check new business columns:
-- SELECT id, name, logo_url, custom_ai_prompt, critical_message, critical_message_enabled FROM businesses LIMIT 1;

-- Check menu_items image_url:
-- SELECT id, name, image_url FROM menu_items LIMIT 1;
