# WhatsApp AI Ordering System

AI-powered ordering system for cafes/bakeries using WhatsApp, Gemini AI, and Supabase.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Copy `.env.example` to `.env` and fill in your credentials:
```bash
cp .env.example .env
```

Required environment variables:
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_KEY` - Your Supabase service role key
- `GEMINI_API_KEY` - Your Google Gemini API key

3. Run in development mode:
```bash
npm run dev
```

4. Build for production:
```bash
npm run build
npm start
```

## API Endpoints

### Health Check
```
GET /health
```

### Test Message (for development)
```
POST /test/message
Content-Type: application/json

{
  "phone": "919876543210",
  "message": "I want a chocolate cake"
}
```

### WhatsApp Webhook
```
GET /webhook/whatsapp - Webhook verification
POST /webhook/whatsapp - Receive messages
```

### Orders & Sessions (debugging)
```
GET /webhook/orders/:orderId
GET /webhook/customers/:customerId/orders
GET /webhook/sessions/:sessionId
```

## Database Schema

Run these SQL commands in your Supabase SQL editor:

```sql
-- Customers table
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Sessions table
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id),
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  last_message_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  total_items INT DEFAULT 0
);

-- Session items table
CREATE TABLE session_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id),
  item_name VARCHAR(200) NOT NULL,
  quantity INT DEFAULT 1,
  size_or_weight VARCHAR(50),
  custom_text TEXT,
  delivery_date DATE,
  notes TEXT,
  ai_raw JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Messages table
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id),
  direction VARCHAR(10) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Orders table
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id),
  customer_id UUID REFERENCES customers(id),
  items JSONB NOT NULL,
  total_items INT,
  order_summary TEXT,
  status VARCHAR(20) DEFAULT 'confirmed',
  created_at TIMESTAMP DEFAULT NOW(),
  delivery_date DATE
);
```

## Testing Flow

1. Start the server: `npm run dev`

2. Send a test order:
```bash
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543210", "message": "I want a chocolate cake"}'
```

3. Continue the conversation:
```bash
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543210", "message": "1kg for tomorrow"}'
```

4. Complete the order:
```bash
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543210", "message": "thats all"}'

curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543210", "message": "yes confirm"}'
```
