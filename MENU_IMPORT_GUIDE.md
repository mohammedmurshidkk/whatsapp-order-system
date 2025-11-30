# Menu Import Guide

## CSV Template Format

Download the template: `GET /api/menu/template`

### Columns

| Column | Required | Description | Example |
|--------|----------|-------------|---------|
| category | Yes | Category name | Cakes, Hot Beverages, Snacks |
| item_name | Yes | Item name | Black Forest, Coffee |
| description | No | Item description | Classic black forest cake |
| price | No* | Fixed price (if no sizes) | 80 |
| sizes | No* | Size options with prices | 500g:400\|1kg:750\|2kg:1400 |
| is_customizable | No | Can have custom text (yes/no) | yes |
| requires_date | No | Needs delivery date (yes/no) | yes |
| special_notes | No | Notes shown to customer | Best consumed within 24 hours |

*Either `price` OR `sizes` should be provided

### Sizes Format

Use pipe `|` to separate sizes, and colon `:` for price:
```
size_name:price|size_name:price|size_name:price
```

Examples:
- Cakes: `500g:400|1kg:750|2kg:1400`
- Beverages: `small:30|medium:50|large:70`
- Single size: `regular:80`

### Sample CSV

```csv
category,item_name,description,price,sizes,is_customizable,requires_date,special_notes
Cakes,Black Forest,Classic black forest cake,,500g:400|1kg:750|2kg:1400,yes,yes,Best consumed within 24 hours
Cakes,Chocolate Truffle,Rich chocolate truffle cake,,500g:350|1kg:650|2kg:1200,yes,yes,Keep refrigerated
Hot Beverages,Coffee,Fresh brewed coffee,,small:30|medium:50|large:70,no,no,
Hot Beverages,Tea,Kerala style chai,,small:20|medium:30|large:40,no,no,
Cold Beverages,Cool Coffee,Iced coffee,,small:50|medium:70|large:90,no,no,Shake before serving
Snacks,Sandwich,Veg club sandwich,80,,no,no,
Snacks,Samosa,Crispy samosa (2 pcs),30,,no,no,Best served hot
```

## API Endpoints

### 1. Download Template
```bash
GET /api/menu/template
```
Downloads a sample CSV template with example data.

### 2. Validate CSV (without importing)
```bash
POST /api/menu/validate
Content-Type: application/json

{
  "csv": "category,item_name,description,price,sizes,is_customizable,requires_date,special_notes\nCakes,Black Forest,Classic cake,,500g:400|1kg:750,yes,yes,"
}
```

Response:
```json
{
  "valid": true,
  "errors": [],
  "rowCount": 1
}
```

### 3. Import Menu from CSV
```bash
POST /api/menu/{businessId}/import
Content-Type: application/json

{
  "csv": "your csv content here...",
  "replace": false
}
```

Parameters:
- `replace: false` - Add/update items (keeps existing items)
- `replace: true` - Replace entire menu (deletes existing items first)

Response:
```json
{
  "message": "Menu imported successfully",
  "success": true,
  "categoriesCreated": 4,
  "itemsCreated": 10,
  "itemsUpdated": 0,
  "errors": []
}
```

### 4. Import from File (for testing)
```bash
POST /api/menu/{businessId}/import-file
Content-Type: application/json

{
  "filePath": "templates/menu_template.csv",
  "replace": true
}
```

### 5. Export Menu to CSV
```bash
GET /api/menu/{businessId}/export
```
Downloads the current menu as CSV file.

### 6. Get Menu (JSON)
```bash
GET /api/menu/{businessId}
```

Response:
```json
{
  "categories": [...],
  "items": [...],
  "formatted": "📋 *Our Menu*\n\n🎂 *Cakes*\n  • Black Forest - ₹400/₹750/₹1400\n..."
}
```

## Quick Setup

### Step 1: Create business in Supabase
Run this SQL:
```sql
INSERT INTO businesses (name, phone, address)
VALUES ('Your Cafe Name', 'your_whatsapp_number', 'Your Address')
RETURNING id;
```
Note the returned `id`.

### Step 2: Prepare your menu CSV
1. Download template: `GET /api/menu/template`
2. Fill in your items in Excel/Google Sheets
3. Save as CSV (UTF-8)

### Step 3: Import menu
```bash
# Using file path
curl -X POST http://localhost:3000/api/menu/YOUR_BUSINESS_ID/import-file \
  -H "Content-Type: application/json" \
  -d '{"filePath": "path/to/your/menu.csv", "replace": true}'

# Or using CSV content directly
curl -X POST http://localhost:3000/api/menu/YOUR_BUSINESS_ID/import \
  -H "Content-Type: application/json" \
  -d '{"csv": "category,item_name,...", "replace": true}'
```

### Step 4: Verify
```bash
curl http://localhost:3000/api/menu/YOUR_BUSINESS_ID
```

## Tips

1. **Category Order**: Categories appear in the order they first appear in CSV
2. **Item Names**: Keep consistent naming (AI uses these to match orders)
3. **Sizes**: For cakes, use weight (500g, 1kg, 2kg). For drinks, use size names (small, medium, large)
4. **Special Notes**: Add important info like "refrigerate", "consume within X hours", allergens
5. **Update Menu**: Import with `replace: false` to add new items without losing existing ones
