# Phase 2: Add-ons System Testing Guide

## ✅ Prerequisites

1. **Run the database migration**:
   ```bash
   # Go to Supabase SQL Editor and run:
   # migrations/002_add_addons_system.sql
   ```

2. **Verify business ID** in migration matches your actual business ID

3. **Start the server**:
   ```bash
   npm run dev
   ```

## 📋 Test Scenarios

### Scenario 1: Cake Order with Candle Add-on (Auto-suggested)

```bash
# Step 1: Order a cake
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543210", "message": "I want Black Forest cake"}'

# Expected: AI asks for size

# Step 2: Provide size
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543210", "message": "2kg"}'

# Expected: Item added + Auto-suggests candles:
# "Great! I've added Black Forest (2kg).
#
# 🎁 Would you like to add any of these?
#
# 1. Standard Candle (Free) - Basic birthday candle
# 2. Number Candle - ₹50 - Custom number candle
# 3. Sparkler Candle - ₹100 - Musical sparkler candle
#
# Reply with the number to add, or say 'no thanks' to skip"

# Step 3: Select add-on by number
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543210", "message": "2"}'

# Expected: "Added Number Candle (₹50)! Anything else you'd like to order?"

# Step 4: Finish order
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543210", "message": "that'\''s all"}'

# Expected: Order summary shows:
# 1. Black Forest (2kg) - ₹800
#    + Number Candle - ₹50
# ━━━━━━━━━━━━━━━━━━
# 💰 Grand Total: ₹850
```

### Scenario 2: Decline Add-ons

```bash
# After seeing add-on suggestions...
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543211", "message": "no thanks"}'

# Expected: "No problem! Anything else you'd like to order?"
```

### Scenario 3: Burger with Multiple Toppings

```bash
# Step 1: Order burger
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543212", "message": "I want a burger"}'

# Expected: Suggests toppings:
# 1. Extra Cheese - ₹20
# 2. Extra Sauce - ₹10
# 3. Extra Patty - ₹50

# Step 2: Select first topping
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543212", "message": "1"}'

# Expected: "Added Extra Cheese (₹20)! Anything else?"

# Step 3: Add another topping (if customer wants to add more to same item, they need to order again)
# For now, proceed to checkout

curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543212", "message": "that'\''s all"}'

# Expected: Summary shows burger + extra cheese
```

### Scenario 4: Free Add-on

```bash
# Order cake, then select free standard candle
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543213", "message": "1"}'

# When selecting Standard Candle (Free)
# Expected: "Added Standard Candle (FREE)! Anything else?"

# Summary should show:
#    + Standard Candle - FREE
```

### Scenario 5: Select Add-on by Name

```bash
# After seeing candle suggestions...
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543214", "message": "number candle"}'

# Expected: "Added Number Candle (₹50)! Anything else?"
```

### Scenario 6: Coffee with Beverage Extras

```bash
# Step 1: Order coffee
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543215", "message": "One coffee please"}'

# Expected: Asks for size

# Step 2: Choose size
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543215", "message": "medium"}'

# Expected: Suggests beverage extras:
# 1. Extra Shot - ₹30
# 2. Whipped Cream - ₹20
# 3. Flavor Syrup - ₹25

# Step 3: Add extra shot
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543215", "message": "1"}'

# Expected: "Added Extra Shot (₹30)! Anything else?"
```

### Scenario 7: Complete Flow with Delivery

```bash
# Complete order: Cake + Candle + Delivery

# 1. Add cake with candle (steps above)
# 2. Say "that's all"
# 3. Choose delivery
# 4. Provide address
# 5. Provide time
# 6. Confirm

# Final summary should show:
# 1. Black Forest (2kg) - ₹800
#    + Number Candle - ₹50
#
# 🚚 Delivery to: MG Road
# ⏰ Time: Tomorrow at 6:00 PM
#
# 💰 Grand Total: ₹850
```

## 🔍 What to Check

### In Database (Supabase)

1. **menu_addons table**:
   ```sql
   SELECT * FROM menu_addons WHERE business_id = 'YOUR_BUSINESS_ID';
   ```
   - Should show candles, packing, toppings, beverage extras

2. **category_addons table**:
   ```sql
   SELECT ca.*, mc.name as category_name, ma.name as addon_name
   FROM category_addons ca
   JOIN menu_categories mc ON ca.menu_category_id = mc.id
   JOIN menu_addons ma ON ca.addon_id = ma.id
   WHERE ca.is_auto_suggested = true;
   ```
   - Should show which add-ons are auto-suggested for which categories

3. **session_item_addons table**:
   ```sql
   SELECT sia.*, si.item_name
   FROM session_item_addons sia
   JOIN session_items si ON sia.session_item_id = si.id
   ORDER BY sia.created_at DESC
   LIMIT 10;
   ```
   - Should show added add-ons with prices

4. **orders table** (after confirmation):
   ```sql
   SELECT id, items, total_amount
   FROM orders
   ORDER BY created_at DESC
   LIMIT 1;
   ```
   - Check that `items` JSONB includes `addons` array
   - Check that `total_amount` includes addon prices

### In Console Logs

- Look for: `"X add-ons available for [item]"`
- Look for: `"Add-on added: [name] (₹X) to item [id]"`
- Look for: `"Customer declined add-ons"`
- Order notification should show add-ons with indentation

### In API Responses

Order summary should show:
```
1. Black Forest (2kg) - ₹800
   + Number Candle - ₹50
   + Gift Box - ₹80
```

## 🐛 Common Issues & Fixes

### Issue 1: Add-ons not suggested
**Fix**:
- Check that category_addons has is_auto_suggested=true
- Verify menu item has a category_id
- Run: `SELECT * FROM category_addons WHERE is_auto_suggested = true;`

### Issue 2: Add-on not adding
**Fix**:
- Check lastAddedItemMap has session ID
- Verify add-on exists in database
- Check logs for "Add-on not found" errors

### Issue 3: Prices not calculating correctly
**Fix**:
- Verify addon has unit_price in menu_addons table
- Check that grandTotal calculation includes addons

### Issue 4: Add-ons not showing in summary
**Fix**:
- Verify session_items are fetched with addons (check sessionService.ts)
- Check that item.addons array is populated

## 📊 Verification Queries

```sql
-- Complete order view with add-ons
SELECT
  si.item_name,
  si.unit_price as item_price,
  sia.addon_name,
  sia.unit_price as addon_price,
  sia.quantity as addon_qty
FROM session_items si
LEFT JOIN session_item_addons sia ON si.id = sia.session_item_id
WHERE si.session_id = 'YOUR_SESSION_ID'
ORDER BY si.created_at, sia.created_at;

-- Total calculation check
SELECT
  s.id as session_id,
  SUM(si.unit_price * si.quantity) as items_total,
  SUM(COALESCE(sia.unit_price, 0) * sia.quantity) as addons_total,
  SUM(si.unit_price * si.quantity) + SUM(COALESCE(sia.unit_price, 0) * sia.quantity) as grand_total
FROM sessions s
JOIN session_items si ON s.id = si.session_id
LEFT JOIN session_item_addons sia ON si.id = sia.session_item_id
WHERE s.id = 'YOUR_SESSION_ID'
GROUP BY s.id;

-- Auto-suggestion mapping
SELECT
  mc.name as category,
  ma.name as addon,
  ma.price,
  ca.is_auto_suggested,
  ca.suggestion_priority
FROM category_addons ca
JOIN menu_categories mc ON ca.menu_category_id = mc.id
JOIN menu_addons ma ON ca.addon_id = ma.id
WHERE mc.business_id = 'YOUR_BUSINESS_ID'
ORDER BY mc.name, ca.suggestion_priority;
```

## ✨ Success Criteria

Phase 2 is complete when:

- ✅ Add-ons are auto-suggested after adding items
- ✅ Customer can select add-ons by number (1, 2, 3)
- ✅ Customer can select add-ons by name
- ✅ Customer can decline add-ons
- ✅ Free add-ons show as "FREE"
- ✅ Paid add-ons show correct prices
- ✅ Order summary shows add-ons as indented sub-items
- ✅ Grand total includes add-on prices
- ✅ Final order includes add-ons in JSONB
- ✅ Business notification shows add-ons
- ✅ Different categories suggest different add-ons

## 🎉 Expected Output Example

```
Customer: "Black Forest cake 2kg"
Bot: "Great! I've added Black Forest (2kg).

🎁 Would you like to add any of these?

1. Standard Candle (Free) - Basic birthday candle
2. Number Candle - ₹50 - Custom number candle
3. Sparkler Candle - ₹100 - Musical sparkler candle

Reply with the number to add, or say 'no thanks' to skip"

Customer: "2"
Bot: "Added Number Candle (₹50)! Anything else you'd like to order?"

Customer: "that's all"
Bot: "📋 Order Summary
━━━━━━━━━━━━━━━━━━

1. Black Forest (2kg) - ₹800
   + Number Candle - ₹50

━━━━━━━━━━━━━━━━━━
📦 Total Items: 1
💰 Grand Total: ₹850

Would you like delivery or takeaway?"
```

---

**Ready to test!** Run the migration and start testing with the scenarios above.
