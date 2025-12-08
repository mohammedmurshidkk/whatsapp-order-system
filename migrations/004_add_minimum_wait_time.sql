-- Migration: Add minimum wait time field to businesses
-- Run this after 003_add_admin_users_and_business_fields.sql

-- =====================================================
-- Add minimum_wait_minutes to businesses table
-- =====================================================
-- This field defines the minimum wait time for orders (no ASAP option)
-- Default is 30 minutes, but each business can customize

ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS minimum_wait_minutes INTEGER DEFAULT 30;

-- =====================================================
-- Verification query
-- =====================================================
-- SELECT id, name, minimum_wait_minutes FROM businesses LIMIT 5;
