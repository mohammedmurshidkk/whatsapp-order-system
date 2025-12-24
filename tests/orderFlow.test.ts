/**
 * Order Flow Tests
 * Tests all ordering scenarios using mock AI service
 */

import * as fs from 'fs';
import * as path from 'path';
import { MockAIService, resetMockAIService } from './mocks/mockAIService';

// Load test scenarios
const scenariosPath = path.join(__dirname, 'scenarios', 'order-flows.json');
const scenariosData = JSON.parse(fs.readFileSync(scenariosPath, 'utf-8'));

interface TestStep {
  user: string;
  expect_intent: string;
  expect_reply_contains?: string;
  expect_cart?: string[];
  expect_custom_text?: string;
  expect_addon?: string;
  expect_order_id?: string;
  expect_quantity?: number;
  expect_fulfillment?: {
    delivery_address?: string;
    delivery_time?: string;
    pickup_outlet_id?: string;
  };
}

interface TestScenario {
  id: string;
  name: string;
  description: string;
  steps: TestStep[];
  setup?: {
    cart?: string[];
    has_custom_text?: boolean;
    addons?: string[];
    fulfillment_type?: string;
  };
}

describe('Order Flow Tests', () => {
  // Generate tests from scenarios - run each scenario as a single test with all steps
  const scenarios: TestScenario[] = scenariosData.scenarios;

  scenarios.forEach((scenario) => {
    it(`${scenario.name}`, () => {
      // Create fresh mock for each scenario
      resetMockAIService();
      const mockAI = new MockAIService(['Black Forest', 'Burger', 'Rainbow', 'Chocolate', 'Vanilla']);

      // Apply setup if provided
      if (scenario.setup) {
        if (scenario.setup.cart) {
          mockAI.setContext({ cartItems: [...scenario.setup.cart] });
        }
        if (scenario.setup.fulfillment_type) {
          mockAI.setContext({ hasFulfillmentType: true });
        }
      }

      // Run all steps sequentially with same mock instance
      scenario.steps.forEach((step, index) => {
        const response = mockAI.processMessage(step.user);

        // Check intent
        expect(response.intent).toBe(step.expect_intent);

        // Check reply contains
        if (step.expect_reply_contains) {
          expect(response.reply.toLowerCase()).toContain(step.expect_reply_contains.toLowerCase());
        }

        // Check cart state
        if (step.expect_cart) {
          const context = mockAI.getContext();
          expect(context.cartItems).toEqual(step.expect_cart);
        }

        // Check custom text
        if (step.expect_custom_text) {
          expect(response.customText).toBe(step.expect_custom_text);
        }

        // Check addon
        if (step.expect_addon) {
          expect(response.addon?.addon_name?.toLowerCase()).toContain(step.expect_addon.toLowerCase());
        }

        // Check order ID
        if (step.expect_order_id) {
          expect(response.order_id).toBe(step.expect_order_id);
        }

        // Check quantity
        if (step.expect_quantity) {
          expect(response.item?.quantity).toBe(step.expect_quantity);
        }

        // Check fulfillment
        if (step.expect_fulfillment) {
          if (step.expect_fulfillment.delivery_address) {
            expect(response.fulfillment?.delivery_address).toBe(step.expect_fulfillment.delivery_address);
          }
          if (step.expect_fulfillment.delivery_time) {
            expect(response.fulfillment?.delivery_time).toBe(step.expect_fulfillment.delivery_time);
          }
        }
      });
    });
  });
});

// Additional edge case tests
describe('Edge Cases', () => {
  let mockAI: MockAIService;

  beforeEach(() => {
    resetMockAIService();
    mockAI = new MockAIService();
  });

  describe('Item Size Handling', () => {
    it('should ask for size when item has sizes', () => {
      const response = mockAI.processMessage('burger');
      expect(response.intent).toBe('ask_question');
      expect(response.reply.toLowerCase()).toContain('size');
    });

    it('should add item directly when size is specified', () => {
      const response = mockAI.processMessage('Burger large');
      expect(response.intent).toBe('add_item');
      expect(response.item?.size_or_weight?.toLowerCase()).toBe('large');
    });

    it('should handle size as separate message', () => {
      mockAI.processMessage('burger'); // First ask for item
      const response = mockAI.processMessage('large');
      expect(response.intent).toBe('add_item');
    });
  });

  describe('Custom Text Flow', () => {
    beforeEach(() => {
      mockAI.setContext({ cartItems: ['Black Forest (1kg)'] });
    });

    it('should handle custom text with message', () => {
      const response = mockAI.processMessage('Change the text to Happy Birthday');
      expect(response.intent).toBe('modify_custom_text');
      expect(response.customText).toBe('Happy Birthday');
    });

    it('should ask for text when not provided', () => {
      const response = mockAI.processMessage('Add writing on cake');
      expect(response.intent).toBe('modify_custom_text');
      expect(response.reply.toLowerCase()).toContain('message');
    });

    it('should handle remove text request', () => {
      const response = mockAI.processMessage('Remove the writing');
      expect(response.intent).toBe('remove_custom_text');
    });

    it('should handle pending custom text response', () => {
      // First ask for custom text
      mockAI.processMessage('Add writing on cake');
      // Then provide the text
      const response = mockAI.processMessage('Happy Anniversary');
      expect(response.intent).toBe('modify_custom_text');
      expect(response.customText).toBe('Happy Anniversary');
    });
  });

  describe('Fulfillment Flow', () => {
    beforeEach(() => {
      mockAI.setContext({ cartItems: ['Burger (Large)'] });
    });

    it('should ask for address on delivery selection', () => {
      const response = mockAI.processMessage('Delivery');
      expect(response.intent).toBe('ask_question');
      expect(response.fulfillment?.fulfillment_type).toBe('delivery');
    });

    it('should ask for time when only address provided', () => {
      mockAI.processMessage('Delivery'); // Set fulfillment type
      const response = mockAI.processMessage('MG Road');
      expect(response.intent).toBe('ask_question');
      expect(response.reply.toLowerCase()).toContain('time');
    });

    it('should collect both address and time together', () => {
      mockAI.processMessage('Delivery'); // Set fulfillment type
      const response = mockAI.processMessage('MG Road, tomorrow 5pm');
      expect(response.intent).toBe('collect_delivery_info');
      expect(response.fulfillment?.delivery_address).toBe('MG Road');
    });
  });

  describe('Order Confirmation', () => {
    it('should confirm order when fulfillment is complete', () => {
      mockAI.setContext({
        cartItems: ['Burger (Large)'],
        hasFulfillmentType: true,
        hasDeliveryAddress: true,
        hasTime: true,
      });
      const response = mockAI.processMessage('Yes');
      expect(response.intent).toBe('confirm_order');
    });

    it('should not confirm when fulfillment is incomplete', () => {
      mockAI.setContext({
        cartItems: ['Burger (Large)'],
        hasFulfillmentType: false,
      });
      const response = mockAI.processMessage('Yes');
      expect(response.intent).toBe('ask_question');
    });
  });

  describe('Order Management', () => {
    it('should handle cancel with order ID', () => {
      const response = mockAI.processMessage('Cancel order UPS-123');
      expect(response.intent).toBe('cancel_existing_order');
      expect(response.order_id).toBe('UPS-123');
    });

    it('should ask for order ID when not provided', () => {
      const response = mockAI.processMessage('Cancel my order');
      expect(response.intent).toBe('cancel_existing_order');
      expect(response.reply.toLowerCase()).toContain('order number');
    });

    it('should handle status check with order ID', () => {
      const response = mockAI.processMessage('Status of UPS-456');
      expect(response.intent).toBe('check_order_status');
      expect(response.order_id).toBe('UPS-456');
    });

    it('should handle where is my order', () => {
      const response = mockAI.processMessage('Where is my order');
      expect(response.intent).toBe('check_order_status');
    });
  });

  describe('Addon Management', () => {
    beforeEach(() => {
      mockAI.setContext({ cartItems: ['Black Forest (1kg)'] });
    });

    it('should remove candle addon', () => {
      const response = mockAI.processMessage('Remove candle');
      expect(response.intent).toBe('remove_addon');
      expect(response.addon?.addon_name).toBe('candle');
    });

    it('should remove silver coat addon', () => {
      const response = mockAI.processMessage('No silver coat');
      expect(response.intent).toBe('remove_addon');
      expect(response.addon?.addon_name).toBe('silver coat');
    });
  });

  describe('Malayalam/Manglish Support', () => {
    it('should understand "mathi" as checkout', () => {
      mockAI.setContext({ cartItems: ['Burger (Large)'] });
      const response = mockAI.processMessage('mathi');
      expect(response.intent).toBe('ready_for_checkout');
    });

    it('should understand "sheri" as confirmation', () => {
      mockAI.setContext({
        cartItems: ['Burger (Large)'],
        hasFulfillmentType: true,
        hasDeliveryAddress: true,
      });
      const response = mockAI.processMessage('sheri');
      expect(response.intent).toBe('confirm_order');
    });

    it('should understand "nale" as tomorrow', () => {
      mockAI.setContext({ hasFulfillmentType: true });
      const response = mockAI.processMessage('nale 5pm');
      expect(response.intent).toBe('collect_delivery_info');
      expect(response.fulfillment?.delivery_time).toContain('nale');
    });
  });
});

// Regression tests for known issues
describe('Regression Tests', () => {
  let mockAI: MockAIService;

  beforeEach(() => {
    resetMockAIService();
    mockAI = new MockAIService();
  });

  it('should not add "okay" as custom text when user says okay', () => {
    mockAI.setContext({ cartItems: ['Burger (Large)'] });
    const response = mockAI.processMessage('Okay');
    // Should not be modify_custom_text
    expect(response.intent).not.toBe('modify_custom_text');
  });

  it('should not add "delivery" as custom text when user selects delivery', () => {
    mockAI.setContext({ cartItems: ['Black Forest (1kg)'] });
    const response = mockAI.processMessage('Delivery');
    expect(response.intent).toBe('ask_question');
    expect(response.fulfillment?.fulfillment_type).toBe('delivery');
    expect(response.customText).toBeUndefined();
  });

  it('should handle checkout with empty cart gracefully', () => {
    const response = mockAI.processMessage("That's all");
    expect(response.intent).toBe('ask_question');
    expect(response.reply.toLowerCase()).toContain('empty');
  });

  it('should not repeat custom text question (fix for infinite loop)', () => {
    mockAI.setContext({ cartItems: ['Black Forest (1kg)'] });

    // First request asks for text
    const response1 = mockAI.processMessage('Add writing on cake');
    expect(response1.intent).toBe('modify_custom_text');

    // Second message should save the text, not ask again
    const response2 = mockAI.processMessage('Happy Anniversary');
    expect(response2.intent).toBe('modify_custom_text');
    expect(response2.customText).toBe('Happy Anniversary');
  });

  it('should handle full order flow', () => {
    // Complete order flow test
    mockAI.processMessage('Hi');
    mockAI.processMessage('Burger');
    mockAI.processMessage('Large');

    const checkoutResponse = mockAI.processMessage('Done');
    expect(checkoutResponse.intent).toBe('ready_for_checkout');

    mockAI.processMessage('Delivery');
    mockAI.processMessage('MG Road, tomorrow 5pm');

    const confirmResponse = mockAI.processMessage('Yes');
    expect(confirmResponse.intent).toBe('confirm_order');
  });
});
