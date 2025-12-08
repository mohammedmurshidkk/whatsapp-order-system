# Multi-Tenant SaaS Setup

The system now supports multiple businesses without hardcoded IDs.

## How It Works

1. **Business Identification**: Each business is identified by their WhatsApp phone number
2. **Automatic Routing**: When a message arrives, the system:
   - Extracts the business phone number from webhook metadata
   - Looks up the business in the database
   - Routes the conversation to the correct business context

## Setup New Business

### 1. Run Migration (One Time)
```bash
pnpm install
pnpm migrate:fresh   # New installation
# OR
pnpm migrate:update  # Existing database
```

### 2. Create Business
Edit `migrations/CREATE_BUSINESS.sql` with your business details, then run:
```bash
pnpm migrate:business
```

Note the business ID returned.

### 3. Upload Menu & Add-ons
Visit `http://localhost:3000/upload.html` and:
- Enter your business ID
- Upload menu CSV
- Upload add-ons CSV

## Testing

### Test Endpoint
```bash
curl -X POST http://localhost:3000/api/webhook/test \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "919876543210",
    "message": "I want to order a cake",
    "businessId": "YOUR_BUSINESS_ID"
  }'
```

### WhatsApp Webhook
The system automatically identifies the business from the incoming WhatsApp phone number.
No manual configuration needed.

## Environment Variables
Required in `.env`:
```env
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key
GEMINI_API_KEY=your_gemini_key
```

## Database Schema
- `businesses` - Root table for multi-tenancy
- All other tables reference `business_id`
- Phone number must match WhatsApp Business API number
