# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WhatsApp AI Ordering System - An AI-powered conversational ordering system for cafes/bakeries using WhatsApp, Google Gemini AI, and Supabase. The system handles natural language order processing, menu management, and order tracking through WhatsApp conversations.

**Key Features:**
- Multi-tenant SaaS architecture (multiple businesses)
- Natural language order processing via Gemini AI
- Delivery and takeaway fulfillment options
- Add-ons system for items (candles, toppings, etc.)
- Admin dashboard for business owners
- Human takeover mode (AI pause)
- Critical message mode for emergencies

## Development Commands

### Running the Application
```bash
npm run dev          # Development mode with hot reload (nodemon + ts-node)
npm run build        # Compile TypeScript to dist/
npm start            # Production mode (runs compiled dist/app.js)
```

### Testing the System
Use the test endpoint to simulate WhatsApp messages without setting up webhooks:
```bash
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543210", "message": "I want a chocolate cake", "businessId": "your-business-uuid"}'
```

## API Endpoints

### Public Endpoints
- `GET /health` - Health check
- `GET /webhook/whatsapp` - WhatsApp webhook verification
- `POST /webhook/whatsapp` - WhatsApp message receiver
- `POST /test/message` - Test endpoint (requires businessId in body)

### Menu & Session APIs
- `GET /api/menu` - Menu management routes
- `GET /api/sessions/:sessionId` - Session details with messages

### Admin APIs (require authentication)
- `POST /api/auth/login` - Admin login
- `GET /api/dashboard` - Dashboard stats
- `GET /api/orders` - Order management
- `GET /api/admin/sessions` - Session management (with AI pause)
- `GET /api/admin/menu` - Menu CRUD
- `GET /api/categories` - Category management
- `GET /api/addons` - Add-ons management
- `GET /api/business` - Business settings

## Architecture & Core Concepts

### High-Level Flow
1. **Webhook Reception** (`webhookController.ts:handleWhatsAppWebhook`) receives WhatsApp messages
2. **Business Lookup** - Business identified by WhatsApp phone number (`getBusinessByPhone`)
3. **Message Processing** (`webhookController.ts:processMessage`) orchestrates the entire flow:
   - Finds/creates customer and session
   - Loads menu items and business context
   - Passes message to AI with full context
4. **AI Processing** (`aiService.ts:processMessageWithAI`) uses Gemini to understand intent and extract order details
5. **Intent Handling** (`webhookController.ts:processMessage`) executes actions based on AI intent
6. **Response** is saved to database and sent back to customer

### Order Confirmation Flow (2-Step)
The system uses a 2-step confirmation process:
1. Customer adds items and says "that's all" → Shows summary, asks delivery/takeaway
2. Customer chooses delivery/takeaway and provides address/outlet
3. **System shows final invoice with fulfillment details** → Asks for confirmation
4. Customer says "Yes" → Order is created

**Important**: When user provides delivery address, the system shows a detailed invoice and asks for confirmation before creating the order. This is handled in `webhookController.ts:510-577` with the `fulfillmentJustCollected` check.

### Session Management (src/services/sessionService.ts)
- **Session Timeout**: Active sessions expire after 2 hours of inactivity (SESSION_TIMEOUT_HOURS)
- **Session Discovery**: `findOrCreateSession()` looks for active sessions within timeout window
- **AI Pause Feature**: Sessions can be paused (`ai_paused=true`) for human takeover
- **Session Lifecycle**: active → completed (when order confirmed) or expired (timeout)
- **Fulfillment Data**: Session stores delivery_address, pickup_outlet_id, fulfillment_type

### AI Intent System (src/types/index.ts:AIIntent)
The AI returns JSON responses with specific intents:

**Ordering Intents:**
- `add_item` - Add item to cart (validates against menu)
- `modify_order` - Change quantity or remove items
- `show_menu` - Display menu to customer
- `item_not_available` - Item not on menu (suggests alternatives)

**Add-on Intents:**
- `suggest_addons` - AI suggests add-ons for item
- `add_addon` - Customer wants to add an add-on
- `decline_addon` - Customer declines add-on
- `continue_ordering` - Continue after add-ons

**Checkout Intents:**
- `ready_for_checkout` - Customer says "that's all" (shows summary)
- `confirm_items` - Legacy: confirms items in cart
- `ask_fulfillment_type` - Ask delivery or takeaway
- `collect_delivery_info` - Collecting delivery address/time
- `collect_pickup_info` - Collecting pickup outlet/time
- `confirm_order` - Final confirmation (creates order)

**Other Intents:**
- `ask_question` - Need more details from customer
- `cancel` - Cancel current session
- `cancel_existing_order` - Cancel previously confirmed order
- `smalltalk` - General conversation
- `conversation_ended` - Farewell after order

### Fulfillment System (src/services/fulfillmentService.ts)
- **Delivery**: Customer provides address, optional time
- **Takeaway**: Customer selects outlet from list
- **Business Config**: `supports_delivery`, `supports_takeaway` flags
- **Outlets**: Multiple pickup locations per business (src/services/outletService.ts)

### Add-ons System (src/services/addonService.ts)
- Add-ons linked to categories (not individual items)
- Auto-suggested based on `is_auto_suggested` flag
- Can be free or priced
- Stored in `session_item_addons` table

### Menu Validation (src/services/aiService.ts)
CRITICAL: Strict menu validation prevents AI hallucinations:
1. Menu items loaded from Supabase and passed to AI
2. `validateItemAgainstMenu()` catches invalid items
3. Invalid items rejected with suggestions
4. Item names/sizes normalized to exact menu matches
5. **Menu Cache**: 5 minutes per business (src/services/menuService.ts)

### Price Calculation (src/services/orderService.ts)
- Prices from menu_items table (base price or size-specific)
- `getItemPrice()` matches size to find correct price
- Stored as `unit_price` on session_items
- Summary: `generateOrderSummary()` includes items, add-ons, fulfillment info

## Database Schema

### Core Tables
- `businesses` - Multi-tenant business config
- `business_outlets` - Pickup locations
- `customers` - Customer info (per business)
- `sessions` - Conversation sessions with fulfillment data
- `session_items` - Cart items (temporary)
- `session_item_addons` - Add-ons attached to items
- `messages` - Chat history
- `orders` - Confirmed orders

### Menu Tables
- `menu_categories` - Item categories
- `menu_items` - Menu items with sizes/prices
- `menu_addons` - Available add-ons
- `category_addons` - Links add-ons to categories

### Key Relationships
- Session items are temporary (cart) until order confirmed
- Order confirmation converts session_items to JSONB in orders.items
- Sessions belong to one customer and one business
- Fulfillment info stored on both session and order

## Environment Variables

```env
# Supabase
SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_KEY=your-service-role-key

# Google Gemini AI
GEMINI_API_KEY=your-gemini-api-key

# WhatsApp
WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
WHATSAPP_ACCESS_TOKEN=your-access-token
WHATSAPP_VERIFY_TOKEN=your-verify-token

# Optional
PORT=3000
NODE_ENV=development
```

## AI Configuration (src/config/constants.ts)
- Model: `gemini-2.0-flash`
- Temperature: 0.3 (lower for consistency)
- Max tokens: 500
- Timeout: 30 seconds with retry

## Key Implementation Details

### Multi-Tenancy
- Business identified by WhatsApp phone number in webhook
- `getBusinessByPhone()` looks up business from incoming webhook metadata
- All data scoped by `business_id`

### Critical Message Mode
When `business.critical_message_enabled = true`:
- AI is bypassed completely
- `critical_message` sent to all customers
- Useful for emergencies, holidays, etc.

### Duplicate Prevention (webhookController.ts:78-101)
- `isItemDuplicate()` checks same item+size in cart
- Uses fuzzy matching (lowercase, includes)
- Prevents duplicate cart entries

### Server-Side Intent Override (webhookController.ts:189-200)
When user says "yes" and fulfillment is complete:
- Forces `confirm_order` intent even if AI doesn't detect it
- Ensures reliable order confirmation

### Order Summary Generation (orderService.ts:181-291)
`generateOrderSummary()` includes:
- Item list with prices
- Add-ons with prices
- Grand total
- Fulfillment info (delivery address or pickup outlet)
- Optional CTA message

## Common Development Patterns

### Adding a New Intent
1. Add to `AIIntent` type (src/types/index.ts:218)
2. Update AI system prompt (src/services/aiService.ts)
3. Add case handler in `processMessage()` switch (webhookController.ts)

### Adding Menu Features
- Items support sizes array: `[{name: "500g", price: 300}]`
- `is_customizable` - allows custom text
- `requires_date` - requires delivery date
- `special_notes` - allergen info, prep time
- Clear cache after changes: `clearMenuCache(businessId)`

### Debugging Tips
- Session items: `GET /api/sessions/:sessionId`
- Orders: `GET /api/orders/:orderId`
- Messages: stored in messages table
- AI responses: stored in `session_items.ai_raw`
- Enable debug logging for full AI prompts/responses

## File Structure

```
src/
├── app.ts                    # Express app setup
├── config/
│   ├── constants.ts          # AI model config
│   └── database.ts           # Supabase client
├── controllers/
│   ├── webhookController.ts  # Main message processing
│   ├── auth*.ts              # Admin auth
│   ├── admin*.ts             # Admin CRUD
│   └── dashboard*.ts         # Dashboard stats
├── middleware/
│   └── auth.ts               # JWT auth middleware
├── routes/                   # Express routes
├── services/
│   ├── aiService.ts          # Gemini AI integration
│   ├── orderService.ts       # Order management
│   ├── sessionService.ts     # Session management
│   ├── menuService.ts        # Menu with cache
│   ├── fulfillmentService.ts # Delivery/takeaway
│   ├── addonService.ts       # Add-ons
│   ├── outletService.ts      # Pickup outlets
│   └── whatsappService.ts    # WhatsApp API
├── types/
│   └── index.ts              # TypeScript interfaces
└── utils/
    ├── logger.ts             # Logging
    └── validators.ts         # Input validation
```
