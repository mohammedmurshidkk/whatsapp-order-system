import { Response } from 'express';
import { supabase } from '../../../config/database';
import { AuthRequest, getBusinessId } from '../../../middleware/auth';
import { logger } from '../../../utils/logger';

// List all amenities for a business
export async function listAmenities(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { data: amenities, error } = await supabase
      .from('business_amenities')
      .select('*')
      .eq('business_id', businessId)
      .order('display_order', { ascending: true });

    if (error) {
      throw error;
    }

    res.status(200).json({ amenities: amenities || [] });
  } catch (error) {
    logger.error('Failed to list amenities', error);
    res.status(500).json({ error: 'Failed to fetch amenities' });
  }
}

// Get single amenity
export async function getAmenity(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { amenityId } = req.params;

    const { data: amenity, error } = await supabase
      .from('business_amenities')
      .select('*')
      .eq('id', amenityId)
      .eq('business_id', businessId)
      .single();

    if (error || !amenity) {
      res.status(404).json({ error: 'Amenity not found' });
      return;
    }

    res.status(200).json({ amenity });
  } catch (error) {
    logger.error('Failed to get amenity', error);
    res.status(500).json({ error: 'Failed to fetch amenity' });
  }
}

// Create amenity
export async function createAmenity(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, slug, description, image_url, images, is_active = true } = req.body;

    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    if (!slug) {
      res.status(400).json({ error: 'slug is required' });
      return;
    }

    if (!description) {
      res.status(400).json({ error: 'description is required' });
      return;
    }

    // Normalize slug
    const normalizedSlug = slug.toLowerCase().replace(/\s+/g, '_');

    // Check for duplicate slug
    const { data: existing } = await supabase
      .from('business_amenities')
      .select('id')
      .eq('business_id', businessId)
      .eq('slug', normalizedSlug)
      .single();

    if (existing) {
      res.status(400).json({ error: 'An amenity with this slug already exists' });
      return;
    }

    // Get max display_order
    const { data: maxOrder } = await supabase
      .from('business_amenities')
      .select('display_order')
      .eq('business_id', businessId)
      .order('display_order', { ascending: false })
      .limit(1)
      .single();

    const displayOrder = (maxOrder?.display_order || 0) + 1;

    const { data: amenity, error } = await supabase
      .from('business_amenities')
      .insert({
        business_id: businessId,
        name,
        slug: normalizedSlug,
        description,
        image_url: image_url || null,
        images: images || [],
        is_active,
        display_order: displayOrder,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    logger.info(`Amenity created: ${name}`);

    res.status(201).json({ amenity });
  } catch (error) {
    logger.error('Failed to create amenity', error);
    res.status(500).json({ error: 'Failed to create amenity' });
  }
}

// Update amenity
export async function updateAmenity(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { amenityId } = req.params;
    const { name, slug, description, image_url, images, is_active, display_order } = req.body;

    // Verify amenity belongs to this business
    const { data: existing } = await supabase
      .from('business_amenities')
      .select('id')
      .eq('id', amenityId)
      .eq('business_id', businessId)
      .single();

    if (!existing) {
      res.status(404).json({ error: 'Amenity not found' });
      return;
    }

    // Build update object
    const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name;
    if (slug !== undefined) updateData.slug = slug.toLowerCase().replace(/\s+/g, '_');
    if (description !== undefined) updateData.description = description;
    if (image_url !== undefined) updateData.image_url = image_url;
    if (images !== undefined) updateData.images = images;
    if (is_active !== undefined) updateData.is_active = is_active;
    if (display_order !== undefined) updateData.display_order = display_order;

    // Check for duplicate slug if updating slug
    if (slug !== undefined) {
      const { data: duplicateSlug } = await supabase
        .from('business_amenities')
        .select('id')
        .eq('business_id', businessId)
        .eq('slug', updateData.slug)
        .neq('id', amenityId)
        .single();

      if (duplicateSlug) {
        res.status(400).json({ error: 'An amenity with this slug already exists' });
        return;
      }
    }

    const { data: amenity, error } = await supabase
      .from('business_amenities')
      .update(updateData)
      .eq('id', amenityId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    logger.info(`Amenity updated: ${amenityId}`);

    res.status(200).json({ amenity });
  } catch (error) {
    logger.error('Failed to update amenity', error);
    res.status(500).json({ error: 'Failed to update amenity' });
  }
}

// Delete amenity
export async function deleteAmenity(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { amenityId } = req.params;

    // Verify amenity belongs to this business
    const { data: existing } = await supabase
      .from('business_amenities')
      .select('id')
      .eq('id', amenityId)
      .eq('business_id', businessId)
      .single();

    if (!existing) {
      res.status(404).json({ error: 'Amenity not found' });
      return;
    }

    const { error } = await supabase
      .from('business_amenities')
      .delete()
      .eq('id', amenityId);

    if (error) {
      throw error;
    }

    logger.info(`Amenity deleted: ${amenityId}`);

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Failed to delete amenity', error);
    res.status(500).json({ error: 'Failed to delete amenity' });
  }
}

// Upload/update amenity image
export async function uploadAmenityImage(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { amenityId } = req.params;
    const { image_url } = req.body;

    if (!image_url) {
      res.status(400).json({ error: 'image_url is required' });
      return;
    }

    // Verify amenity belongs to this business
    const { data: existing } = await supabase
      .from('business_amenities')
      .select('id')
      .eq('id', amenityId)
      .eq('business_id', businessId)
      .single();

    if (!existing) {
      res.status(404).json({ error: 'Amenity not found' });
      return;
    }

    const { data: amenity, error } = await supabase
      .from('business_amenities')
      .update({
        image_url,
        updated_at: new Date().toISOString(),
      })
      .eq('id', amenityId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    logger.info(`Amenity image updated: ${amenityId}`);

    res.status(200).json({ amenity });
  } catch (error) {
    logger.error('Failed to update amenity image', error);
    res.status(500).json({ error: 'Failed to update amenity image' });
  }
}

// Upload amenity image file(s) (multipart/form-data)
// Supports multiple images - appends to images array
// Use ?replace=true to replace existing images instead of appending
export async function uploadAmenityImageFile(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { amenityId } = req.params;
    const replaceExisting = req.query.replace === 'true';

    // Handle both single file (req.file) and multiple files (req.files)
    const files = req.files as Express.Multer.File[] | undefined;
    const singleFile = req.file;
    const uploadFiles = files?.length ? files : (singleFile ? [singleFile] : []);

    if (uploadFiles.length === 0) {
      res.status(400).json({ error: 'No image file(s) uploaded' });
      return;
    }

    // Verify amenity belongs to this business
    const { data: existing } = await supabase
      .from('business_amenities')
      .select('id, image_url, images')
      .eq('id', amenityId)
      .eq('business_id', businessId)
      .single();

    if (!existing) {
      res.status(404).json({ error: 'Amenity not found' });
      return;
    }

    // If replacing, delete old images from storage
    if (replaceExisting && existing.images?.length > 0) {
      const oldPaths = existing.images
        .map((url: string) => url.split('/business-assets/')[1])
        .filter(Boolean);
      if (oldPaths.length > 0) {
        try {
          await supabase.storage.from('business-assets').remove(oldPaths);
        } catch (e) {
          logger.warn('Failed to delete old amenity images', e);
        }
      }
    }

    // Upload all files to Supabase Storage
    const uploadedUrls: string[] = [];
    for (let i = 0; i < uploadFiles.length; i++) {
      const file = uploadFiles[i];
      const fileExt = file.mimetype.split('/')[1] || 'jpg';
      const fileName = `amenities/${businessId}/${amenityId}-${Date.now()}-${i}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('business-assets')
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
          upsert: true,
        });

      if (uploadError) {
        logger.error(`Failed to upload amenity image ${i} to storage`, uploadError);
        continue; // Skip failed uploads but continue with others
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('business-assets')
        .getPublicUrl(fileName);

      uploadedUrls.push(urlData.publicUrl);
    }

    if (uploadedUrls.length === 0) {
      res.status(500).json({ error: 'Failed to upload any images' });
      return;
    }

    // Build final images array
    const existingImages = replaceExisting ? [] : (existing.images || []);
    const finalImages = [...existingImages, ...uploadedUrls];

    // Update amenity with images array
    // Also set image_url to first image for backwards compatibility
    const { data: amenity, error } = await supabase
      .from('business_amenities')
      .update({
        images: finalImages,
        image_url: finalImages[0] || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', amenityId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    logger.info(`Amenity images uploaded: ${amenityId} (${uploadedUrls.length} files)`);

    res.status(200).json({
      amenity,
      uploaded_urls: uploadedUrls,
      total_images: finalImages.length,
    });
  } catch (error) {
    logger.error('Failed to upload amenity image', error);
    res.status(500).json({ error: 'Failed to upload amenity image' });
  }
}

// Toggle amenity active status
export async function toggleAmenityStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { amenityId } = req.params;

    // Get current status
    const { data: existing } = await supabase
      .from('business_amenities')
      .select('id, is_active')
      .eq('id', amenityId)
      .eq('business_id', businessId)
      .single();

    if (!existing) {
      res.status(404).json({ error: 'Amenity not found' });
      return;
    }

    const newStatus = !existing.is_active;

    const { data: amenity, error } = await supabase
      .from('business_amenities')
      .update({
        is_active: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', amenityId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    logger.info(`Amenity status toggled: ${amenityId} -> ${newStatus}`);

    res.status(200).json({ amenity });
  } catch (error) {
    logger.error('Failed to toggle amenity status', error);
    res.status(500).json({ error: 'Failed to toggle amenity status' });
  }
}
