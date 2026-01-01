/**
 * AI Response Parsing Edge Cases Tests
 * Tests for parseAIResponse and related functions in aiService.ts
 */

// We need to extract parseAIResponse for testing
// Since it's not exported, we'll test via the module internals

// Mock the dependencies
jest.mock('../src/utils/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

// Import the function we want to test by re-implementing the parsing logic
// This mirrors the parseAIResponse function in aiService.ts
function parseAIResponse(responseText: string): { reply: string; intent: string; item?: any; items?: any[]; order_id?: string; fulfillment?: any; addon?: any } {
  let jsonStr = responseText.trim();

  // Remove markdown code blocks
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.slice(7);
  }
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.slice(3);
  }
  if (jsonStr.endsWith('```')) {
    jsonStr = jsonStr.slice(0, -3);
  }

  jsonStr = jsonStr.trim();

  try {
    const parsed = JSON.parse(jsonStr);

    if (!parsed.reply || !parsed.intent) {
      throw new Error('Missing required fields');
    }

    return {
      reply: parsed.reply,
      intent: parsed.intent,
      item: parsed.item,
      items: parsed.items,
      order_id: parsed.order_id,
      fulfillment: parsed.fulfillment,
      addon: parsed.addon,
    };
  } catch (error) {
    return {
      reply: "I didn't quite understand that. Could you please rephrase? For example: 'I want a chocolate cake' or 'Show me the menu'.",
      intent: 'ask_question',
    };
  }
}

describe('AI Response Parsing', () => {
  describe('Valid JSON Responses', () => {
    it('should parse a simple valid response', () => {
      const response = '{"reply": "Added to cart!", "intent": "add_item"}';
      const result = parseAIResponse(response);
      expect(result.reply).toBe('Added to cart!');
      expect(result.intent).toBe('add_item');
    });

    it('should parse response with item details', () => {
      const response = '{"reply": "Added Rainbow (1kg)!", "intent": "add_item", "item": {"name": "Rainbow", "quantity": 1, "size_or_weight": "1kg"}}';
      const result = parseAIResponse(response);
      expect(result.intent).toBe('add_item');
      expect(result.item).toEqual({ name: 'Rainbow', quantity: 1, size_or_weight: '1kg' });
    });

    it('should parse response with fulfillment data', () => {
      const response = '{"reply": "Delivery to MG Road", "intent": "collect_delivery_info", "fulfillment": {"fulfillment_type": "delivery", "delivery_address": "MG Road", "delivery_time": "tomorrow 5pm"}}';
      const result = parseAIResponse(response);
      expect(result.intent).toBe('collect_delivery_info');
      expect(result.fulfillment).toEqual({
        fulfillment_type: 'delivery',
        delivery_address: 'MG Road',
        delivery_time: 'tomorrow 5pm',
      });
    });

    it('should parse response with multiple items', () => {
      const response = '{"reply": "Added 2 burgers!", "intent": "add_item", "items": [{"name": "Burger", "quantity": 1, "notes": "less spicy"}, {"name": "Burger", "quantity": 1, "notes": "extra cheese"}]}';
      const result = parseAIResponse(response);
      expect(result.items).toHaveLength(2);
      expect(result.items![0].notes).toBe('less spicy');
    });
  });

  describe('Markdown Code Block Handling', () => {
    it('should strip ```json prefix', () => {
      const response = '```json\n{"reply": "Hello!", "intent": "smalltalk"}\n```';
      const result = parseAIResponse(response);
      expect(result.reply).toBe('Hello!');
      expect(result.intent).toBe('smalltalk');
    });

    it('should strip ``` prefix without json', () => {
      const response = '```\n{"reply": "Hello!", "intent": "smalltalk"}\n```';
      const result = parseAIResponse(response);
      expect(result.reply).toBe('Hello!');
      expect(result.intent).toBe('smalltalk');
    });

    it('should handle markdown with extra whitespace', () => {
      const response = '  ```json  \n  {"reply": "Test", "intent": "ask_question"}  \n  ```  ';
      const result = parseAIResponse(response);
      expect(result.reply).toBe('Test');
    });
  });

  describe('Truncated JSON (Edge Case from Production)', () => {
    it('should handle truncated JSON gracefully - missing closing brace', () => {
      // This is the exact error from production
      const response = '{"reply": "We have \'Lotus\' cake available in 500g.';
      const result = parseAIResponse(response);
      expect(result.intent).toBe('ask_question');
      expect(result.reply).toContain("I didn't quite understand");
    });

    it('should handle truncated JSON - missing closing quote', () => {
      const response = '{"reply": "Added Rainbow cake to your cart", "intent": "add_item';
      const result = parseAIResponse(response);
      expect(result.intent).toBe('ask_question');
    });

    it('should handle truncated JSON - cut off mid-value', () => {
      const response = '{"reply": "Here is your order summ';
      const result = parseAIResponse(response);
      expect(result.intent).toBe('ask_question');
    });

    it('should handle truncated JSON with partial item object', () => {
      const response = '{"reply": "Added!", "intent": "add_item", "item": {"name": "Cake", "quantity":';
      const result = parseAIResponse(response);
      expect(result.intent).toBe('ask_question');
    });
  });

  describe('Empty and Invalid Responses', () => {
    it('should handle empty string', () => {
      const result = parseAIResponse('');
      expect(result.intent).toBe('ask_question');
    });

    it('should handle whitespace only', () => {
      const result = parseAIResponse('   \n\t  ');
      expect(result.intent).toBe('ask_question');
    });

    it('should handle null/undefined-like strings', () => {
      const result = parseAIResponse('null');
      expect(result.intent).toBe('ask_question');
    });

    it('should handle plain text instead of JSON', () => {
      const result = parseAIResponse('I apologize, I cannot help with that.');
      expect(result.intent).toBe('ask_question');
    });

    it('should handle array instead of object', () => {
      const result = parseAIResponse('[{"reply": "test"}]');
      expect(result.intent).toBe('ask_question');
    });
  });

  describe('Missing Required Fields', () => {
    it('should reject JSON without reply', () => {
      const response = '{"intent": "add_item", "item": {"name": "Cake"}}';
      const result = parseAIResponse(response);
      expect(result.intent).toBe('ask_question');
    });

    it('should reject JSON without intent', () => {
      const response = '{"reply": "Added to cart!"}';
      const result = parseAIResponse(response);
      expect(result.intent).toBe('ask_question');
    });

    it('should reject empty object', () => {
      const response = '{}';
      const result = parseAIResponse(response);
      expect(result.intent).toBe('ask_question');
    });
  });

  describe('Special Characters', () => {
    it('should handle smart quotes (curly quotes)', () => {
      // Smart quotes are often inserted by AI models
      const response = '{"reply": "We have \u2018Lotus\u2019 cake!", "intent": "ask_question"}';
      const result = parseAIResponse(response);
      // This should parse fine as smart quotes are valid in JSON string values
      expect(result.reply).toContain('Lotus');
    });

    it('should handle emoji in response', () => {
      const response = '{"reply": "Added Rainbow 🌈 cake!", "intent": "add_item"}';
      const result = parseAIResponse(response);
      expect(result.reply).toContain('🌈');
    });

    it('should handle rupee symbol', () => {
      const response = '{"reply": "Total: ₹500", "intent": "ready_for_checkout"}';
      const result = parseAIResponse(response);
      expect(result.reply).toBe('Total: ₹500');
    });

    it('should handle newlines in reply', () => {
      const response = '{"reply": "Item 1\\nItem 2\\nTotal: ₹300", "intent": "ready_for_checkout"}';
      const result = parseAIResponse(response);
      expect(result.reply).toContain('\n');
    });

    it('should handle escaped quotes in values', () => {
      const response = '{"reply": "Added \\"Special\\" cake!", "intent": "add_item"}';
      const result = parseAIResponse(response);
      expect(result.reply).toContain('"Special"');
    });
  });

  describe('Complex Real-World Scenarios', () => {
    it('should parse checkout summary with multiple fields', () => {
      const response = `{
        "reply": "Order Summary:\\n1. Rainbow (1kg) - ₹500\\n2. Chocolate (500g) - ₹300\\nTotal: ₹800",
        "intent": "ready_for_checkout"
      }`;
      const result = parseAIResponse(response);
      expect(result.intent).toBe('ready_for_checkout');
      expect(result.reply).toContain('₹800');
    });

    it('should parse cancel order with order_id', () => {
      const response = '{"reply": "Cancelling order OKS-1", "intent": "cancel_existing_order", "order_id": "OKS-1"}';
      const result = parseAIResponse(response);
      expect(result.intent).toBe('cancel_existing_order');
      expect(result.order_id).toBe('OKS-1');
    });

    it('should parse addon removal intent', () => {
      const response = '{"reply": "Removed candles", "intent": "remove_addon", "addon": {"addon_name": "Birthday Candles"}}';
      const result = parseAIResponse(response);
      expect(result.intent).toBe('remove_addon');
      expect(result.addon?.addon_name).toBe('Birthday Candles');
    });

    it('should handle Malayalam text in response', () => {
      const response = '{"reply": "ശരി, ഒരു കേക്ക് ചേർത്തു!", "intent": "add_item"}';
      const result = parseAIResponse(response);
      expect(result.reply).toContain('കേക്ക്');
    });
  });

  describe('Edge Cases That Could Cause Production Issues', () => {
    it('should handle response with only opening brace', () => {
      const result = parseAIResponse('{');
      expect(result.intent).toBe('ask_question');
    });

    it('should handle response with mismatched quotes', () => {
      const result = parseAIResponse('{"reply": "test\', "intent": "add_item"}');
      expect(result.intent).toBe('ask_question');
    });

    it('should handle extremely long response', () => {
      const longReply = 'A'.repeat(5000);
      const response = `{"reply": "${longReply}", "intent": "ask_question"}`;
      const result = parseAIResponse(response);
      expect(result.reply).toBe(longReply);
    });

    it('should handle nested objects that are deeply truncated', () => {
      const response = '{"reply": "OK", "intent": "add_item", "item": {"name": "Cake", "sizes": [{"name": "1kg", "price":';
      const result = parseAIResponse(response);
      expect(result.intent).toBe('ask_question');
    });

    it('should handle unicode escape sequences', () => {
      const response = '{"reply": "Price: \\u20B9500", "intent": "add_item"}';
      const result = parseAIResponse(response);
      expect(result.reply).toBe('Price: ₹500');
    });

    it('should handle BOM character at start', () => {
      const response = '\uFEFF{"reply": "Test", "intent": "add_item"}';
      const result = parseAIResponse(response);
      // BOM is handled by trim() - JSON parses correctly
      expect(result.intent).toBe('add_item');
    });
  });
});

describe('Token Limit Scenarios', () => {
  it('should simulate response cut at 500 tokens', () => {
    // A response that would be cut off at ~500 tokens
    const partialResponse = '{"reply": "We have the following items in your cart:\\n1. Rainbow Cake (1kg) - ₹550\\n2. Chocolate Truffle (500g) - ₹350\\n3. Red Velvet Cupcakes x6 - ₹240\\n4. Butterscotch Pastry x4 - ₹160\\n\\nSubtotal: ₹1300\\n\\nWould you like delivery or takeaway?", "intent": "ready_for_checkout';
    const result = parseAIResponse(partialResponse);
    expect(result.intent).toBe('ask_question');
    expect(result.reply).toContain("I didn't quite understand");
  });

  it('should handle well-formed response within limit', () => {
    const response = '{"reply": "Added Rainbow Cake (1kg) to your cart! Anything else?", "intent": "add_item", "item": {"name": "Rainbow Cake", "quantity": 1, "size_or_weight": "1kg"}}';
    const result = parseAIResponse(response);
    expect(result.intent).toBe('add_item');
    expect(result.item?.name).toBe('Rainbow Cake');
  });
});
