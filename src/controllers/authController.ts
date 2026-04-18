import { Request, Response } from 'express';
import { supabase } from '../config/database';
import { generateToken, AuthUser } from '../middleware/auth';
import { logger } from '../utils/logger';
import bcrypt from 'bcryptjs';
import { createAuditLog, getRequestMetadata } from '../services/auditService';

// Login endpoint
export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const normalizedEmail = email.toLowerCase();

    // First check super_admins table
    const { data: superAdmin } = await supabase
      .from('super_admins')
      .select('id, email, password_hash, name')
      .eq('email', normalizedEmail)
      .eq('is_active', true)
      .single();

    if (superAdmin) {
      // Verify superadmin password
      const validPassword = await bcrypt.compare(password, superAdmin.password_hash);
      if (!validPassword) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }

      const authUser: AuthUser = {
        id: superAdmin.id,
        email: superAdmin.email,
        role: 'superadmin',
      };

      const token = generateToken(authUser);

      // Update last login
      await supabase
        .from('super_admins')
        .update({ last_login: new Date().toISOString() })
        .eq('id', superAdmin.id);

      logger.info(`Superadmin login: ${email}`);

      // Audit log successful login
      const { ipAddress, userAgent } = getRequestMetadata(req);
      await createAuditLog({
        adminId: superAdmin.id,
        adminEmail: superAdmin.email,
        adminRole: 'superadmin',
        action: 'auth.login',
        details: { loginType: 'superadmin' },
        ipAddress,
        userAgent,
      });

      res.status(200).json({
        token,
        user: authUser,
      });
      return;
    }

    // If not superadmin, check admin_users table
    const { data: user, error } = await supabase
      .from('admin_users')
      .select(`
        id,
        email,
        password_hash,
        business_id,
        businesses (
          id,
          name,
          plugin_id
        )
      `)
      .eq('email', normalizedEmail)
      .eq('is_active', true)
      .single();

    if (error || !user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Generate JWT token
    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      role: 'admin',
      business_id: user.business_id,
      business_name: (user.businesses as any)?.name || 'Unknown Business',
      plugin_id: (user.businesses as any)?.plugin_id || undefined,
    };

    const token = generateToken(authUser);

    // Update last login
    await supabase
      .from('admin_users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);

    logger.info(`Admin login: ${email}`);

    // Audit log successful login
    const { ipAddress, userAgent } = getRequestMetadata(req);
    await createAuditLog({
      adminId: user.id,
      adminEmail: user.email,
      adminRole: 'admin',
      action: 'auth.login',
      businessId: user.business_id,
      details: { loginType: 'admin' },
      ipAddress,
      userAgent,
    });

    res.status(200).json({
      token,
      user: authUser,
    });
  } catch (error) {
    logger.error('Login failed', error);
    res.status(500).json({ error: 'Login failed' });
  }
}

// Get current user info
export async function me(req: Request, res: Response): Promise<void> {
  try {
    const user = (req as any).user;
    res.status(200).json({ user });
  } catch (error) {
    logger.error('Failed to get user info', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
}

// Change password
export async function changePassword(req: Request, res: Response): Promise<void> {
  try {
    const user = (req as any).user as AuthUser;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current and new password are required' });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ error: 'New password must be at least 6 characters' });
      return;
    }

    const tableName = user.role === 'superadmin' ? 'super_admins' : 'admin_users';

    // Get current password hash
    const { data: userData, error } = await supabase
      .from(tableName)
      .select('password_hash')
      .eq('id', user.id)
      .single();

    if (error || !userData) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Verify current password
    const validPassword = await bcrypt.compare(currentPassword, userData.password_hash);
    if (!validPassword) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    // Hash new password and update
    const newHash = await bcrypt.hash(newPassword, 10);
    await supabase
      .from(tableName)
      .update({ password_hash: newHash, updated_at: new Date().toISOString() })
      .eq('id', user.id);

    logger.info(`Password changed for user: ${user.email}`);

    res.status(200).json({ message: 'Password changed successfully' });
  } catch (error) {
    logger.error('Failed to change password', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
}

// Public change password (no auth required - uses email + current password verification)
export async function changePasswordPublic(req: Request, res: Response): Promise<void> {
  try {
    const { email, currentPassword, newPassword } = req.body;

    if (!email || !currentPassword || !newPassword) {
      res.status(400).json({ error: 'Email, current password, and new password are required' });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ error: 'New password must be at least 6 characters' });
      return;
    }

    const normalizedEmail = email.toLowerCase();

    // Check super_admins first
    let userData: { id: string; password_hash: string } | null = null;
    let tableName = '';

    const { data: superAdmin } = await supabase
      .from('super_admins')
      .select('id, password_hash')
      .eq('email', normalizedEmail)
      .eq('is_active', true)
      .single();

    if (superAdmin) {
      userData = superAdmin;
      tableName = 'super_admins';
    } else {
      // Check admin_users
      const { data: adminUser } = await supabase
        .from('admin_users')
        .select('id, password_hash')
        .eq('email', normalizedEmail)
        .eq('is_active', true)
        .single();

      if (adminUser) {
        userData = adminUser;
        tableName = 'admin_users';
      }
    }

    if (!userData) {
      res.status(404).json({ error: 'User not found or inactive' });
      return;
    }

    // Verify current password
    const validPassword = await bcrypt.compare(currentPassword, userData.password_hash);
    if (!validPassword) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    // Hash new password and update
    const newHash = await bcrypt.hash(newPassword, 10);
    await supabase
      .from(tableName)
      .update({ password_hash: newHash, updated_at: new Date().toISOString() })
      .eq('id', userData.id);

    logger.info(`Password changed via public API for: ${email}`);

    res.status(200).json({ message: 'Password changed successfully' });
  } catch (error) {
    logger.error('Failed to change password (public)', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
}
