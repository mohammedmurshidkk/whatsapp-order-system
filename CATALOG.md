# WhatsApp Catalog Setup Guide

This guide outlines the steps required to set up your product catalog in Facebook Business Manager, which is necessary to display an attractive, image-based menu in your WhatsApp ordering system.

---

## **Part 1: Setup in Facebook Business Manager**

The business owner needs to complete these steps using their Facebook Business Manager account.

### Step 1: Log in to Facebook Business Manager

*   Go to [Facebook Business Manager](https://business.facebook.com/).
*   Ensure you are logged in to the account associated with your WhatsApp Business phone number.

### Step 2: Navigate to Commerce Manager

*   From the Business Manager dashboard, find and select **Commerce Manager**.
*   Alternatively, you can go directly to [Commerce Manager](https://commerce.facebook.com/manager).

### Step 3: Create a New Catalog

*   If you don't have a catalog, click **"Add Catalog"** or **"Create Catalog"**.
*   **Choose the Catalog Type:** Select **"E-commerce"**.
*   **Choose How You'll Add Items:** Select **"Upload Product Info"** (you will add items manually through the interface).
*   **Give Your Catalog a Name:** Provide a clear name (e.g., "My Restaurant Menu", "Bakery Catalog").
*   Click **"Create"** or **"Next"** to complete the catalog creation.

### Step 4: Add Items (Products) to Your Catalog

This is where you'll add your menu items. For each item, make sure to provide all the necessary details.

*   In your newly created catalog in Commerce Manager, go to **"Items"** (usually in the left-hand navigation).
*   Click **"Add Items"** > **"Add Manually"**.

For each menu item (e.g., "Chocolate Cake", "Coffee", "Candle"):

*   **Images:** Upload high-quality images for each item. This is crucial for an attractive menu!
*   **Title:** Enter the exact name of your menu item (e.g., "Chocolate Cake", "Espresso").
*   **Description:** Provide a brief, appealing description of the item.
*   **Price:** Enter the price of the item.
*   **Content ID (VERY IMPORTANT):** This is a unique identifier you create for each item. It should be a simple, URL-safe string (e.g., `chocolate-cake-1kg`, `candle-basic`, `extra-cheese`).
    *   **Recommendation:** Use a consistent naming convention (e.g., all lowercase, hyphens instead of spaces). This ID will be used by the bot to identify the item.
    *   **Crucial:** Ensure these Content IDs are unique across all your items.
*   **Availability:** Set to "In Stock".
*   **Condition:** Set to "New".
*   **Category:** Select the most appropriate category (e.g., "Desserts", "Beverages").
*   **Link (Optional):** If you have a website where customers can see the item, you can add a link here.

Repeat this process for all your menu items, including any add-ons (like "Candle", "Special Packing", "Extra Cheese") that you want to display visually.

### Step 5: Connect Your Catalog to WhatsApp

*   In Commerce Manager, go to your catalog's settings.
*   Look for **"Channels"** or **"Connected Assets"**.
*   Connect your catalog to your **WhatsApp Business Account**. This links your beautiful visual menu to your WhatsApp number.

### Step 6: Retrieve Your Catalog ID

Once your catalog is set up and items are added:

*   Go back to **Commerce Manager** and select your catalog.
*   Look in the URL of your browser. It will be something like `https://commerce.facebook.com/manager/catalogs/<YOUR_CATALOG_ID>/items`.
*   **Copy the `<YOUR_CATALOG_ID>` string.** This is a long numerical ID.

---

## **Part 2: Provide the Catalog ID to the Gemini Agent**

After completing all the steps above, please provide the **Catalog ID** you retrieved in Step 6 to the Gemini agent.

**Example:**
"My WhatsApp Catalog ID is `1234567890123456`."

Once the agent has this ID, it will proceed with modifying the application code to use your new visual menu!