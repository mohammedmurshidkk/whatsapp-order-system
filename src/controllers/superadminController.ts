import { Request, Response } from 'express';
import { supabase } from '../config/database';
import { logger } from '../utils/logger';
import bcrypt from 'bcryptjs';

// Get all businesses with pagination and search
export async function getBusinesses(req: Request, res: Response): Promise<void> {
  try {
    const { search = '', page = '1', limit = '20' } = req.query;
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const offset = (pageNum - 1) * limitNum;

    // Build query
    let query = supabase
      .from('businesses')
      .select('*', { count: 'exact' });

    // Apply search filter
    if (search) {
      query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
    }

    // Apply pagination
    const { data: businesses, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (error) {
      logger.error('Failed to fetch businesses', error);
      res.status(500).json({ error: 'Failed to fetch businesses' });
      return;
    }

    // Get admin count for each business
    const businessIds = businesses?.map(b => b.id) || [];
    const { data: adminCounts } = await supabase
      .from('admin_users')
      .select('business_id')
      .in('business_id', businessIds);

    const adminCountMap: Record<string, number> = {};
    adminCounts?.forEach(a => {
      adminCountMap[a.business_id] = (adminCountMap[a.business_id] || 0) + 1;
    });

    const businessesWithAdminCount = businesses?.map(b => ({
      ...b,
      admin_count: adminCountMap[b.id] || 0,
    }));

    res.status(200).json({
      businesses: businessesWithAdminCount,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limitNum),
      },
    });
  } catch (error) {
    logger.error('Failed to fetch businesses', error);
    res.status(500).json({ error: 'Failed to fetch businesses' });
  }
}

// Get single business by ID
export async function getBusiness(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const { data: business, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    // Get outlets
    const { data: outlets } = await supabase
      .from('business_outlets')
      .select('*')
      .eq('business_id', id)
      .order('display_order');

    // Get admins
    const { data: admins } = await supabase
      .from('admin_users')
      .select('id, email, name, role, is_active, created_at')
      .eq('business_id', id);

    res.status(200).json({
      business,
      outlets: outlets || [],
      admins: admins || [],
    });
  } catch (error) {
    logger.error('Failed to fetch business', error);
    res.status(500).json({ error: 'Failed to fetch business' });
  }
}

// Create a new business
export async function createBusiness(req: Request, res: Response): Promise<void> {
  try {
    const {
      name,
      phone,
      address,
      admin_email,
      admin_password,
      admin_name,
    } = req.body;

    if (!name || !phone) {
      res.status(400).json({ error: 'Name and phone are required' });
      return;
    }

    // if (!admin_email || !admin_password) {
    //   res.status(400).json({ error: 'Admin email and password are required' });
    //   return;
    // }

    // Check if phone already exists
    const { data: existingBusiness } = await supabase
      .from('businesses')
      .select('id')
      .eq('phone', phone)
      .single();

    if (existingBusiness) {
      res.status(400).json({ error: 'A business with this phone number already exists' });
      return;
    }

    // Check if admin email already exists
    // const { data: existingAdmin } = await supabase
    //   .from('admin_users')
    //   .select('id')
    //   .eq('email', admin_email.toLowerCase())
    //   .single();

    // if (existingAdmin) {
    //   res.status(400).json({ error: 'An admin with this email already exists' });
    //   return;
    // }

    // Create business
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .insert({
        name,
        phone,
        address: address || null,
      })
      .select()
      .single();

    if (businessError || !business) {
      logger.error('Failed to create business', businessError);
      res.status(500).json({ error: 'Failed to create business' });
      return;
    }

    // Hash password and create admin user
    // const passwordHash = await bcrypt.hash(admin_password, 10);
    // const { data: admin, error: adminError } = await supabase
    //   .from('admin_users')
    //   .insert({
    //     business_id: business.id,
    //     email: admin_email.toLowerCase(),
    //     password_hash: passwordHash,
    //     name: admin_name || null,
    //     role: 'owner',
    //   })
    //   .select('id, email, name, role')
    //   .single();

    // if (adminError) {
    //   // Rollback: delete business if admin creation fails
    //   await supabase.from('businesses').delete().eq('id', business.id);
    //   logger.error('Failed to create admin user', adminError);
    //   res.status(500).json({ error: 'Failed to create admin user' });
    //   return;
    // }

    logger.info(`Business created: ${name} (${business.id})`);

    res.status(201).json({
      business,
      // admin,
    });
  } catch (error) {
    logger.error('Failed to create business', error);
    res.status(500).json({ error: 'Failed to create business' });
  }
}

// Update a business
export async function updateBusiness(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { name, phone, address, is_active } = req.body;

    const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (address !== undefined) updateData.address = address;
    if (is_active !== undefined) updateData.is_active = is_active;

    const { data: business, error } = await supabase
      .from('businesses')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error || !business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    logger.info(`Business updated: ${business.name} (${id})`);

    res.status(200).json({ business });
  } catch (error) {
    logger.error('Failed to update business', error);
    res.status(500).json({ error: 'Failed to update business' });
  }
}

// Toggle business active status
export async function toggleBusinessStatus(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    // Get current status
    const { data: business, error: fetchError } = await supabase
      .from('businesses')
      .select('is_active')
      .eq('id', id)
      .single();

    if (fetchError || !business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    // Toggle status
    const { data: updatedBusiness, error } = await supabase
      .from('businesses')
      .update({ is_active: !business.is_active, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: 'Failed to toggle business status' });
      return;
    }

    logger.info(`Business status toggled: ${id} -> ${updatedBusiness?.is_active}`);

    res.status(200).json({ business: updatedBusiness });
  } catch (error) {
    logger.error('Failed to toggle business status', error);
    res.status(500).json({ error: 'Failed to toggle business status' });
  }
}

// Add admin to business
export async function addBusinessAdmin(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { email, password, name, role = 'admin' } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    // Check if business exists
    const { data: business } = await supabase
      .from('businesses')
      .select('id')
      .eq('id', id)
      .single();

    if (!business) {
      res.status(404).json({ error: 'Business not found' });
      return;
    }

    // Check if email already exists
    const { data: existingAdmin } = await supabase
      .from('admin_users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    if (existingAdmin) {
      res.status(400).json({ error: 'An admin with this email already exists' });
      return;
    }

    // Create admin
    const passwordHash = await bcrypt.hash(password, 10);
    const { data: admin, error } = await supabase
      .from('admin_users')
      .insert({
        business_id: id,
        email: email.toLowerCase(),
        password_hash: passwordHash,
        name: name || null,
        role,
      })
      .select('id, email, name, role, is_active, created_at')
      .single();

    if (error) {
      logger.error('Failed to create admin', error);
      res.status(500).json({ error: 'Failed to create admin' });
      return;
    }

    logger.info(`Admin added to business ${id}: ${email}`);

    res.status(201).json({ admin });
  } catch (error) {
    logger.error('Failed to add admin', error);
    res.status(500).json({ error: 'Failed to add admin' });
  }
}

// Delete admin from business
export async function deleteBusinessAdmin(req: Request, res: Response): Promise<void> {
  try {
    const { id, adminId } = req.params;

    // Check if this is the last owner
    const { data: owners } = await supabase
      .from('admin_users')
      .select('id')
      .eq('business_id', id)
      .eq('role', 'owner');

    const { data: adminToDelete } = await supabase
      .from('admin_users')
      .select('role')
      .eq('id', adminId)
      .single();

    if (adminToDelete?.role === 'owner' && owners?.length === 1) {
      res.status(400).json({ error: 'Cannot delete the only owner of a business' });
      return;
    }

    const { error } = await supabase
      .from('admin_users')
      .delete()
      .eq('id', adminId)
      .eq('business_id', id);

    if (error) {
      res.status(500).json({ error: 'Failed to delete admin' });
      return;
    }

    logger.info(`Admin deleted from business ${id}: ${adminId}`);

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Failed to delete admin', error);
    res.status(500).json({ error: 'Failed to delete admin' });
  }
}
