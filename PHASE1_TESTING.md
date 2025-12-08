# Phase 1: Delivery/Takeaway Testing Guide

## ✅ Prerequisites

1. **Run the database migration**:
   ```bash
   # Go to Supabase SQL Editor and run:
   # migrations/001_add_outlets_and_fulfillment.sql
   ```

2. **Update your business ID**:
   - In the migration file, replace `c3150207-4bf9-4ce4-8478-2e6369c46749` with your actual business UUID
   - The business ID is also hardcoded in:
     - `src/controllers/webhookController.ts:56`
     - `src/services/orderService.ts:12`

3. **Start the server**:
   ```bash
   npm run dev
   ```

## 📋 Test Scenarios

### Scenario 1: Delivery Order (Happy Path)

```bash
# Step 1: Start ordering
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543210", "message": "I want a chocolate cake"}'

# Expected: AI asks for size or details

# Step 2: Provide details
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543210", "message": "2kg for tomorrow"}'

# Expected: Item added, AI confirms

# Step 3: Finish adding items
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543210", "message": "that'\''s all"}'

# Expected: Order summary with prices shown

# Step 4: AI asks for delivery/takeaway (NEW!)
# Expected: "Would you like delivery or takeaway?"

# Step 5: Choose delivery
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543210", "message": "delivery please"}'

# Expected: "Please share your delivery address"

# Step 6: Provide address
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543210", "message": "MG Road, near City Mall"}'

# Expected: "When would you like it delivered?"

# Step 7: Provide delivery time
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543210", "message": "tomorrow 6pm"}'

# Expected: Summary with delivery details, ask to confirm

# Step 8: Confirm order
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543210", "message": "yes"}'

# Expected: ✅ Order confirmed with Order ID
```

### Scenario 2: Takeaway Order (Outlet Selection)

```bash
# Steps 1-3: Same as above (add items, say "that's all")

# Step 4: Choose takeaway
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543211", "message": "takeaway"}'

# Expected: Shows list of outlets with numbers

# Step 5: Select outlet by number
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543211", "message": "2"}'

# Expected: "When would you like to pick up?"

# Step 6: Provide pickup time
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543211", "message": "today 7pm"}'

# Expected: Summary with pickup details, ask to confirm

# Step 7: Confirm
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543211", "message": "yes confirm"}'

# Expected: ✅ Order confirmed
```

### Scenario 3: Combined (Delivery + Address in one message)

```bash
# After seeing "that's all" summary...

curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543212", "message": "delivery to Lakeview apartments tomorrow 5pm"}'

# Expected: AI should extract:
#   - fulfillment_type: delivery
#   - address: Lakeview apartments
#   - time: tomorrow 5pm
#   - Then ask to confirm
```

### Scenario 4: Outlet Selection by Name

```bash
# After choosing takeaway...

curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543213", "message": "North Branch"}'

# Expected: Should match "North Branch - Mall Road" outlet
```

## 🔍 What to Check

### In Database (Supabase)

1. **sessions table** should have:
   - `fulfillment_type` = 'delivery' or 'takeaway'
   - `delivery_address` (for delivery orders)
   - `pickup_outlet_id` (for takeaway orders)
   - `delivery_time` or `pickup_time`

2. **orders table** should have:
   - All fulfillment fields copied from session
   - `order_summary` includes fulfillment details

3. **business_outlets table** should have 3 sample outlets

### In Console Logs

- Look for: `"Fulfillment type set to: delivery"` or `"...takeaway"`
- Look for: `"Delivery info saved: [address]"`
- Look for: `"Pickup outlet selected: [outlet name]"`
- Order notification should show 🚚 or 📍 icon

### In API Responses

- Order summary should include:
  ```
  🚚 Delivery to: MG Road, near City Mall
  ⏰ Time: [formatted time]
  ```
  OR
  ```
  📍 Pickup from outlet
  ⏰ Time: [formatted time]
  ```

## 🐛 Common Issues & Fixes

### Issue 1: "No outlets available"
**Fix**: Run the migration SQL to create sample outlets

### Issue 2: AI doesn't ask for delivery/takeaway
**Fix**: Check that business has `supports_delivery` and `supports_takeaway` set to `true`

### Issue 3: Outlet selection doesn't work
**Fix**: Make sure outlets are created with correct business_id

### Issue 4: Time parsing fails
**Fix**: Try different formats: "tomorrow 5pm", "today evening", "2pm"

## 📊 Verification Queries

Run these in Supabase SQL Editor to verify data:

```sql
-- Check outlets
SELECT * FROM business_outlets WHERE business_id = 'YOUR_BUSINESS_ID';

-- Check session fulfillment data
SELECT
  id,
  fulfillment_type,
  delivery_address,
  pickup_outlet_id,
  delivery_time,
  pickup_time
FROM sessions
WHERE customer_id IN (
  SELECT id FROM customers WHERE phone = '919876543210'
)
ORDER BY created_at DESC
LIMIT 5;

-- Check order fulfillment data
SELECT
  id,
  fulfillment_type,
  delivery_address,
  pickup_outlet_id,
  total_amount,
  status
FROM orders
ORDER BY created_at DESC
LIMIT 5;

-- Get full order details with outlet name
SELECT
  o.*,
  bo.outlet_name,
  bo.address as outlet_address
FROM orders o
LEFT JOIN business_outlets bo ON o.pickup_outlet_id = bo.id
ORDER BY o.created_at DESC
LIMIT 5;
```

## ✨ Success Criteria

Phase 1 is complete when:

- ✅ Customer can choose delivery or takeaway
- ✅ Delivery address is collected and saved
- ✅ Takeaway outlet is selected (by number or name)
- ✅ Delivery/pickup time is parsed and saved
- ✅ Order summary shows fulfillment details
- ✅ Final order includes all fulfillment data
- ✅ Business notification shows delivery/pickup info
- ✅ Multiple outlets work correctly

## 🚀 Next Steps (Phase 2)

After Phase 1 is verified:
- Add-ons system (candles, special packing, etc.)
- Smart suggestions based on category
- Add-ons pricing in summary
- Mixed orders (some items delivery, some takeaway)
