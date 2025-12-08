import { Response } from 'express';
import { supabase } from '../config/database';
import { AuthRequest, getBusinessId } from '../middleware/auth';
import { logger } from '../utils/logger';

// Get business profile
export async function getProfile(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Get business
    const { data: business, error: bizError } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', businessId)
      .single();

    if (bizError || !business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    // Get outlets
    const { data: outlets } = await supabase
      .from('business_outlets')
      .select('*')
      .eq('business_id', businessId)
      .order('display_order', { ascending: true });

    res.status(200).json({
      business: {
        id: business.id,
        name: business.name,
        phone: business.phone, // Read-only
        address: business.address,
        logo_url: business.logo_url || null,
        welcome_message: business.welcome_message,
        closing_message: business.closing_message,
        currency: business.currency,
        is_active: business.is_active,
        // Custom AI prompt for business-specific rules
        custom_ai_prompt: business.custom_ai_prompt || null,
        // Critical message - when set, overrides all AI responses
        critical_message: business.critical_message || null,
        critical_message_enabled: business.critical_message_enabled || false,
        // Delivery settings
        supports_delivery: business.supports_delivery,
        supports_takeaway: business.supports_takeaway,
        delivery_fee: business.delivery_fee,
        free_delivery_above: business.free_delivery_above,
        delivery_radius_km: business.delivery_radius_km,
        created_at: business.created_at,
        outlets: outlets || [],
      },
    });
  } catch (error) {
    logger.error('Failed to get business profile', error);
    res.status(500).json({ error: 'Failed to fetch business profile' });
  }
}

// Update business profile
export async function updateProfile(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const {
      name,
      address,
      welcome_message,
      closing_message,
      custom_ai_prompt,
      critical_message,
      critical_message_enabled,
      supports_delivery,
      supports_takeaway,
      delivery_fee,
      free_delivery_above,
      delivery_radius_km,
    } = req.body;

    // Build update object (only include provided fields)
    const updateData: Record<string, any> = { updated_at: new Date().toISOString() };

    if (name !== undefined) updateData.name = name;
    if (address !== undefined) updateData.address = address;
    if (welcome_message !== undefined) updateData.welcome_message = welcome_message;
    if (closing_message !== undefined) updateData.closing_message = closing_message;
    if (custom_ai_prompt !== undefined) updateData.custom_ai_prompt = custom_ai_prompt;
    if (critical_message !== undefined) updateData.critical_message = critical_message;
    if (critical_message_enabled !== undefined) updateData.critical_message_enabled = critical_message_enabled;
    if (supports_delivery !== undefined) updateData.supports_delivery = supports_delivery;
    if (supports_takeaway !== undefined) updateData.supports_takeaway = supports_takeaway;
    if (delivery_fee !== undefined) updateData.delivery_fee = delivery_fee;
    if (free_delivery_above !== undefined) updateData.free_delivery_above = free_delivery_above;
    if (delivery_radius_km !== undefined) updateData.delivery_radius_km = delivery_radius_km;

    const { data: business, error } = await supabase
      .from('businesses')
      .update(updateData)
      .eq('id', businessId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    logger.info(`Business profile updated: ${businessId}`);

    res.status(200).json({ business });
  } catch (error) {
    logger.error('Failed to update business profile', error);
    res.status(500).json({ error: 'Failed to update business profile' });
  }
}

// Upload business logo
export async function uploadLogo(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No logo file uploaded' });
      return;
    }

    // Upload to Supabase Storage
    const fileName = `logos/${businessId}-${Date.now()}.${req.file.mimetype.split('/')[1]}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('business-assets')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
      });

    if (uploadError) {
      logger.error('Failed to upload logo to storage', uploadError);
      res.status(500).json({ error: 'Failed to upload logo' });
      return;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('business-assets')
      .getPublicUrl(fileName);

    const logoUrl = urlData.publicUrl;

    // Update business with logo URL
    await supabase
      .from('businesses')
      .update({ logo_url: logoUrl, updated_at: new Date().toISOString() })
      .eq('id', businessId);

    logger.info(`Logo uploaded for business: ${businessId}`);

    res.status(200).json({ logo_url: logoUrl });
  } catch (error) {
    logger.error('Failed to upload logo', error);
    res.status(500).json({ error: 'Failed to upload logo' });
  }
}

// Create outlet
export async function createOutlet(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { outlet_name, address, phone } = req.body;

    if (!outlet_name || !address) {
      res.status(400).json({ error: 'outlet_name and address are required' });
      return;
    }

    // Get max display_order
    const { data: maxOrder } = await supabase
      .from('business_outlets')
      .select('display_order')
      .eq('business_id', businessId)
      .order('display_order', { ascending: false })
      .limit(1)
      .single();

    const displayOrder = (maxOrder?.display_order || 0) + 1;

    const { data: outlet, error } = await supabase
      .from('business_outlets')
      .insert({
        business_id: businessId,
        outlet_name,
        address,
        phone: phone || null,
        is_active: true,
        display_order: displayOrder,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    logger.info(`Outlet created: ${outlet_name}`);

    res.status(201).json({ outlet });
  } catch (error) {
    logger.error('Failed to create outlet', error);
    res.status(500).json({ error: 'Failed to create outlet' });
  }
}

// Update outlet
export async function updateOutlet(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { outletId } = req.params;
    const { outlet_name, address, phone, is_active } = req.body;

    // Verify outlet belongs to this business
    const { data: existing } = await supabase
      .from('business_outlets')
      .select('id')
      .eq('id', outletId)
      .eq('business_id', businessId)
      .single();

    if (!existing) {
      res.status(404).json({ error: 'Outlet not found' });
      return;
    }

    // Build update object
    const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
    if (outlet_name !== undefined) updateData.outlet_name = outlet_name;
    if (address !== undefined) updateData.address = address;
    if (phone !== undefined) updateData.phone = phone;
    if (is_active !== undefined) updateData.is_active = is_active;

    const { data: outlet, error } = await supabase
      .from('business_outlets')
      .update(updateData)
      .eq('id', outletId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    logger.info(`Outlet updated: ${outletId}`);

    res.status(200).json({ outlet });
  } catch (error) {
    logger.error('Failed to update outlet', error);
    res.status(500).json({ error: 'Failed to update outlet' });
  }
}

// Delete outlet
export async function deleteOutlet(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { outletId } = req.params;

    // Verify outlet belongs to this business
    const { data: existing } = await supabase
      .from('business_outlets')
      .select('id')
      .eq('id', outletId)
      .eq('business_id', businessId)
      .single();

    if (!existing) {
      res.status(404).json({ error: 'Outlet not found' });
      return;
    }

    const { error } = await supabase
      .from('business_outlets')
      .delete()
      .eq('id', outletId);

    if (error) {
      throw error;
    }

    logger.info(`Outlet deleted: ${outletId}`);

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Failed to delete outlet', error);
    res.status(500).json({ error: 'Failed to delete outlet' });
  }
}

// Toggle critical message (quick toggle)
export async function toggleCriticalMessage(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }

    const { error } = await supabase
      .from('businesses')
      .update({
        critical_message_enabled: enabled,
        updated_at: new Date().toISOString(),
      })
      .eq('id', businessId);

    if (error) {
      throw error;
    }

    logger.info(`Critical message ${enabled ? 'enabled' : 'disabled'} for business: ${businessId}`);

    res.status(200).json({ success: true, critical_message_enabled: enabled });
  } catch (error) {
    logger.error('Failed to toggle critical message', error);
    res.status(500).json({ error: 'Failed to toggle critical message' });
  }
}
