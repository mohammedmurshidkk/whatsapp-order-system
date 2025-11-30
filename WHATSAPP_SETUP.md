# WhatsApp Business API Setup Guide

## Quick Start (For Testing)

### Step 1: Start Your Server
```bash
cd whatsapp-order-system
npm run dev
```

### Step 2: Expose with ngrok
```bash
# Install ngrok if not installed
brew install ngrok

# In a new terminal
ngrok http 3000
```

Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)

### Step 3: Set Up Meta Developer Account

1. Go to https://developers.facebook.com
2. Click "My Apps" → "Create App"
3. Select "Business" → Next
4. Enter app name → Create App
5. Find "WhatsApp" and click "Set Up"
6. Follow the getting started guide

### Step 4: Configure Webhook

In Meta Developer Portal → WhatsApp → Configuration:

- **Callback URL**: `https://your-ngrok-url/webhook/whatsapp`
- **Verify Token**: `my_verify_token`
- **Webhook Fields**: Subscribe to `messages`

### Step 5: Get Your Credentials

From the WhatsApp → API Setup page, get:
- Phone Number ID
- WhatsApp Business Account ID
- Access Token (generate a permanent one)

### Step 6: Update .env

```env
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_ACCESS_TOKEN=your_permanent_access_token
WHATSAPP_VERIFY_TOKEN=my_verify_token
```

### Step 7: Test with Meta's Test Number

Meta provides a test phone number. You can send messages to it and they'll forward to your webhook.

---

## How Data Flows

```
┌─────────────────┐
│   Customer      │
│   WhatsApp      │
└────────┬────────┘
         │ Sends "I want cake"
         ▼
┌─────────────────┐
│   Meta Servers  │
│   (WhatsApp)    │
└────────┬────────┘
         │ POST /webhook/whatsapp
         ▼
┌─────────────────┐
│  Your Server    │
│  (Express)      │
│                 │
│  1. Find/Create │
│     Customer    │
│  2. Find/Create │
│     Session     │
│  3. Call Gemini │
│     AI          │
│  4. Save to     │
│     Supabase    │
└────────┬────────┘
         │ Send reply via API
         ▼
┌─────────────────┐
│   Meta Servers  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Customer      │
│   Receives      │
│   Reply         │
└─────────────────┘
```

## What Gets Saved to Supabase

| Table | Data |
|-------|------|
| `customers` | Phone number, name |
| `sessions` | Active ordering session |
| `messages` | All incoming/outgoing messages |
| `session_items` | Items being ordered |
| `orders` | Confirmed final orders |

## Testing Without WhatsApp

Use the test endpoint to simulate messages:

```bash
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543210", "message": "I want a chocolate cake"}'
```

This saves everything to Supabase just like a real WhatsApp message would.

## Cafe Owner Receiving Orders

When a customer confirms an order, the system:
1. Creates a record in `orders` table
2. Logs the order to console (for now)

To notify the cafe owner, you can:
1. **Check Supabase directly** - View orders in the dashboard
2. **Add Telegram notification** - We can add this feature
3. **Add Email notification** - We can add this feature
4. **Build an admin dashboard** - View orders in a web interface

## Common Issues

### Webhook not receiving messages
- Make sure ngrok is running
- Check the webhook URL is correct in Meta portal
- Verify the verify_token matches

### Messages not sending
- Check WHATSAPP_ACCESS_TOKEN is valid
- Token expires - generate a permanent one in Meta portal
- Check WHATSAPP_PHONE_NUMBER_ID is correct

### Permission errors
- Your app needs to be approved for production
- For testing, you can only message numbers added to your test list
