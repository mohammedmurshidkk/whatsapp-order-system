# WhatsApp AI Ordering System - V2 SaaS Scaling Plan

## Current MVP Status

### What We Have ✅
- Single-tenant WhatsApp ordering bot
- Gemini AI for natural language processing
- Supabase PostgreSQL database
- Menu management with CSV import
- Order creation, modification, cancellation
- Human takeover mode
- Session management with 2-hour timeout

### Current Limitations ⚠️
- Single business (hardcoded DEFAULT_BUSINESS_ID)
- Single WhatsApp number
- No admin dashboard
- No authentication/authorization
- Single Node.js process (no horizontal scaling)
- No message queue (direct processing)
- No rate limiting
- No analytics/reporting

---

## V2 Architecture: Multi-Tenant SaaS

### 1. Database Schema Changes

```sql
-- Tenants (Super Admins who own businesses)
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  plan_type VARCHAR(50) DEFAULT 'free', -- free, starter, pro, enterprise
  max_businesses INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Update businesses table
ALTER TABLE businesses ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE businesses ADD COLUMN whatsapp_phone_id VARCHAR(50); -- WhatsApp Business API phone ID
ALTER TABLE businesses ADD COLUMN whatsapp_token TEXT; -- Encrypted API token
ALTER TABLE businesses ADD COLUMN business_type VARCHAR(50); -- cafe, restaurant, supermarket, etc.
ALTER TABLE businesses ADD COLUMN timezone VARCHAR(50) DEFAULT 'Asia/Kolkata';
ALTER TABLE businesses ADD COLUMN operating_hours JSONB; -- {"mon": {"open": "09:00", "close": "21:00"}, ...}
ALTER TABLE businesses ADD COLUMN auto_reply_outside_hours TEXT;

-- API Keys for tenants
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  key_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100),
  permissions JSONB DEFAULT '["read", "write"]',
  last_used_at TIMESTAMP,
  expires_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Webhook configurations per business
CREATE TABLE webhook_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id),
  whatsapp_verify_token VARCHAR(255),
  whatsapp_app_secret TEXT, -- Encrypted
  callback_url TEXT,
  is_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Usage tracking for billing
CREATE TABLE usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  business_id UUID REFERENCES businesses(id),
  event_type VARCHAR(50), -- message_received, message_sent, ai_call, order_created
  count INTEGER DEFAULT 1,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Monthly usage aggregates
CREATE TABLE usage_monthly (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  year_month VARCHAR(7), -- 2024-01
  messages_received INTEGER DEFAULT 0,
  messages_sent INTEGER DEFAULT 0,
  ai_calls INTEGER DEFAULT 0,
  orders_created INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, year_month)
);
```

### 2. System Architecture

```
                                    ┌─────────────────────────────────────┐
                                    │         Load Balancer               │
                                    │    (AWS ALB / Cloudflare / Nginx)   │
                                    └─────────────────┬───────────────────┘
                                                      │
                    ┌─────────────────────────────────┼─────────────────────────────────┐
                    │                                 │                                 │
                    ▼                                 ▼                                 ▼
          ┌─────────────────┐               ┌─────────────────┐               ┌─────────────────┐
          │  API Server 1   │               │  API Server 2   │               │  API Server N   │
          │   (Node.js)     │               │   (Node.js)     │               │   (Node.js)     │
          └────────┬────────┘               └────────┬────────┘               └────────┬────────┘
                   │                                 │                                 │
                   └─────────────────────────────────┼─────────────────────────────────┘
                                                     │
                                                     ▼
                                    ┌─────────────────────────────────────┐
                                    │         Message Queue               │
                                    │   (Redis / BullMQ / AWS SQS)        │
                                    └─────────────────┬───────────────────┘
                                                      │
                    ┌─────────────────────────────────┼─────────────────────────────────┐
                    │                                 │                                 │
                    ▼                                 ▼                                 ▼
          ┌─────────────────┐               ┌─────────────────┐               ┌─────────────────┐
          │  Worker 1       │               │  Worker 2       │               │  Worker N       │
          │  (AI + DB)      │               │  (AI + DB)      │               │  (AI + DB)      │
          └────────┬────────┘               └────────┬────────┘               └────────┬────────┘
                   │                                 │                                 │
                   └─────────────────────────────────┼─────────────────────────────────┘
                                                     │
                          ┌──────────────────────────┼──────────────────────────┐
                          │                          │                          │
                          ▼                          ▼                          ▼
               ┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
               │    Supabase      │       │      Redis       │       │   AI Service     │
               │   PostgreSQL     │       │   (Cache/Queue)  │       │ (Gemini/OpenAI)  │
               └──────────────────┘       └──────────────────┘       └──────────────────┘
```

### 3. Key Components for Scaling

#### A. Message Queue System (Critical for High Volume)

```typescript
// src/queues/messageQueue.ts
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

// Queue for incoming WhatsApp messages
export const messageQueue = new Queue('whatsapp-messages', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

// Worker to process messages
const worker = new Worker('whatsapp-messages', async (job) => {
  const { businessId, phone, message, timestamp } = job.data;

  // Process message with AI
  await processMessage(phone, message, businessId);

}, {
  connection: redis,
  concurrency: 10, // Process 10 messages in parallel
  limiter: {
    max: 100,      // Max 100 jobs
    duration: 1000, // Per second
  },
});
```

#### B. Multi-Tenant Webhook Handler

```typescript
// src/controllers/webhookController.ts
export async function handleWhatsAppWebhook(req: Request, res: Response) {
  res.status(200).send('OK'); // Respond immediately

  const phoneNumberId = req.body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

  // Lookup business by WhatsApp phone ID
  const business = await getBusinessByWhatsAppPhoneId(phoneNumberId);

  if (!business) {
    logger.warn(`Unknown WhatsApp phone ID: ${phoneNumberId}`);
    return;
  }

  // Add to queue instead of processing directly
  await messageQueue.add('process-message', {
    businessId: business.id,
    tenantId: business.tenant_id,
    phone: message.from,
    message: message.text.body,
    timestamp: Date.now(),
  });
}
```

#### C. Caching Layer

```typescript
// src/services/cacheService.ts
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);
const CACHE_TTL = 300; // 5 minutes

export async function getCachedMenu(businessId: string): Promise<MenuItem[] | null> {
  const cached = await redis.get(`menu:${businessId}`);
  return cached ? JSON.parse(cached) : null;
}

export async function cacheMenu(businessId: string, items: MenuItem[]): Promise<void> {
  await redis.setex(`menu:${businessId}`, CACHE_TTL, JSON.stringify(items));
}

export async function getCachedBusiness(phoneId: string): Promise<Business | null> {
  const cached = await redis.get(`business:phone:${phoneId}`);
  return cached ? JSON.parse(cached) : null;
}

export async function invalidateBusinessCache(businessId: string): Promise<void> {
  const keys = await redis.keys(`*:${businessId}*`);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}
```

#### D. Rate Limiting

```typescript
// src/middleware/rateLimiter.ts
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';

export const webhookRateLimiter = rateLimit({
  store: new RedisStore({
    client: redis,
    prefix: 'rl:webhook:',
  }),
  windowMs: 1000,       // 1 second
  max: 100,             // 100 requests per second
  standardHeaders: true,
  legacyHeaders: false,
});

export const apiRateLimiter = rateLimit({
  store: new RedisStore({
    client: redis,
    prefix: 'rl:api:',
  }),
  windowMs: 60 * 1000,  // 1 minute
  max: 100,             // 100 requests per minute
  keyGenerator: (req) => req.headers['x-api-key'] || req.ip,
});
```

---

## 4. Deployment Options

### Option A: Simple & Cost-Effective (Recommended for Start)

**Railway / Render / Fly.io**
- Auto-scaling Node.js containers
- Managed Redis add-on
- Easy deployment with GitHub integration
- Cost: ~$20-50/month to start

```yaml
# railway.toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "npm run start"
healthcheckPath = "/health"
healthcheckTimeout = 100
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3

[[services]]
name = "api"
numReplicas = 2  # Scale up as needed
```

### Option B: AWS (Enterprise Scale)

```
┌─────────────────────────────────────────────────────────────┐
│                        AWS Architecture                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Route 53 → CloudFront → ALB → ECS Fargate (Auto-scaling)   │
│                                     │                        │
│                                     ▼                        │
│                              ┌──────────────┐                │
│                              │   ECS Tasks  │                │
│                              │  (2-10 pods) │                │
│                              └──────┬───────┘                │
│                                     │                        │
│           ┌─────────────────────────┼─────────────────┐      │
│           ▼                         ▼                 ▼      │
│    ┌─────────────┐          ┌─────────────┐    ┌──────────┐  │
│    │    RDS      │          │ ElastiCache │    │   SQS    │  │
│    │ PostgreSQL  │          │   (Redis)   │    │  Queue   │  │
│    └─────────────┘          └─────────────┘    └──────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

Cost: ~$200-500/month (scales with usage)

### Option C: Serverless (Pay-per-use)

```
Cloudflare Workers / Vercel Edge Functions
    │
    ▼
Upstash Redis (Serverless) + Supabase (Already have)
    │
    ▼
Serverless AI (Gemini API)
```

Cost: Pay only for what you use, great for variable traffic

---

## 5. Performance Benchmarks

### Current MVP (Single Process)
- ~50-100 messages/minute
- ~500ms average response time
- Single point of failure

### V2 Target (With Queue + Workers)
- ~1000-5000 messages/minute
- ~200-300ms average response time
- Horizontal scaling
- No single point of failure

### Bottleneck Analysis

| Component | Current Limit | Solution |
|-----------|--------------|----------|
| Node.js | ~1000 req/s | Multiple instances + Load balancer |
| Supabase | ~500 connections | Connection pooling (PgBouncer) |
| Gemini AI | Rate limited | Queue + retry + fallback to OpenAI |
| WhatsApp API | 80 msg/s/phone | Multiple phone numbers |

---

## 6. Multi-Tenant Features to Add

### Phase 1: Core Multi-Tenancy
- [ ] Tenant registration & authentication (JWT)
- [ ] Business onboarding wizard
- [ ] WhatsApp Business API integration per tenant
- [ ] Tenant isolation (Row Level Security in Supabase)

### Phase 2: Admin Dashboard
- [ ] React/Next.js admin panel
- [ ] Menu management UI (drag-drop)
- [ ] Order management dashboard
- [ ] Real-time chat view (human takeover)
- [ ] Analytics & reports

### Phase 3: Advanced Features
- [ ] Custom AI personality per business
- [ ] Multi-language support
- [ ] Payment integration (Razorpay, Stripe)
- [ ] Delivery integration
- [ ] Inventory management
- [ ] Customer CRM

### Phase 4: Enterprise
- [ ] White-label solution
- [ ] API access for integrations
- [ ] SSO (Single Sign-On)
- [ ] Audit logs
- [ ] SLA guarantees

---

## 7. Code Changes Required

### File Structure for V2

```
src/
├── api/                    # REST API routes
│   ├── v1/
│   │   ├── auth.ts        # Tenant authentication
│   │   ├── businesses.ts  # Business CRUD
│   │   ├── menus.ts       # Menu management
│   │   ├── orders.ts      # Order management
│   │   └── webhooks.ts    # WhatsApp webhooks
│   └── middleware/
│       ├── auth.ts        # JWT validation
│       ├── tenantContext.ts # Set tenant context
│       └── rateLimiter.ts
├── workers/                # Background job processors
│   ├── messageWorker.ts   # Process WhatsApp messages
│   ├── notificationWorker.ts
│   └── analyticsWorker.ts
├── services/
│   ├── tenantService.ts   # Tenant operations
│   ├── businessService.ts # Business operations
│   ├── cacheService.ts    # Redis caching
│   └── queueService.ts    # Job queue management
├── config/
│   ├── database.ts        # Supabase connection
│   ├── redis.ts           # Redis connection
│   └── queue.ts           # BullMQ configuration
└── utils/
    ├── encryption.ts      # Encrypt API tokens
    └── multiTenant.ts     # Tenant utilities
```

### Environment Variables for V2

```env
# Database
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=

# Redis (for queue + cache)
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d

# WhatsApp (now per-tenant, stored in DB)
# WHATSAPP_API_TOKEN= (moved to DB, encrypted)

# AI
GEMINI_API_KEY=
OPENAI_API_KEY=  # Fallback

# Scaling
NODE_ENV=production
WORKERS_COUNT=4
QUEUE_CONCURRENCY=10

# Monitoring
SENTRY_DSN=
LOG_LEVEL=info
```

---

## 8. Migration Path

### Step 1: Add Redis & Queue (1-2 days)
```bash
npm install ioredis bullmq
```
- Set up message queue
- Modify webhook to queue instead of direct process
- Add workers to process queue

### Step 2: Multi-Tenant Database (1-2 days)
- Run migration scripts
- Add Row Level Security policies
- Update all queries to include tenant_id/business_id

### Step 3: Authentication (2-3 days)
- Add JWT authentication
- Create tenant registration/login APIs
- Protect all routes

### Step 4: Admin Dashboard (1-2 weeks)
- Build React/Next.js frontend
- Connect to APIs
- Deploy as separate service

### Step 5: Deploy & Monitor (1-2 days)
- Set up CI/CD
- Configure monitoring (Sentry, logs)
- Load testing

---

## 9. Estimated Costs at Scale

### 1,000 orders/day (~50 businesses)
| Service | Monthly Cost |
|---------|-------------|
| Supabase Pro | $25 |
| Railway (2 instances) | $40 |
| Redis (Upstash) | $10 |
| Gemini AI | $50-100 |
| **Total** | **~$125-175/month** |

### 10,000 orders/day (~500 businesses)
| Service | Monthly Cost |
|---------|-------------|
| Supabase Pro | $25 |
| Railway (5 instances) | $100 |
| Redis (Upstash Pro) | $50 |
| Gemini AI | $300-500 |
| **Total** | **~$475-675/month** |

### 100,000 orders/day (~5,000 businesses)
| Service | Monthly Cost |
|---------|-------------|
| AWS RDS | $200 |
| AWS ECS | $500 |
| ElastiCache | $150 |
| AI APIs | $2,000-3,000 |
| **Total** | **~$2,850-3,850/month** |

---

## 10. Recommended Next Steps

1. **Immediate (This Week)**
   - Add Redis for caching
   - Implement message queue with BullMQ
   - Add basic rate limiting

2. **Short Term (2-4 Weeks)**
   - Build tenant management system
   - Create admin dashboard MVP
   - Add authentication

3. **Medium Term (1-2 Months)**
   - Full multi-tenant support
   - Payment integration
   - Deploy to production with monitoring

4. **Long Term (3-6 Months)**
   - White-label solution
   - Mobile app for business owners
   - Advanced analytics
   - API marketplace

---

## Questions to Consider

1. **Pricing Model**: Per message? Per order? Per business? Tiered plans?
2. **Target Market**: Focus on one vertical (cafes) or go broad?
3. **WhatsApp Business API**: Partner with BSP or direct API access?
4. **Regional Focus**: India first, then expand? Or global from start?
5. **Compliance**: GDPR, data residency requirements?

---

*Last Updated: November 2024*
*Version: MVP → V2 Planning Document*
