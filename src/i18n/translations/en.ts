// English translations (FALLBACK LANGUAGE)
export const en = {
  // Cart messages
  cart: {
    empty: "Your cart is empty! What would you like to order?",
    added: "Added {{item}} to your cart! 🛒",
    anythingElse: "Anything else you'd like to order?",
    duplicate: "You already have {{item}} in your cart. Would you like to add more?",
    addedMultiple: "Added to cart:\n{{items}}\n\nAnything else?",
  },

  // Custom text (cake messages)
  customText: {
    askPrompt: "What would you like written on the cake?",
    saved: "Got it! \"{{text}}\" will be written on your cake.",
    savedAnythingElse: "Got it! \"{{text}}\" will be added to your cake. Anything else you'd like to order?",
    skipped: "No problem! Anything else you'd like to order?",
    affirmationPrompt: "Great! What would you like written on the cake?",
    savedWithAddonPrompt: "Got it! \"{{text}}\" will be written on your cake.\n\nWould you also like any add-ons?\n{{options}}\n\nOr say \"no thanks\" to skip.",
    updated: "Got it! Updated the message on your {{item}} to \"{{text}}\". Anything else?",
    updateFailedNoItem: "I couldn't find an item with text to update. Would you like to add something first?",
    clarifyItem: "You have multiple items. Which one would you like to add writing to?\n\n{{items}}",
    askPromptForItem: "What would you like written on your {{item}}?",
    addFailedNoItem: "I couldn't find that item in your order. Which item would you like to add writing to?",
    removed: "Done! I've removed the text from your {{item}}. Anything else you'd like to change?",
    removeFailedNoText: "There's no text to remove from your order. Anything else I can help with?",
  },

  // Add-ons
  addons: {
    prompt: "🎁 Would you like to add any of these?\n\n{{options}}\n\nReply with numbers (e.g., \"1, 3\") or say \"no thanks\" to skip",
    added: "Added {{addon}}! Anything else?",
    addedMultiple: "Added {{addons}}! Anything else?",
    declined: "No problem! Anything else you'd like to order?",
    hint: "I didn't catch that. Please reply with:\n{{options}}\n\nOr say \"no thanks\" to skip add-ons.\n\n💡 _To add a cake message, say \"write Happy Birthday\" or similar._",
    removed: "✅ Removed {{addonName}} from your {{itemName}}. Anything else?",
    notFound: "I couldn't find \"{{addon}}\" in your order. Would you like me to show your current order?",
    whichRemove: "Which add-on would you like to remove?",
    notAvailable: "That add-on isn't available. Would you like something else?",
    noItemForAddon: "I couldn't find the item to attach this add-on to. Please add an item first, then we can add extras to it.",
  },

  // Fulfillment
  fulfillment: {
    askType: "How would you like to receive your order?",
    deliveryBtn: "🚚 Delivery",
    takeawayBtn: "🏪 Takeaway",
    deliveryPrompt: "Please share your delivery address and preferred time.",
    deliveryLocationPrompt: "Great! Let's set up your 📍 delivery.\n\nYou can either *share your location* or *type your address* with preferred time.\n\n_Examples: 'MG Road, tomorrow 5pm', 'Kottakkal, today 6pm'_",
    locationSaved: "📍 Location saved!",
    askTime: "⏰ What time would you like delivery?\n_Examples: 'today 5pm', 'tomorrow 3pm', 'nale 4pm', 'innu evening'_",
    gotAddress: "Got it, delivery to {{address}}.\n\n⏰ What time would you like delivery?\n_Examples: 'today 5pm', 'tomorrow 3pm', 'nale 4pm', 'innu evening'_",
    pickupPrompt: "Please select your preferred pickup location.",
    askPickupTime: "What time would you like to pick up from {{outlet}}?",
    selectOutlet: "Great! Please select your preferred pickup location:",
    noAddress: "Please share your delivery address to complete the order.",
    noOutlet: "Please select your preferred pickup location:\n\n{{outlets}}",
    beyondArea: "📍 Location saved!\n\n⚠️ Your location appears to be beyond our regular delivery area ({{distance}}).\n\nOur operations team will review and confirm if we can deliver to your location.\n\nYou'll receive a confirmation shortly. Thank you for your patience! 🙏",
    askPickupTimeGeneric: "Please let us know when you would like to pick up your order.",
    askTypeDirect: "Would you like *delivery* or *takeaway*?",
    askAddress: "Please share your delivery address.",
    offerDelivery: "We offer delivery service. Please share your delivery address.",
    locationSavedThenAskTime: "📍 Location saved!\n\n⏰ What time would you like delivery?\n_Examples: 'today 5pm', 'tomorrow 3pm', 'nale 4pm', 'innu evening'_",
    locationSavedThenAskDate: "📍 Location saved!\n\nWhen would you like delivery?",
    locationSavedForLater: "Thanks for sharing your location! 📍 We've saved it for your delivery.",
    locationSavedAskFullAddress: "📍 Location received!\n\nPlease provide your *full delivery address* with landmark for our delivery person.\n\n_Example: 'House No. 12, Near Masjid, MG Road'_",
    pickupLocationConfirmedAskDate: "📍 Pickup at: *{{outlet}}*\n\nWhen would you like to pick up?",
  },

  // Order Summary labels
  orderSummary: {
    title: "📋 *Order Summary*",
    totalItems: "📦 Total Items: {{count}}",
    subtotal: "🛒 Subtotal: ₹{{amount}}",
    deliveryFee: "🚚 Delivery Fee: ₹{{amount}}",
    deliveryFeeFree: "🚚 Delivery Fee: FREE",
    grandTotal: "💰 *Grand Total: ₹{{amount}}*",
    deliveryTo: "🚚 Delivery to: {{address}}",
    deliveryLocation: "🚚 Delivery Location (Lat: {{lat}}, Long: {{lng}})",
    deliveryLocationLink: "🚚 Delivery Location: {{link}}",
    pickupFrom: "📍 Pickup from outlet",
    time: "⏰ Time: {{time}}",
    reviewPrompt: "Please review your order. Reply *YES* to confirm.",
    reviewPromptAdd: "Please review your order. Reply *YES* to confirm or you can add more items.",
    confirmItems: "Reply *YES* to confirm these items.",
    reviewPromptLocation: "\n📍 Location saved! Reply *YES* to confirm your order.",
    free: "FREE",
  },

  // Order confirmation & status
  order: {
    confirmed: "✅ Order confirmed!",
    orderNumber: "Order #",
    total: "💰 Total: ₹{{amount}}",
    delivery: "🚚 *Delivery*",
    takeaway: "🏪 Takeaway",
    time: "⏰ Time: {{time}}",
    saveNumber: "Save your order number *{{orderNumber}}* to check status or cancel.",
    cancelled: "No problem! Your order has been cancelled. Feel free to start a new order whenever you're ready!",
    cancelledSuccess: "✅ {{message}}\n\nIf you'd like to place a new order, just let me know!",
    cancelFailed: "❌ {{message}}",
    noActive: "You don't have any active orders right now. Would you like to place one? 😊",
    provideOrderNumber: "Could you please provide the order number? It's the code you received when you placed the order (e.g., OKS-1).",
    emptyCart: "Your cart is empty! Please add items before confirming. What would you like to order?",
    failed: "We encountered an issue while processing your order. Please try again.{{support}}\n\n_Your cart items are still saved. Just say 'yes' to try again._",
    noItems: "No items in your order yet.",
    addonFree: " - FREE",
    status: {
      confirmed: "Your order is confirmed! We're getting it ready.",
      processing: "Your order is being prepared! 👨‍🍳",
      completed: "Your order has been delivered/picked up.",
      cancelled: "This order was cancelled.",
      inProgress: "Order in progress",
    },
    statusTitle: "📋 *Order #{{orderNumber}}*",
    needHelp: "\n_Need help? Just ask!_",
    cancel: {
      notFound: "Order #{{orderNumber}} not found. Please check the order number and try again.",
      alreadyCancelled: "Order #{{orderNumber}} is already cancelled.",
      alreadyCompleted: "Order #{{orderNumber}} is already completed and cannot be cancelled.",
      failed: "Failed to cancel order. Please try again or contact us.",
      success: "Order #{{orderNumber}} has been cancelled successfully.",
    },
    statusText: {
      confirmed: "Order Confirmed - We are preparing your order",
      processing: "Being Prepared - Your order is being prepared",
      out_for_delivery: "Out for Delivery - Your order is on the way",
      completed: "Completed - Your order has been delivered/picked up",
      cancelled: "Cancelled - This order was cancelled",
    },
    statusDetailTitle: "📋 *Order Status: #{{orderNumber}}*",
    orderedDate: "\n📅 Ordered: {{date}}",
    confirmPrompt: "Please reply *YES* to confirm your order.",
  },

  // Time related
  time: {
    tooEarly: "⏰ That time is too early. We can accept orders from {{time}} onwards.\n\nPlease choose a different time.",
    invalidFormat: "I couldn't understand that time format. Please try something like:\n• 'today 5pm'\n• 'tomorrow 10am'\n• 'nale 4pm' (Malayalam for tomorrow)",
    outsideHours: "⏰ {{reason}}\n\nPlease choose a different time.",
    needTime: "⏰ Please provide a {{type}} date and time to confirm your order.\n\n{{examples}}",
    deliveryTime: "delivery",
    pickupTime: "pickup",
    examples: "Examples: 'today 5pm', 'tomorrow 3pm', 'nale 4pm', 'innu evening'",
    calculationError: "Sorry, there was an issue. Please type your preferred time.",
    at: "at",
    closedOnDay: "We're closed on {{day}}. We're open on: {{openDays}}.",
    tooEarlySimple: "That time is too early. We can accept orders from {{time}} onwards.",
    tooLate: "That time is too late. We close at {{closeTime}}, so the latest we can accept orders is {{latestTime}}.",
  },

  // Menu
  menu: {
    aiWelcome: "Hi there! I'm your friendly AI assistant for {{businessName}}, here to help you place your order.\n\nTap the button below to explore our menu!",
    welcome: "Welcome to {{businessName}}! Tap below to browse our menu.",
    browseBtn: "Browse Menu",
    ourMenu: "Our Menu",
    fallback: "We have cakes, coffee, tea, cold drinks, and snacks! Just tell me what you'd like.",
    pdfCaption: "Here's our menu! Browse through and let me know what you'd like to order.",
    selectCategory: "Select a category from {{group}}",
    selectSize: "*{{item}}*\n\nSelect size:",
  },

  // Buttons & interactive
  buttons: {
    delivery: "🚚 Delivery",
    takeaway: "🏪 Takeaway",
    pickupLocations: "📍 Pickup Locations",
    chooseLocation: "Choose Location",
    availableOutlets: "Available Outlets",
    today: "Today",
    tomorrow: "Tomorrow",
    other: "Other",
    whatTime: "📅 *{{date}}* - What time?",
    customTimePrompt: "Please type your preferred date and time.\n\n_Examples: 'Monday 5pm', 'Dec 20 at 3pm', 'next week Tuesday morning'_",
    customTimePromptForDate: "Please type your preferred time for {{date}}.\n\n_Examples: '5pm', '3:30 PM', 'evening'_",
  },

  // Errors
  error: {
    generic: "We're experiencing a temporary issue. Please try again in a moment.",
    cartAddFailed: "We couldn't add that item to your cart. Please try again.{{support}}",
    contactSupport: "\n\n📞 Need help? Contact: {{phone}}",
  },

  // Voice messages
  voice: {
    notEnabled: "Oops! I'm not able to understand voice messages yet. 🙈\n\nCould you please type your message instead? I'd love to help you!",
    noTranscription: "I received your voice message! 🎤\n\nVoice transcription is not available right now. Could you please type your message instead? 😊",
    transcriptionPrefix: "🎤 _\"{{transcription}}\"_\n\n",
    processingFailed: "Sorry, I couldn't understand your voice message. 🎤\n\nCould you please type your message instead?{{support}}",
  },

  // Custom cake
  customCake: {
    added: "Great! Your custom cake order has been added! 🎂",
    askForImage: "Yes! We do custom cakes! 🎂\n\nPlease share a photo of the design you'd like.\n\nAlso let us know:\n• Weight (e.g., 1kg, 2kg)\n• Flavor{{flavors}}",
    askWeightFlavor: "Nice design! 🎂\n\nPlease let us know:\n• Weight (e.g., 1kg, 2kg)\n• Flavor{{flavors}}",
    askIfCustomize: "Nice cake photo! 🎂\n\nWould you like us to make a custom cake like this?",
    waitingConfirmation: "⏳ Your custom cake order is awaiting time confirmation from our team.\n\nWe're reviewing your requested time and will confirm shortly.\n\n_Please wait for our confirmation before proceeding. Thank you for your patience! 🙏_",
    timeConfirmRequest: "⏰ We've noted your preferred {{type}} time: *{{time}}*\n\nSince this is a custom designed cake, our team will confirm if we can deliver by this time.\n\n_You'll receive a confirmation shortly. Thank you for your patience! 🙏_",
    quoteWaiting: "Our team is still preparing the customized quote for your cake design. We will share it with you as soon as it's ready! 🙏",
    addedThenAskFulfillment: "Great! Your custom cake order has been added! 🎂\n\n{{summary}}\n\nHow would you like to receive your order?",
    addedThenAskDelivery: "Great! Your custom cake order has been added! 🎂\n\n{{summary}}\n\nPlease share your delivery address and preferred date/time.",
    addedThenAskPickup: "Great! Your custom cake order has been added! 🎂\n\n{{summary}}\n\nPlease select your preferred pickup location.",
    revisionQuote: "For the customized {{weight}} cake, our team needs to confirm the pricing.\n\nWe're preparing a new quote for you. You'll receive it shortly! 🎂",
    contactSupport: "For custom cake designs, please contact our team at {{phone}}. They'll help you with personalized cake orders!",
    timeConfirmRequestButton: "⏰ We've noted your preferred {{type}} time: *{{time}}*\n\nSince this is a custom designed cake, our team will confirm if we can {{action}} by this time.\n\n_You'll receive a confirmation shortly. Thank you for your patience! 🙏_",
  },

  // Urgent Order
  urgentOrder: {
    waitingConfirmation: "⏰ Your requested {{type}} time (*{{time}}*) is sooner than our usual preparation time.\n\nOur team is checking if we can accommodate this. Please wait for confirmation.\n\n_You'll hear back shortly! 🙏_",
    approved: "✅ Great news! Your requested time has been confirmed.\n\nLet's continue with your order.",
    rejected: "We're unable to fulfill your order by {{time}}.\n\nPlease choose a later time (minimum {{minWait}} minutes from now).",
  },

  // Amenity
  amenity: {
    bookingRequestConfirmation: "Thank you for your interest in {{amenity}}! Our team has been notified and will contact you shortly to confirm your booking.",
  },

  // Image/Video/Document
  image: {
    askContext: "I received your image! 📸\n\nCould you please let me know what this is for?\n\n• Is this a *cake design* you'd like us to create?\n• Or something else you'd like to share with us?",
    fallback: "I see you've sent an image! 📸\n\nSince I can't view images yet, I've notified our team to check it. They'll respond shortly!{{support}}\n\nIn the meantime, you can describe what you'd like to order? 😊",
  },
  video: {
    fallback: "I see you've sent a video! 🎬\n\nI've notified our team to check it. They'll respond shortly!{{support}}\n\nIn the meantime, you can describe what you'd like to order? 😊",
  },
  document: {
    fallback: "I received your document! 📄\n\nI've notified our team to review it. They'll respond shortly!{{support}}",
  }
} as const;

export type TranslationKeys = typeof en;
