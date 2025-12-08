import { Request, Response } from 'express';
import { WhatsAppWebhookBody, TestMessageRequest, SessionItem } from '../types';
import { findOrCreateCustomer } from '../services/customerService';
import {
  findOrCreateSession,
  updateSessionActivity,
  getSessionWithItems,
  isAIPaused,
} from '../services/sessionService';
import {
  getRecentMessages,
  saveIncomingMessage,
  saveOutgoingMessage,
} from '../services/messageService';
import { processMessageWithAI } from '../services/aiService';
import {
  saveOrderItem,
  generateOrderSummary,
  createFinalOrder,
  updateSessionItemQuantity,
  removeSessionItem,
  cancelOrderById,
} from '../services/orderService';
import {
  getBusinessById,
  getBusinessByPhone,
  getMenuItems,
  getMenuCategories,
  formatMenuForCustomer,
} from '../services/menuService';
import {
  getBusinessOutlets,
  formatOutletsForCustomer,
  findOutletByCustomerInput,
} from '../services/outletService';
import {
  updateSessionFulfillmentType,
  updateSessionDeliveryInfo,
  updateSessionPickupInfo,
  parseDeliveryTime,
} from '../services/fulfillmentService';
import {
  getAutoSuggestedAddons,
  addAddonToSessionItem,
  formatAddonsForCustomer,
  findAddonByCustomerInput,
} from '../services/addonService';
import {
  sendWhatsAppMessage,
  verifyWebhookChallenge,
  verifyWebhookSignature,
} from '../services/whatsappService';
import {
  isValidPhoneNumber,
  sanitizePhoneNumber,
  isValidMessage,
  sanitizeMessage,
} from '../utils/validators';
import { logger } from '../utils/logger';

// Track last added item per session for add-on attachment
const lastAddedItemMap = new Map<string, string>(); // sessionId -> itemId

// Format session items as strings for AI context
function formatSessionItemsForAI(items: SessionItem[]): string[] {
  return items.map((item) => {
    let desc = `${item.item_name}`;
    if (item.size_or_weight) desc += ` (${item.size_or_weight})`;
    if (item.quantity > 1) desc += ` x${item.quantity}`;
    if (item.custom_text) desc += ` - "${item.custom_text}"`;
    if (item.delivery_date) desc += ` - ${item.delivery_date}`;
    if (item.notes) desc += ` [${item.notes}]`;
    return desc;
  });
}

// Check if item already exists in session (to prevent duplicates)
function isItemDuplicate(
  existingItems: SessionItem[],
  newItemName: string,
  newItemSize?: string
): boolean {
  const normalizedNew = newItemName.toLowerCase().trim();

  return existingItems.some((item) => {
    const normalizedExisting = item.item_name.toLowerCase().trim();
    const sameItem =
      normalizedExisting === normalizedNew ||
      normalizedExisting.includes(normalizedNew) ||
      normalizedNew.includes(normalizedExisting);

    // If same item name, check if size also matches
    if (sameItem && newItemSize && item.size_or_weight) {
      return (
        item.size_or_weight.toLowerCase() === newItemSize.toLowerCase()
      );
    }

    return sameItem;
  });
}

async function processMessage(
  phone: string,
  messageText: string,
  businessId: string
): Promise<string | null> {
  logger.info(`Processing message from ${phone}: ${messageText.substring(0, 50)}...`);

  // Get business context
  const business = await getBusinessById(businessId);
  logger.info(`Business: ${business?.name || 'NOT FOUND'} (ID: ${businessId})`);

  // CHECK CRITICAL MESSAGE - If enabled, bypass AI and send critical message
  if (business?.critical_message_enabled && business?.critical_message) {
    logger.info(`⚠️ Critical message enabled for ${business.name} - bypassing AI`);
    return business.critical_message;
  }

  // Find or create customer for this business
  const customer = await findOrCreateCustomer(phone, businessId);

  // Find or create active session for this business
  const session = await findOrCreateSession(customer.id, businessId);

  // Update session activity
  await updateSessionActivity(session.id);

  // Check if AI is paused (human takeover mode)
  const aiPaused = await isAIPaused(session.id);
  if (aiPaused) {
    logger.info(`AI paused for session ${session.id}, skipping AI response`);
    // Still save the incoming message for record
    await saveIncomingMessage(session.id, messageText);
    return null; // Return null to indicate no AI response
  }

  // Get session with items (for duplicate prevention)
  const sessionWithItems = await getSessionWithItems(session.id);
  const existingItems = sessionWithItems?.items || [];

  // Get recent message history
  const messageHistory = await getRecentMessages(session.id);

  // Get menu for AI context
  let menuItems;
  let menuCategories;
  if (businessId) {
    menuItems = await getMenuItems(businessId);
    menuCategories = await getMenuCategories(businessId);
    logger.info(`Menu loaded: ${menuItems?.length || 0} items, ${menuCategories?.length || 0} categories`);
  } else {
    logger.warn('No business found - AI will have no menu context!');
  }

  // Get outlets for fulfillment
  const outlets = businessId ? await getBusinessOutlets(businessId) : [];
  logger.info(`Outlets loaded: ${outlets.length}`);

  // Build AI context - use sessionWithItems for LATEST fulfillment data
  const latestSessionData = sessionWithItems || session;
  const aiContext = {
    business: business || undefined,
    menuItems,
    menuCategories,
    currentSessionItems: formatSessionItemsForAI(existingItems),
    outlets,
    sessionHasFulfillmentType: !!latestSessionData.fulfillment_type,
    sessionHasDeliveryInfo: !!latestSessionData.delivery_address,
    sessionHasPickupInfo: !!latestSessionData.pickup_outlet_id,
  };

  logger.debug(`AI context fulfillment: type=${latestSessionData.fulfillment_type}, addr=${latestSessionData.delivery_address}, outlet=${latestSessionData.pickup_outlet_id}`);

  // Process with AI
  const aiResponse = await processMessageWithAI(
    messageText,
    messageHistory,
    session,
    aiContext
  );

  // Save incoming message
  await saveIncomingMessage(session.id, messageText);

  let replyMessage = aiResponse.reply;
  let intentToProcess = aiResponse.intent;

  // SERVER-SIDE INTENT OVERRIDE: Handle "yes" confirmation robustly
  // This helps when AI model doesn't correctly identify confirm_order intent
  const isYesMessage = /^(yes|yeah|yep|yup|confirm|ok|okay|sure|go ahead)$/i.test(messageText.trim());
  if (isYesMessage && existingItems.length > 0) {
    // Check if fulfillment is complete - if so, this should be confirm_order
    if (latestSessionData.fulfillment_type &&
        (latestSessionData.delivery_address || latestSessionData.pickup_outlet_id)) {
      logger.info(`🔧 Override: User said YES with complete fulfillment - forcing confirm_order`);
      intentToProcess = 'confirm_order';
    }
    // If no fulfillment yet, let AI handle it naturally (will ask for delivery/takeaway)
  }

  // Handle different intents
  switch (intentToProcess) {
    case 'add_item':
      if (aiResponse.item && aiResponse.item.name) {
        logger.info(`🛒 ADD_ITEM intent received for: ${aiResponse.item.name} (size: ${aiResponse.item.size_or_weight || 'default'}, qty: ${aiResponse.item.quantity || 1})`);

        // Check for duplicates before adding
        const isDuplicate = isItemDuplicate(
          existingItems,
          aiResponse.item.name,
          aiResponse.item.size_or_weight
        );

        if (isDuplicate) {
          logger.info(`Duplicate item prevented: ${aiResponse.item.name}`);
          // Don't add, but keep the AI's response (it should acknowledge it's already added)
        } else {
          try {
            const savedItem = await saveOrderItem(session.id, aiResponse.item, businessId);
            logger.info(`✅ Item SAVED to DB: ${aiResponse.item.name} (ID: ${savedItem.id})`);

            // Store last added item ID for add-on attachment
            lastAddedItemMap.set(session.id, savedItem.id);

            // Check for auto-suggested add-ons
            if (menuItems && menuItems.length > 0) {
              const addedMenuItem = menuItems.find(
                mi => mi.name.toLowerCase() === aiResponse.item!.name.toLowerCase()
              );

              if (addedMenuItem && addedMenuItem.category_id) {
                const suggestedAddons = await getAutoSuggestedAddons(addedMenuItem.category_id);

                if (suggestedAddons.length > 0) {
                  logger.info(`${suggestedAddons.length} add-ons available for ${addedMenuItem.name}`);
                  // Format and append to reply
                  const addonsMessage = formatAddonsForCustomer(suggestedAddons);
                  replyMessage = aiResponse.reply + '\n\n' + addonsMessage;
                }
              }
            }
          } catch (saveError) {
            logger.error(`❌ Failed to save item to DB: ${aiResponse.item.name}`, saveError);
            replyMessage = "Sorry, I couldn't add that item. Please try again.";
          }
        }
      } else {
        logger.warn(`⚠️ ADD_ITEM intent but missing item data: ${JSON.stringify(aiResponse)}`);
      }
      break;

    case 'modify_order':
      // Customer wants to modify their order (change quantity, remove item)
      if (aiResponse.item && aiResponse.item.name) {
        if (aiResponse.item.quantity === 0) {
          // Remove item
          await removeSessionItem(session.id, aiResponse.item.name, aiResponse.item.size_or_weight);
          logger.info(`Item removed: ${aiResponse.item.name}`);
        } else {
          // Check if item exists in session
          const itemExists = existingItems.some(item =>
            item.item_name.toLowerCase().includes(aiResponse.item!.name.toLowerCase()) ||
            aiResponse.item!.name.toLowerCase().includes(item.item_name.toLowerCase())
          );

          if (itemExists) {
            // Update quantity
            await updateSessionItemQuantity(
              session.id,
              aiResponse.item.name,
              aiResponse.item.quantity,
              aiResponse.item.size_or_weight
            );
            logger.info(`Item updated: ${aiResponse.item.name} x${aiResponse.item.quantity}`);
          } else {
            // Add as new item
            await saveOrderItem(session.id, aiResponse.item, businessId);
            logger.info(`Item added: ${aiResponse.item.name}`);
          }
        }
      }
      // Always show updated summary after modification
      const modifiedSummary = await generateOrderSummary(session.id, {
        includeCta: true,
        ctaMessage: 'Reply *YES* to confirm these items.'
      });
      replyMessage = aiResponse.reply + '\n\n' + modifiedSummary;
      break;

    case 'suggest_addons':
      // AI is suggesting add-ons (already formatted in AI reply)
      // Just use the AI's reply as is
      logger.info('AI suggesting add-ons');
      break;

    case 'add_addon':
      // Customer wants to add an add-on
      if (aiResponse.addon && aiResponse.addon.addon_name) {
        const lastItemId = lastAddedItemMap.get(session.id);

        if (!lastItemId) {
          logger.warn('No last item found for add-on attachment');
          replyMessage = "Sorry, I couldn't find the item to add this to. Please try ordering again.";
          break;
        }

        // Find the add-on from available add-ons (could be by name or number)
        if (menuItems && menuItems.length > 0) {
          // Get the last added item to find its category
          const lastItem = existingItems.find(item => item.id === lastItemId);
          if (lastItem) {
            const menuItem = menuItems.find(
              mi => mi.name.toLowerCase() === lastItem.item_name.toLowerCase()
            );

            if (menuItem && menuItem.category_id) {
              const availableAddons = await getAutoSuggestedAddons(menuItem.category_id);

              // Try to match addon by customer input (could be number or name)
              let selectedAddon = findAddonByCustomerInput(messageText, availableAddons);

              // If not found, try by AI-provided name
              if (!selectedAddon) {
                selectedAddon = availableAddons.find(
                  addon => addon.name.toLowerCase() === aiResponse.addon!.addon_name.toLowerCase()
                ) || null
              }

              if (selectedAddon) {
                await addAddonToSessionItem(lastItemId, selectedAddon.id, aiResponse.addon.quantity || 1);
                logger.info(`Add-on added: ${selectedAddon.name} to item ${lastItemId}`);

                // Update reply to confirm
                if (!replyMessage.includes('Added')) {
                  replyMessage = `Added ${selectedAddon.name}${selectedAddon.price ? ` (₹${selectedAddon.price})` : ' (FREE)'}! ${replyMessage}`;
                }
              } else {
                logger.warn(`Add-on not found: ${aiResponse.addon.addon_name}`);
                replyMessage = "Sorry, I couldn't find that add-on. Anything else you'd like to order?";
              }
            }
          }
        }
      }
      break;

    case 'decline_addon':
      // Customer declined add-ons
      logger.info('Customer declined add-ons');
      // Just use AI's reply
      break;

    case 'continue_ordering':
      // Ask for more items after add-ons handled
      logger.info('Continuing with ordering');
      // AI's reply should ask "Anything else?"
      break;

    case 'show_menu':
      // Send formatted menu to customer
      if (menuItems && menuCategories && menuItems.length > 0) {
        replyMessage = formatMenuForCustomer(menuItems, menuCategories);
      } else {
        replyMessage =
          "We have cakes, coffee, tea, cold drinks, and snacks! Just tell me what you'd like.";
      }
      break;

    case 'ready_for_checkout':
      // Generate and send order summary - but validate cart first
      const checkoutSession = await getSessionWithItems(session.id);
      if (!checkoutSession || checkoutSession.items.length === 0) {
        logger.warn(`⚠️ READY_FOR_CHECKOUT but cart is EMPTY! Session: ${session.id}`);
        replyMessage = "Your cart is empty! What would you like to order?";
        break;
      }
      // Show summary and ask for delivery/takeaway directly (no separate item confirmation)
      const summary = await generateOrderSummary(session.id, { includeCta: false });
      if (business?.supports_delivery && business?.supports_takeaway) {
        replyMessage = summary + '\n\nWould you like *delivery* or *takeaway*?';
      } else if (business?.supports_delivery) {
        replyMessage = summary + '\n\nPlease share your delivery address.';
      } else {
        replyMessage = summary + '\n\nPlease select your preferred pickup location.';
        if (outlets.length > 0) {
          replyMessage += '\n\n' + formatOutletsForCustomer(outlets);
        }
      }
      break;

    case 'confirm_items':
      // Legacy support - treat same as ready_for_checkout
      const itemsSession = await getSessionWithItems(session.id);
      if (!itemsSession || itemsSession.items.length === 0) {
        logger.warn(`⚠️ CONFIRM_ITEMS but cart is EMPTY! Session: ${session.id}`);
        replyMessage = "Your cart is empty! What would you like to order?";
        break;
      }
      // Ask for delivery or takeaway
      if (business?.supports_delivery && business?.supports_takeaway) {
        replyMessage = "Would you like *delivery* or *takeaway*?";
      } else if (business?.supports_delivery) {
        replyMessage = "Please share your delivery address.";
      } else {
        replyMessage = "Please select your preferred pickup location.";
        if (outlets.length > 0) {
          replyMessage += '\n\n' + formatOutletsForCustomer(outlets);
        }
      }
      break;

    case 'ask_fulfillment_type':
      // Ask customer for delivery or takeaway
      if (business?.supports_delivery && business?.supports_takeaway) {
        replyMessage = aiResponse.reply || 'Would you like delivery or takeaway?';
      } else if (business?.supports_delivery) {
        replyMessage = 'We offer delivery service. Please share your delivery address.';
      } else {
        replyMessage = 'Please select your preferred pickup location.';
      }
      break;

    case 'collect_delivery_info':
      // Collect delivery address and time
      if (aiResponse.fulfillment) {
        // Set fulfillment type if not already set
        if (aiResponse.fulfillment.fulfillment_type && !session.fulfillment_type) {
          await updateSessionFulfillmentType(session.id, 'delivery');
          logger.info('Fulfillment type set to: delivery');
        }

        // Save delivery address if provided
        if (aiResponse.fulfillment.delivery_address) {
          const deliveryTime = aiResponse.fulfillment.delivery_time
            ? parseDeliveryTime(aiResponse.fulfillment.delivery_time)
            : null;

          await updateSessionDeliveryInfo(session.id, {
            address: aiResponse.fulfillment.delivery_address,
            time: deliveryTime || undefined,
            notes: aiResponse.fulfillment.fulfillment_notes,
          });
          logger.info(`Delivery info saved: ${aiResponse.fulfillment.delivery_address}`);

          // Show final invoice with delivery details and ask for confirmation
          const deliverySummary = await generateOrderSummary(session.id, {
            includeCta: true,
            ctaMessage: '\nPlease review your order. Reply *YES* to confirm or you can add more items.',
          });
          replyMessage = deliverySummary;
        }
      }
      break;

    case 'collect_pickup_info':
      // Collect pickup outlet and time
      if (aiResponse.fulfillment) {
        // Set fulfillment type if not already set
        if (aiResponse.fulfillment.fulfillment_type && !session.fulfillment_type) {
          await updateSessionFulfillmentType(session.id, 'takeaway');
          logger.info('Fulfillment type set to: takeaway');
        }

        // If customer selected outlet (by number or name)
        if (aiResponse.fulfillment.pickup_outlet_id || messageText.match(/^\d+$/)) {
          let selectedOutlet = null;

          // Try to find outlet from customer input
          if (messageText.match(/^\d+$/)) {
            selectedOutlet = findOutletByCustomerInput(messageText, outlets);
          }

          // Or use AI-extracted outlet ID
          if (!selectedOutlet && aiResponse.fulfillment.pickup_outlet_id) {
            selectedOutlet = outlets.find(o => o.id === aiResponse?.fulfillment?.pickup_outlet_id);
          }

          if (selectedOutlet) {
            const pickupTime = aiResponse.fulfillment.pickup_time
              ? parseDeliveryTime(aiResponse.fulfillment.pickup_time)
              : null;

            await updateSessionPickupInfo(session.id, {
              outlet_id: selectedOutlet.id,
              time: pickupTime || undefined,
              notes: aiResponse.fulfillment.fulfillment_notes,
            });
            logger.info(`Pickup outlet selected: ${selectedOutlet.outlet_name}`);

            // Show final invoice with pickup details and ask for confirmation
            const pickupSummary = await generateOrderSummary(session.id, {
              includeCta: true,
              ctaMessage: `\n📍 Pickup at: ${selectedOutlet.outlet_name}\n\nPlease review your order. Reply *YES* to confirm or you can add more items.`,
            });
            replyMessage = pickupSummary;
          } else {
            // Show outlets list if not found
            const outletsList = formatOutletsForCustomer(outlets);
            replyMessage = aiResponse.reply + '\n\n' + outletsList;
          }
        } else if (!session.pickup_outlet_id) {
          // Show outlets list if customer hasn't selected yet
          const outletsList = formatOutletsForCustomer(outlets);
          replyMessage = aiResponse.reply + '\n\n' + outletsList;
        }
      }
      break;

    case 'confirm_order':
      // Track if fulfillment was just collected in THIS message (not a real confirmation)
      // Only true if session didn't already have the address/outlet before this message
      const fulfillmentJustCollected = aiResponse.fulfillment && (
        (aiResponse.fulfillment.delivery_address && !latestSessionData.delivery_address) ||
        (aiResponse.fulfillment.pickup_outlet_id && !latestSessionData.pickup_outlet_id)
      );

      // FIRST: If AI provided fulfillment data with confirm_order, SAVE IT NOW
      if (aiResponse.fulfillment) {
        logger.info(`📍 Saving fulfillment data from confirm_order: ${JSON.stringify(aiResponse.fulfillment)}`);

        // Save fulfillment type
        if (aiResponse.fulfillment.fulfillment_type) {
          await updateSessionFulfillmentType(session.id, aiResponse.fulfillment.fulfillment_type);
        }

        // Save delivery info
        if (aiResponse.fulfillment.fulfillment_type === 'delivery' && aiResponse.fulfillment.delivery_address) {
          const deliveryTime = aiResponse.fulfillment.delivery_time
            ? parseDeliveryTime(aiResponse.fulfillment.delivery_time)
            : null;
          await updateSessionDeliveryInfo(session.id, {
            address: aiResponse.fulfillment.delivery_address,
            time: deliveryTime || undefined,
          });
        }

        // Save pickup info
        if (aiResponse.fulfillment.fulfillment_type === 'takeaway' && aiResponse.fulfillment.pickup_outlet_id) {
          // AI might return outlet name instead of UUID - need to look it up
          let outletId = aiResponse.fulfillment.pickup_outlet_id;

          // Check if it's not a valid UUID (AI returned name instead)
          const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(outletId);
          if (!isUUID) {
            // Try to find outlet by name or number
            const foundOutlet = findOutletByCustomerInput(outletId, outlets);
            if (foundOutlet) {
              outletId = foundOutlet.id;
              logger.info(`Resolved outlet name "${aiResponse.fulfillment.pickup_outlet_id}" to ID: ${outletId}`);
            } else {
              logger.warn(`Could not find outlet: ${aiResponse.fulfillment.pickup_outlet_id}`);
              // Don't save invalid outlet - will prompt user to select
              outletId = '';
            }
          }

          if (outletId) {
            const pickupTime = aiResponse.fulfillment.pickup_time
              ? parseDeliveryTime(aiResponse.fulfillment.pickup_time)
              : null;
            await updateSessionPickupInfo(session.id, {
              outlet_id: outletId,
              time: pickupTime || undefined,
            });
          }
        }

        // If fulfillment was just collected, show invoice for confirmation instead of creating order
        if (fulfillmentJustCollected) {
          logger.info(`📋 Fulfillment just collected - showing invoice for confirmation`);
          const confirmationSummary = await generateOrderSummary(session.id, {
            includeCta: true,
            ctaMessage: '\nPlease review your order. Reply *YES* to confirm or you can add more items.',
          });
          replyMessage = confirmationSummary;
          break;
        }
      }

      // NOW fetch LATEST session data (after saving fulfillment)
      const latestSession = await getSessionWithItems(session.id);

      // VALIDATION: Check if cart has items before confirming
      if (!latestSession || latestSession.items.length === 0) {
        logger.warn(`⚠️ CONFIRM_ORDER attempted but cart is EMPTY! Session: ${session.id}`);
        replyMessage = "Your cart is empty! Please add items before confirming. What would you like to order?";
        break;
      }

      // VALIDATION: Check if fulfillment info is collected (use LATEST session data)
      if (!latestSession.fulfillment_type) {
        logger.warn(`⚠️ CONFIRM_ORDER attempted but no fulfillment type! Session: ${session.id}`);
        // Show summary and ask for fulfillment
        const orderSummary = await generateOrderSummary(session.id, { includeCta: false });
        if (business?.supports_delivery && business?.supports_takeaway) {
          replyMessage = orderSummary + '\n\nWould you like *delivery* or *takeaway*?';
        } else if (business?.supports_delivery) {
          replyMessage = orderSummary + '\n\nPlease share your delivery address.';
        } else {
          replyMessage = orderSummary + '\n\nPlease select your preferred pickup location.';
          if (outlets.length > 0) {
            replyMessage += '\n\n' + formatOutletsForCustomer(outlets);
          }
        }
        break;
      }

      // For delivery, check if address is provided
      if (latestSession.fulfillment_type === 'delivery' && !latestSession.delivery_address) {
        logger.warn(`⚠️ CONFIRM_ORDER attempted but no delivery address! Session: ${session.id}`);
        replyMessage = "Please share your delivery address to complete the order.";
        break;
      }

      // For takeaway, check if outlet is selected
      if (latestSession.fulfillment_type === 'takeaway' && !latestSession.pickup_outlet_id && outlets.length > 0) {
        logger.warn(`⚠️ CONFIRM_ORDER attempted but no pickup outlet! Session: ${session.id}`);
        replyMessage = "Please select your preferred pickup location:\n\n" + formatOutletsForCustomer(outlets);
        break;
      }

      try {
        logger.info(`📦 Creating order with ${latestSession.items.length} items for session ${session.id}`);
        const order = await createFinalOrder(session.id);

        // Build confirmation message with fulfillment details (use LATEST session data)
        let confirmMsg = `✅ Order confirmed!\n\nOrder ID: ${order.id.substring(0, 8)}\n`;

        if (latestSession.fulfillment_type === 'delivery') {
          confirmMsg += `\n📍 Delivery to: ${latestSession.delivery_address}`;
          if (latestSession.delivery_time) {
            confirmMsg += `\n🕐 Time: ${latestSession.delivery_time}`;
          }
        } else if (latestSession.fulfillment_type === 'takeaway') {
          const selectedOutlet = outlets.find(o => o.id === latestSession.pickup_outlet_id);
          if (selectedOutlet) {
            confirmMsg += `\n📍 Pickup at: ${selectedOutlet.outlet_name}`;
          }
          if (latestSession.pickup_time) {
            confirmMsg += `\n🕐 Time: ${latestSession.pickup_time}`;
          }
        }

        confirmMsg += `\n\nThank you so much for your order! We'll have everything ready for you. Have a wonderful day! 🙏`;
        replyMessage = confirmMsg;
      } catch (error) {
        logger.error('Failed to create order', error);
        replyMessage =
          "I'm sorry, I couldn't process your order right now. Please try again or contact us directly.";
      }
      break;

    case 'cancel':
      replyMessage =
        "No problem! Your order has been cancelled. Feel free to start a new order whenever you're ready!";
      break;

    case 'cancel_existing_order':
      if (aiResponse.order_id) {
        const cancelResult = await cancelOrderById(aiResponse.order_id, customer.id);
        if (cancelResult.success) {
          replyMessage = `✅ ${cancelResult.message}\n\nIf you'd like to place a new order, just let me know!`;
        } else {
          replyMessage = `❌ ${cancelResult.message}`;
        }
      } else {
        replyMessage = "Could you please provide the order ID? It's the 8-character code you received when you placed the order (e.g., 424bfda9).";
      }
      break;

    case 'conversation_ended':
      // Just send the farewell message, no need to ask more questions
      // The AI's reply should already be a proper goodbye
      break;

    case 'ask_question':
      // Handle fulfillment data if present in ask_question
      if (aiResponse.fulfillment) {
        logger.info(`📍 Fulfillment data in ask_question: ${JSON.stringify(aiResponse.fulfillment)}`);
        logger.info(`📍 Current session fulfillment: type=${session.fulfillment_type}, addr=${session.delivery_address}`);

        // Set fulfillment type
        if (aiResponse.fulfillment.fulfillment_type && !session.fulfillment_type) {
          await updateSessionFulfillmentType(session.id, aiResponse.fulfillment.fulfillment_type);
          logger.info(`Fulfillment type set to: ${aiResponse.fulfillment.fulfillment_type}`);
        }

        // Handle delivery info
        if (aiResponse.fulfillment.fulfillment_type === 'delivery') {
          if (aiResponse.fulfillment.delivery_address) {
            const deliveryTime = aiResponse.fulfillment.delivery_time
              ? parseDeliveryTime(aiResponse.fulfillment.delivery_time)
              : null;

            await updateSessionDeliveryInfo(session.id, {
              address: aiResponse.fulfillment.delivery_address,
              time: deliveryTime || undefined,
              notes: aiResponse.fulfillment.fulfillment_notes,
            });
            logger.info(`Delivery info saved: ${aiResponse.fulfillment.delivery_address}`);
          }
        }

        // Handle pickup info
        if (aiResponse.fulfillment.fulfillment_type === 'takeaway') {
          // Show outlets if not selected yet
          if (!aiResponse.fulfillment.pickup_outlet_id && outlets.length > 0 && !session.pickup_outlet_id) {
            const outletsList = formatOutletsForCustomer(outlets);
            replyMessage = aiResponse.reply + '\n\n' + outletsList;
          } else if (aiResponse.fulfillment.pickup_outlet_id || messageText.match(/^\d+$/)) {
            // Try to find outlet from customer input
            let selectedOutlet = findOutletByCustomerInput(messageText, outlets);

            if (!selectedOutlet && aiResponse.fulfillment.pickup_outlet_id) {
              selectedOutlet = outlets.find(o => o.id === aiResponse.fulfillment?.pickup_outlet_id) || null;
            }

            if (selectedOutlet) {
              const pickupTime = aiResponse.fulfillment.pickup_time
                ? parseDeliveryTime(aiResponse.fulfillment.pickup_time)
                : null;

              await updateSessionPickupInfo(session.id, {
                outlet_id: selectedOutlet.id,
                time: pickupTime || undefined,
                notes: aiResponse.fulfillment.fulfillment_notes,
              });
              logger.info(`Pickup outlet selected: ${selectedOutlet.outlet_name}`);
            }
          }
        }
      }
      // Use AI's reply (possibly modified above)
      break;

    case 'smalltalk':
    default:
      // Use AI's reply as is
      break;
  }

  // Save outgoing message
  await saveOutgoingMessage(session.id, replyMessage);

  logger.info(`Reply sent: ${replyMessage.substring(0, 50)}...`);

  return replyMessage;
}

export async function handleWhatsAppWebhook(
  req: Request,
  res: Response
): Promise<void> {
  // Immediately respond with 200 OK (WhatsApp requires fast response)
  res.status(200).send('OK');

  try {
    const signature = req.headers['x-hub-signature-256'] as string;
    const rawBody = JSON.stringify(req.body);

    // Verify signature (optional for MVP)
    if (signature && !verifyWebhookSignature(signature, rawBody)) {
      logger.warn('Invalid webhook signature');
      return;
    }

    const body = req.body as WhatsAppWebhookBody;

    // Check if this is a valid WhatsApp message
    if (body.object !== 'whatsapp_business_account') {
      return;
    }

    // Process each entry
    for (const entry of body.entry) {
      for (const change of entry.changes) {
        const value = change.value;

        // Skip if no messages
        if (!value.messages || value.messages.length === 0) {
          continue;
        }

        // Get business phone number from webhook metadata
        const businessPhone = sanitizePhoneNumber(value.metadata.display_phone_number);

        // Look up business by phone number
        const business = await getBusinessByPhone(businessPhone);
        if (!business) {
          logger.warn(`Business not found for phone: ${businessPhone}`);
          continue;
        }

        logger.info(`Message received for business: ${business.name} (${business.id})`);

        for (const message of value.messages) {
          // Only handle text messages for MVP
          if (message.type !== 'text' || !message.text?.body) {
            logger.debug(`Skipping non-text message type: ${message.type}`);
            continue;
          }

          const phone = sanitizePhoneNumber(message.from);
          const messageText = sanitizeMessage(message.text.body);

          if (!isValidPhoneNumber(phone)) {
            logger.warn(`Invalid phone number: ${message.from}`);
            continue;
          }

          if (!isValidMessage(messageText)) {
            logger.warn('Empty message received');
            continue;
          }

          try {
            // Use business ID from phone lookup
            const reply = await processMessage(phone, messageText, business.id);
            // Only send message if AI is not paused (reply will be null if paused)
            if (reply !== null) {
              await sendWhatsAppMessage(phone, reply);
            }
          } catch (error) {
            logger.error('Error processing message', error);
            await sendWhatsAppMessage(
              phone,
              "I'm sorry, something went wrong. Please try again in a moment."
            );
          }
        }
      }
    }
  } catch (error) {
    logger.error('Webhook processing error', error);
  }
}

export function handleWebhookVerification(req: Request, res: Response): void {
  logger.info('Webhook verification request received');
  logger.debug('Query params:', req.query);

  const mode = req.query['hub.mode'] as string;
  const token = req.query['hub.verify_token'] as string;
  const challenge = req.query['hub.challenge'] as string;

  logger.debug(`Mode: ${mode}, Token: ${token}, Challenge: ${challenge}`);

  const result = verifyWebhookChallenge(mode, token, challenge);

  if (result) {
    logger.info('Webhook verified successfully!');
    res.status(200).send(result);
  } else {
    res.status(403).send('Verification failed');
  }
}

export async function handleTestMessage(
  req: Request,
  res: Response
): Promise<void> {
  try {
    logger.debug('Test message endpoint called');
    const { phone, message, businessId } = req.body as TestMessageRequest & { businessId?: string };

    if (!phone || !message) {
      res.status(400).json({ error: 'Phone and message are required' });
      return;
    }

    if (!businessId) {
      res.status(400).json({ error: 'Business ID is required' });
      return;
    }

    const sanitizedPhone = sanitizePhoneNumber(phone);
    const sanitizedMessage = sanitizeMessage(message);

    if (!isValidPhoneNumber(sanitizedPhone)) {
      res.status(400).json({ error: 'Invalid phone number' });
      return;
    }

    if (!isValidMessage(sanitizedMessage)) {
      res.status(400).json({ error: 'Message cannot be empty' });
      return;
    }

    const reply = await processMessage(sanitizedPhone, sanitizedMessage, businessId);

    if (reply === null) {
      res.status(200).json({
        success: true,
        phone: sanitizedPhone,
        message: sanitizedMessage,
        reply: null,
        aiPaused: true,
        note: 'AI is paused for this session. Human takeover mode active.',
      });
      return;
    }

    res.status(200).json({
      success: true,
      phone: sanitizedPhone,
      message: sanitizedMessage,
      reply,
    });
  } catch (error) {
    logger.error('Test message error', error);
    res.status(500).json({
      error: 'Failed to process message',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
