# Menu Display Solution

## Problem
- With 500+ menu items, showing full menu as text is:
  - Unreadable (500+ lines)
  - Causes JSON truncation errors
  - Poor UX

## Solution

### 1. AI Prompt Optimization
- **Before**: Full menu with prices, sizes, notes in AI prompt (huge token usage)
- **After**: Only item names grouped by category
- AI doesn't need prices/sizes - it just validates item names
- Prices looked up from database when item is added

### 2. Smart Menu Display
- **Direct Orders**: Customer says "I want black forest cake" → AI processes immediately, NO menu shown
- **Menu Request**: Customer asks "show menu" → System sends interactive menu

### 3. Menu Display Options

#### Option A: Category-wise Text (Current - Simple)
```
📋 Our Menu

🎂 Cakes
1. Black Forest - ₹400-1400
2. Chocolate Truffle - ₹350-1200
...

☕ Hot Beverages
1. Coffee - ₹30-70
2. Tea - ₹20-40
...

Reply with item name or number to order!
```

####Option B: WhatsApp Interactive List Messages (Better)
- Native WhatsApp UI with clickable lists
- Up to 10 sections, 10 items per section = 100 items max
- For 500 items, send 5 separate list messages

#### Option C: WhatsApp Product Catalog (Best)
- Native catalog with images, prices
- Searchable by customer
- Requires WhatsApp Business API approval

## Implementation

### Phase 1 (Done)
- ✅ Added `image_url` to menu_items, menu_categories, menu_addons
- ✅ Updated CSV templates
- ✅ Simplified AI prompt (just item names)
- ✅ Fixed JSON truncation issue

### Phase 2 (Next)
- Create WhatsApp Interactive List Message service
- Update webhook to use lists for large menus
- Add WhatsApp Product Catalog support

## Database Changes
```sql
ALTER TABLE menu_categories ADD COLUMN image_url TEXT;
ALTER TABLE menu_items ADD COLUMN image_url TEXT;
ALTER TABLE menu_addons ADD COLUMN image_url TEXT;
```

## CSV Format
**menu_template.csv**:
```csv
category,item_name,description,price,sizes,is_customizable,requires_date,special_notes,image_url
Cakes,Black Forest,Classic cake,,500g:400|1kg:750,yes,yes,,https://example.com/cake.jpg
```

**addons_template.csv**:
```csv
addon_name,category,description,price,link_to_categories,is_auto_suggested,image_url
Number Candle,candle,Custom number,50,Cakes,yes,https://example.com/candle.jpg
```
