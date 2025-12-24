/**
 * Jest Setup File
 * Runs before all tests
 */

// Extend Jest matchers if needed
expect.extend({
  toContainIntent(received: any, expected: string) {
    const pass = received.intent === expected;
    if (pass) {
      return {
        message: () => `expected intent not to be ${expected}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected intent to be ${expected}, but got ${received.intent}`,
        pass: false,
      };
    }
  },
});

// Global test timeout
jest.setTimeout(10000);

// Mock console.log in tests to reduce noise
// Uncomment if you want cleaner test output
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
// };

// Add custom matchers type declaration
declare global {
  namespace jest {
    interface Matchers<R> {
      toContainIntent(expected: string): R;
    }
  }
}

export {};
