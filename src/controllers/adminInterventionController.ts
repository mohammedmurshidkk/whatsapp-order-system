import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import * as interventionService from '../services/interventionService';
import { emitInterventionUpdated, emitInterventionResolved } from '../services/socketService';
import { getSessionWithItems, resumeSession } from '../services/sessionService';
import { updateSessionPickupInfo, updateSessionDeliveryInfo } from '../services/fulfillmentService';
import { getCustomerById } from '../services/customerService';
import { sendWhatsAppMessage } from '../services/whatsapp';
import { saveOutgoingMessage } from '../services/messageService';
import { createSentQuoteFromIntervention, confirmQuoteTime } from '../services/cakeQuoteService';
import { updateSessionCustomCakeContext } from '../services/sessionService';
import { logger } from '../utils/logger';

export const getPendingInterventions = async (req: AuthRequest, res: Response) => {
    try {
        const businessId = req.user?.business_id;
        if (!businessId) return res.status(400).json({ error: 'Business context required' });

        const interventions = await interventionService.getPendingInterventions(businessId);
        res.json(interventions);
    } catch (error) {
        logger.error('Error fetching pending interventions', error);
        res.status(500).json({ error: 'Failed to fetch interventions' });
    }
};

export const getInterventionById = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const intervention = await interventionService.getInterventionById(id);

        if (!intervention) return res.status(404).json({ error: 'Intervention not found' });

        // Ensure admin belongs to same business
        if (req.user?.business_id && intervention.business_id !== req.user.business_id) {
            return res.status(403).json({ error: 'Unauthorized access to intervention' });
        }

        res.json(intervention);
    } catch (error) {
        logger.error('Error fetching intervention', error);
        res.status(500).json({ error: 'Failed to fetch intervention' });
    }
};

export const getInterventionsBySession = async (req: AuthRequest, res: Response) => {
    try {
        const { sessionId } = req.params;
        const interventions = await interventionService.getInterventionBySession(sessionId);
        res.json(interventions);
    } catch (error) {
        logger.error('Error fetching session interventions', error);
        res.status(500).json({ error: 'Failed to fetch interventions' });
    }
};

export const claimIntervention = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const adminId = req.user?.id;

        if (!adminId) return res.status(401).json({ error: 'Admin ID required' });

        const updated = await interventionService.updateInterventionStatus(id, 'in_review', adminId);

        if (!updated) return res.status(404).json({ error: 'Intervention not found' });

        // Notify other admins that it's being reviewed
        emitInterventionUpdated(updated.business_id, updated);

        res.json(updated);
    } catch (error) {
        logger.error('Error claiming intervention', error);
        res.status(500).json({ error: 'Failed to claim intervention' });
    }
};

export const resolveIntervention = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const adminId = req.user?.id;
        const { approved, price, message, notes } = req.body;

        if (!adminId) return res.status(401).json({ error: 'Admin ID required' });

        const updated = await interventionService.resolveIntervention(
            id,
            { approved, price, message, notes },
            adminId
        );

        if (!updated) return res.status(404).json({ error: 'Intervention not found' });

        // Notify admins
        emitInterventionResolved(updated.business_id, updated);

        // Resume session AI if valid session
        try {
            if (updated.session_id) {
                // Resume session (set ai_paused = false)
                await resumeSession(updated.session_id);

                // Send WhatsApp message to customer with resolution
                const session = await getSessionWithItems(updated.session_id);
                if (session && session.customer_id) {
                    const customer = await getCustomerById(session.customer_id);
                    if (customer && customer.phone) {
                        // Construct message based on approval
                        let replyMessage = '';
                        if (approved) {
                            if (price) replyMessage += `💰 Price: ₹${price}\n`;
                            if (message) replyMessage += `💬 ${message}\n`;
                            if (notes) replyMessage += `📝 Note: ${notes}`;
                        } else {
                            replyMessage += message || 'Your request could not be processed at this time.';
                        }

                        await sendWhatsAppMessage(customer.phone, replyMessage);

                        // Save message to database so it appears in admin chat
                        await saveOutgoingMessage(updated.session_id, replyMessage);

                        // If custom_cake intervention with price, create a sent quote
                        // This allows customer to accept and add to cart
                        logger.info(`🔍 Quote creation check: approved=${approved}, price=${price}, type=${updated.type}`);

                        if (approved && price && updated.type === 'custom_cake') {
                            const requestData = updated.request_data as {
                                image_url?: string;
                                customer_weight?: string;
                                customer_flavor?: string;
                            };

                            // Create quote with 'sent' status so customer can accept it
                            const quote = await createSentQuoteFromIntervention(
                                updated.business_id,
                                updated.session_id,
                                updated.customer_id,
                                adminId,
                                price,
                                message || `Your custom cake is ready! Price: ₹${price}`,
                                requestData,
                                updated.ai_analysis as Record<string, unknown> | undefined
                            );

                            if (quote) {
                                logger.info(`✅ Created sent quote ${quote.id} from intervention ${updated.id}`);

                                // Also update session context for AI reference
                                await updateSessionCustomCakeContext(updated.session_id, {
                                    image_url: requestData.image_url,
                                    weight: requestData.customer_weight,
                                    flavor: requestData.customer_flavor,
                                });
                            } else {
                                logger.error(`❌ Failed to create quote for intervention ${updated.id}`);
                            }
                        } else if (updated.type === 'custom_cake_time_confirmation') {
                            // Handle time confirmation for custom cake
                            const timeRequestData = updated.request_data as {
                                quoteId?: string;
                                requestedTime?: string;
                                fulfillmentType?: 'delivery' | 'takeaway';
                            };

                            if (approved && timeRequestData.quoteId) {
                                // Mark time as confirmed in cake_quotes
                                const confirmedQuote = await confirmQuoteTime(timeRequestData.quoteId);
                                if (confirmedQuote) {
                                    logger.info(`✅ Time confirmed for quote ${timeRequestData.quoteId}`);
                                } else {
                                    logger.error(`❌ Failed to confirm time for quote ${timeRequestData.quoteId}`);
                                }
                            } else if (!approved) {
                                logger.info(`⏭️ Time rejected for quote ${timeRequestData.quoteId}, customer notified with alternative`);
                            }
                        } else if (updated.type === 'urgent_delivery') {
                            // Handle urgent delivery confirmation
                            const urgentRequestData = updated.request_data as {
                                requestedTime?: string;
                                fulfillmentType?: 'delivery' | 'takeaway';
                                outletId?: string;
                                deliveryAddress?: string;
                            };

                            if (approved && urgentRequestData.requestedTime) {
                                // Save the approved time to session
                                if (urgentRequestData.fulfillmentType === 'takeaway' && urgentRequestData.outletId) {
                                    await updateSessionPickupInfo(updated.session_id, {
                                        outlet_id: urgentRequestData.outletId,
                                        time: urgentRequestData.requestedTime,
                                    });
                                    logger.info(`✅ Urgent takeaway approved - time saved: ${urgentRequestData.requestedTime}`);
                                } else if (urgentRequestData.fulfillmentType === 'delivery') {
                                    await updateSessionDeliveryInfo(updated.session_id, {
                                        time: urgentRequestData.requestedTime,
                                    });
                                    logger.info(`✅ Urgent delivery approved - time saved: ${urgentRequestData.requestedTime}`);
                                }
                            } else if (!approved) {
                                logger.info(`⏭️ Urgent order time rejected for session ${updated.session_id}, customer can choose new time`);
                            }
                        } else {
                            logger.info(`⏭️ Skipping quote creation: approved=${approved}, price=${price}, type=${updated.type}`);
                        }
                    }
                }
            }
        } catch (sessionError) {
            logger.error('Error resuming session after intervention resolution', sessionError);
        }

        res.json(updated);
    } catch (error) {
        logger.error('Error resolving intervention', error);
        res.status(500).json({ error: 'Failed to resolve intervention' });
    }
};

export const cancelIntervention = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const updated = await interventionService.cancelIntervention(id);

        if (!updated) return res.status(404).json({ error: 'Intervention not found' });

        emitInterventionUpdated(updated.business_id, updated);

        // Also resume session on cancel, maybe? Or leave paused?
        // Usually if admin cancels, we probably want to resume or let AI handle "admin cancelled".
        if (updated.session_id) {
            await resumeSession(updated.session_id);
        }

        res.json(updated);
    } catch (error) {
        logger.error('Error cancelling intervention', error);
        res.status(500).json({ error: 'Failed to cancel intervention' });
    }
};
