import { Response } from 'express';
import { supabase } from '../config/database';
import { logger } from '../utils/logger';
import { getBusinessId, AuthRequest } from '../middleware/auth';
import {
  sendWhatsAppText,
  sendWhatsAppImage,
  sendWhatsAppVideo,
  sendWhatsAppAudio,
  sendWhatsAppDocument,
  storeMediaInSupabase,
  saveMediaUpload,
  getMediaUpload,
  validateMediaFile,
  getMediaTypeFromMimeType,
  MediaType,
} from '../services/mediaService';
import {
  getPendingQuoteForSession,
  markQuoteAsSent,
} from '../services/cakeQuoteService';


// ============================================
// GET /sessions - List all sessions
// ============================================
export async function getSessions(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { page = '1', limit = '20', status = 'all' } = req.query;
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const offset = (pageNum - 1) * limitNum;

    // Build query
    let query = supabase
      .from('sessions')
      .select(`
        id,
        customer_id,
        status,
        ai_paused,
        last_message_at,
        created_at,
        customers!inner (
          id,
          name,
          phone
        )
      `, { count: 'exact' })
      .eq('business_id', businessId);

    // Filter by status
    if (status !== 'all') {
      query = query.eq('status', status);
    }

    // Order and paginate
    const { data: sessions, error, count } = await query
      .order('last_message_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (error) {
      logger.error('Failed to fetch sessions', error);
      res.status(500).json({ success: false, error: 'Failed to fetch sessions' });
      return;
    }

    // Get last message and unread count for each session
    const sessionsWithDetails = await Promise.all(
      (sessions || []).map(async (session: any) => {
        // Get last message
        const { data: lastMessage } = await supabase
          .from('messages')
          .select('content, message_type, direction, created_at')
          .eq('session_id', session.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        // Get unread count (inbound messages not read)
        const { count: unreadCount } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('session_id', session.id)
          .eq('direction', 'inbound')
          .eq('is_read', false);

        return {
          id: session.id,
          customer_id: session.customer_id,
          customer_name: session.customers?.name || null,
          customer_phone: session.customers?.phone || '',
          status: session.status,
          ai_paused: session.ai_paused,
          last_message_at: session.last_message_at,
          created_at: session.created_at,
          unread_count: unreadCount || 0,
          last_message: lastMessage || null,
        };
      })
    );

    res.status(200).json({
      success: true,
      data: {
        sessions: sessionsWithDetails,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limitNum),
        },
      },
    });
  } catch (error) {
    logger.error('Failed to fetch sessions', error);
    res.status(500).json({ success: false, error: 'Failed to fetch sessions' });
  }
}

// ============================================
// GET /sessions/:sessionId - Get session messages
// ============================================
export async function getSessionMessages(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    const { sessionId } = req.params;
    const { page = '1', limit = '50' } = req.query;
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const offset = (pageNum - 1) * limitNum;

    if (!businessId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    // Get session with customer info
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select(`
        id,
        customer_id,
        status,
        ai_paused,
        paused_at,
        last_message_at,
        created_at,
        customers!inner (
          id,
          name,
          phone
        )
      `)
      .eq('id', sessionId)
      .eq('business_id', businessId)
      .single();

    if (sessionError || !session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    // Get messages with pagination
    const { data: messages, error: messagesError, count } = await supabase
      .from('messages')
      .select('*', { count: 'exact' })
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (messagesError) {
      logger.error('Failed to fetch messages', messagesError);
      res.status(500).json({ success: false, error: 'Failed to fetch messages' });
      return;
    }

    const customer = session.customers as any;

    res.status(200).json({
      success: true,
      data: {
        session: {
          id: session.id,
          customer_id: session.customer_id,
          customer_name: customer?.name || null,
          customer_phone: customer?.phone || '',
          status: session.status,
          ai_paused: session.ai_paused,
          last_message_at: session.last_message_at,
          created_at: session.created_at,
        },
        customer: {
          id: customer?.id,
          name: customer?.name || null,
          phone: customer?.phone || '',
        },
        messages: messages || [],
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: count || 0,
          hasMore: offset + limitNum < (count || 0),
        },
      },
    });
  } catch (error) {
    logger.error('Failed to fetch session messages', error);
    res.status(500).json({ success: false, error: 'Failed to fetch messages' });
  }
}

// ============================================
// POST /sessions/:sessionId/reply - Send message
// ============================================
export async function sendReply(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    const adminId = req.user?.id;
    const { sessionId } = req.params;
    const { type, content, media_id, caption, filename, quote_id, quote_price } = req.body;

    if (!businessId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    // Validate request
    if (!type) {
      res.status(400).json({ success: false, error: 'Message type is required' });
      return;
    }

    if (type === 'text' && !content) {
      res.status(400).json({ success: false, error: 'Content is required for text messages' });
      return;
    }

    if (['image', 'video', 'audio', 'document'].includes(type) && !media_id) {
      res.status(400).json({ success: false, error: 'Media ID is required for media messages' });
      return;
    }

    // Get session with customer info
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select(`
        id,
        customer_id,
        business_id,
        customers!inner (
          phone
        )
      `)
      .eq('id', sessionId)
      .eq('business_id', businessId)
      .single();

    if (sessionError || !session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    const customerPhone = (session.customers as any)?.phone;
    if (!customerPhone) {
      res.status(400).json({ success: false, error: 'Customer phone not found' });
      return;
    }

    let whatsappMessageId: string | null = null;
    let messageContent = content || '';
    let mediaUrl: string | null = null;
    let mediaMimeType: string | null = null;
    let mediaCaption: string | null = caption || null;
    let mediaFilename: string | null = filename || null;
    let mediaDuration: number | null = null;

    // Send message based on type
    switch (type) {
      case 'text':
        whatsappMessageId = await sendWhatsAppText(customerPhone, content);
        break;

      case 'image':
      case 'video':
      case 'audio':
      case 'document':
        // Get media upload
        const media = await getMediaUpload(media_id);
        if (!media) {
          res.status(400).json({ success: false, error: 'Media not found' });
          return;
        }

        mediaUrl = media.file_url;
        mediaMimeType = media.mime_type;
        mediaDuration = media.duration || null;
        mediaFilename = filename || media.original_filename || null;

        if (type === 'image') {
          messageContent = caption || '[Image]';
          whatsappMessageId = await sendWhatsAppImage(customerPhone, media.file_url, caption);
        } else if (type === 'video') {
          messageContent = caption || '[Video]';
          whatsappMessageId = await sendWhatsAppVideo(customerPhone, media.file_url, caption);
        } else if (type === 'audio') {
          messageContent = '[Voice Message]';
          whatsappMessageId = await sendWhatsAppAudio(customerPhone, media.file_url);
        } else if (type === 'document') {
          messageContent = mediaFilename || '[Document]';
          whatsappMessageId = await sendWhatsAppDocument(
            customerPhone,
            media.file_url,
            mediaFilename || 'document',
            caption
          );
        }
        break;

      default:
        res.status(400).json({ success: false, error: `Invalid message type: ${type}` });
        return;
    }

    // Save message to database
    const { data: savedMessage, error: saveError } = await supabase
      .from('messages')
      .insert({
        session_id: sessionId,
        direction: 'outbound',
        content: messageContent,
        message_type: type,
        media_url: mediaUrl,
        media_mime_type: mediaMimeType,
        media_caption: mediaCaption,
        media_filename: mediaFilename,
        media_duration: mediaDuration,
        whatsapp_message_id: whatsappMessageId,
        status: whatsappMessageId ? 'sent' : 'failed',
      })
      .select()
      .single();

    if (saveError) {
      logger.error('Failed to save message', saveError);
      res.status(500).json({ success: false, error: 'Failed to save message' });
      return;
    }

    // Update session last_message_at
    await supabase
      .from('sessions')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', sessionId);

    // ============================================
    // HANDLE CAKE QUOTE UPDATE
    // ============================================
    // If quote_id and quote_price are provided, mark the quote as sent
    // This happens when admin sends a custom cake price quote via chat
    let quoteUpdated = false;
    if (quote_id && quote_price !== undefined) {
      try {
        const updatedQuote = await markQuoteAsSent(
          quote_id,
          adminId || 'unknown',
          content, // Save the message as admin_final_message
          parseFloat(quote_price)
        );
        if (updatedQuote) {
          quoteUpdated = true;
          logger.info(`Quote ${quote_id} marked as sent with price ₹${quote_price}`);
        }
      } catch (quoteError) {
        logger.error('Failed to update quote status', quoteError);
        // Don't fail the request - message was sent successfully
      }
    } else if (type === 'text' && content) {
      // Auto-detect: If there's a pending quote for this session and message contains a price
      // Try to extract price from message (e.g., "₹1500", "Rs 1500", "1500/-")
      const priceMatch = content.match(/(?:₹|Rs\.?|INR)\s*(\d+(?:,\d{3})*(?:\.\d{2})?)|(\d+(?:,\d{3})*)\s*(?:\/-|rupees?)/i);
      if (priceMatch) {
        const pendingQuote = await getPendingQuoteForSession(sessionId);
        if (pendingQuote) {
          const extractedPrice = parseFloat((priceMatch[1] || priceMatch[2]).replace(/,/g, ''));
          try {
            const updatedQuote = await markQuoteAsSent(
              pendingQuote.id,
              adminId || 'unknown',
              content,
              extractedPrice
            );
            if (updatedQuote) {
              quoteUpdated = true;
              logger.info(`Auto-detected quote ${pendingQuote.id} marked as sent with price ₹${extractedPrice}`);
            }
          } catch (quoteError) {
            logger.error('Failed to auto-update quote status', quoteError);
          }
        }
      }
    }

    res.status(200).json({
      success: true,
      data: {
        message: savedMessage,
        whatsapp_message_id: whatsappMessageId,
        quote_updated: quoteUpdated,
      },
    });
  } catch (error) {
    logger.error('Failed to send reply', error);
    res.status(500).json({ success: false, error: 'Failed to send message' });
  }
}

// ============================================
// POST /upload/media - Upload media file
// ============================================
export async function uploadMedia(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);

    if (!businessId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    // Check if file exists (handled by multer middleware)
    if (!req.file) {
      res.status(400).json({ success: false, error: 'No file uploaded' });
      return;
    }

    const { buffer, mimetype, originalname, size } = req.file;
    const mediaType = (req.body.type as MediaType) || getMediaTypeFromMimeType(mimetype);

    // Validate file
    const validation = validateMediaFile(mimetype, size, mediaType);
    if (!validation.valid) {
      res.status(400).json({ success: false, error: validation.error });
      return;
    }

    // Store in Supabase
    const mediaId = `upload_${Date.now()}`;
    const { filePath, publicUrl } = await storeMediaInSupabase(
      buffer,
      mimetype,
      businessId,
      mediaId
    );

    // Get duration for audio/video (would need ffprobe in production)
    const duration = undefined; // TODO: Extract duration from audio/video files

    // Save upload record
    const { id } = await saveMediaUpload(
      businessId,
      filePath,
      publicUrl,
      mimetype,
      size,
      originalname,
      duration
    );

    res.status(200).json({
      success: true,
      data: {
        media_id: id,
        media_url: publicUrl,
        mime_type: mimetype,
        file_size: size,
        duration,
      },
    });
  } catch (error) {
    logger.error('Failed to upload media', error);
    res.status(500).json({ success: false, error: 'Failed to upload media' });
  }
}

// ============================================
// PATCH /sessions/:sessionId/ai-pause - Toggle AI pause
// ============================================
export async function toggleAiPause(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    const { sessionId } = req.params;
    const { paused } = req.body;

    if (!businessId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (typeof paused !== 'boolean') {
      res.status(400).json({ success: false, error: 'Paused must be a boolean' });
      return;
    }

    const updateData: any = {
      ai_paused: paused,
    };

    if (paused) {
      updateData.paused_at = new Date().toISOString();
      updateData.paused_by = req.user?.email || 'admin';
    } else {
      updateData.paused_at = null;
      updateData.paused_by = null;
    }

    const { data: session, error } = await supabase
      .from('sessions')
      .update(updateData)
      .eq('id', sessionId)
      .eq('business_id', businessId)
      .select('id, ai_paused, paused_at')
      .single();

    if (error || !session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    logger.info(`AI ${paused ? 'paused' : 'resumed'} for session ${sessionId}`);

    res.status(200).json({
      success: true,
      data: {
        session_id: session.id,
        ai_paused: session.ai_paused,
        paused_at: session.paused_at,
      },
    });
  } catch (error) {
    logger.error('Failed to toggle AI pause', error);
    res.status(500).json({ success: false, error: 'Failed to toggle AI pause' });
  }
}

// ============================================
// POST /sessions/:sessionId/mark-read - Mark messages as read
// ============================================
export async function markMessagesRead(req: AuthRequest, res: Response): Promise<void> {
  try {
    const businessId = getBusinessId(req);
    const { sessionId } = req.params;

    if (!businessId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    // Verify session belongs to business
    const { data: session } = await supabase
      .from('sessions')
      .select('id')
      .eq('id', sessionId)
      .eq('business_id', businessId)
      .single();

    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    // Mark all inbound messages as read
    const { error } = await supabase
      .from('messages')
      .update({ is_read: true })
      .eq('session_id', sessionId)
      .eq('direction', 'inbound')
      .eq('is_read', false);

    if (error) {
      logger.error('Failed to mark messages as read', error);
      res.status(500).json({ success: false, error: 'Failed to mark messages as read' });
      return;
    }

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Failed to mark messages as read', error);
    res.status(500).json({ success: false, error: 'Failed to mark messages as read' });
  }
}
