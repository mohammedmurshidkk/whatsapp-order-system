/**
 * Integration Test Runner
 * Tests actual webhookController flow using /test/message endpoint
 *
 * Usage:
 *   npx ts-node tests/integration/testRunner.ts
 *
 * Prerequisites:
 *   - Server running on localhost:3000
 *   - Valid businessId in .env or pass as argument
 */

import * as fs from 'fs';
import * as path from 'path';

interface TestStep {
  user: string;
  expect_intent?: string;
  expect_reply_contains?: string[];
  expect_cart_count?: number;
  delay_ms?: number;
}

interface TestScenario {
  id: string;
  name: string;
  description: string;
  steps: TestStep[];
  cleanup?: boolean; // Should we clear cart after?
}

interface TestResult {
  scenario: string;
  step: number;
  passed: boolean;
  message: string;
  userInput: string;
  response?: any;
}

// Configuration
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8080';
const BUSINESS_ID = process.env.TEST_BUSINESS_ID || '';
const TEST_PHONE = process.env.TEST_PHONE || '15551401965';

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

async function sendMessage(phone: string, message: string, businessId: string): Promise<any> {
  const response = await fetch(`${BASE_URL}/test/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, message, businessId }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runScenario(scenario: TestScenario, businessId: string): Promise<TestResult[]> {
  const results: TestResult[] = [];
  // Use exact phone number - must be in WhatsApp allowed list
  const phone = TEST_PHONE;

  console.log(`\n${colors.cyan}━━━ ${scenario.name} ━━━${colors.reset}`);
  console.log(`${colors.dim}${scenario.description}${colors.reset}\n`);

  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i];
    const stepNum = i + 1;

    // Delay between messages (simulates real user)
    if (step.delay_ms) {
      await sleep(step.delay_ms);
    } else if (i > 0) {
      await sleep(500); // Default 500ms between messages
    }

    try {
      console.log(`  ${colors.dim}[${stepNum}/${scenario.steps.length}]${colors.reset} User: "${step.user}"`);

      const response = await sendMessage(phone, step.user, businessId);
      const passed = validateResponse(step, response);

      if (passed) {
        console.log(`      ${colors.green}✓${colors.reset} ${getPassMessage(step, response)}`);
      } else {
        console.log(`      ${colors.red}✗${colors.reset} ${getFailMessage(step, response)}`);
      }

      results.push({
        scenario: scenario.id,
        step: stepNum,
        passed,
        message: passed ? 'OK' : getFailMessage(step, response),
        userInput: step.user,
        response,
      });

      // Stop scenario on first failure
      if (!passed) {
        console.log(`      ${colors.yellow}⚠ Stopping scenario due to failure${colors.reset}`);
        break;
      }
    } catch (error: any) {
      console.log(`      ${colors.red}✗ Error: ${error.message}${colors.reset}`);
      results.push({
        scenario: scenario.id,
        step: stepNum,
        passed: false,
        message: `Error: ${error.message}`,
        userInput: step.user,
      });
      break;
    }
  }

  return results;
}

function validateResponse(step: TestStep, response: any): boolean {
  // Check intent if specified
  if (step.expect_intent && response.intent !== step.expect_intent) {
    return false;
  }

  // Check reply contains phrases
  if (step.expect_reply_contains) {
    const reply = (response.reply || response.message || '').toLowerCase();
    for (const phrase of step.expect_reply_contains) {
      if (!reply.includes(phrase.toLowerCase())) {
        return false;
      }
    }
  }

  // Check cart count if specified
  if (step.expect_cart_count !== undefined) {
    const cartCount = response.cart_count ?? response.items?.length ?? 0;
    if (cartCount !== step.expect_cart_count) {
      return false;
    }
  }

  return true;
}

function getPassMessage(step: TestStep, response: any): string {
  const parts: string[] = [];

  if (step.expect_intent) {
    parts.push(`intent=${response.intent}`);
  }

  if (step.expect_reply_contains) {
    parts.push(`reply contains expected phrases`);
  }

  return parts.join(', ') || 'OK';
}

function getFailMessage(step: TestStep, response: any): string {
  const parts: string[] = [];

  if (step.expect_intent && response.intent !== step.expect_intent) {
    parts.push(`expected intent "${step.expect_intent}", got "${response.intent}"`);
  }

  if (step.expect_reply_contains) {
    const reply = (response.reply || response.message || '').toLowerCase();
    const missing = step.expect_reply_contains.filter(p => !reply.includes(p.toLowerCase()));
    if (missing.length > 0) {
      parts.push(`reply missing: ${missing.join(', ')}`);
    }
  }

  return parts.join('; ') || 'Validation failed';
}

// Load scenarios from JSON file or define inline
function loadScenarios(): TestScenario[] {
  const scenariosPath = path.join(__dirname, 'scenarios.json');

  if (fs.existsSync(scenariosPath)) {
    return JSON.parse(fs.readFileSync(scenariosPath, 'utf-8')).scenarios;
  }

  // Default scenarios for quick testing
  return [
    {
      id: 'basic_order',
      name: 'Basic Order Flow',
      description: 'Customer orders an item and checks out',
      steps: [
        { user: 'Hi', expect_reply_contains: ['order', 'menu'] },
        { user: 'show menu', expect_reply_contains: ['menu'] },
      ],
    },
    {
      id: 'health_check',
      name: 'Server Health Check',
      description: 'Verify server responds to messages',
      steps: [
        { user: 'Hello', expect_reply_contains: [] }, // Just check it responds
      ],
    },
  ];
}

async function main() {
  console.log(`\n${colors.cyan}╔════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║     Integration Test Runner            ║${colors.reset}`);
  console.log(`${colors.cyan}╚════════════════════════════════════════╝${colors.reset}`);
  console.log(`\n${colors.dim}Server: ${BASE_URL}${colors.reset}`);

  // Validate business ID
  let businessId = BUSINESS_ID;
  if (!businessId) {
    console.error(`\n${colors.red}Error: TEST_BUSINESS_ID not set${colors.reset}`);
    console.log(`\nSet it in your .env file or pass as environment variable:`);
    console.log(`  TEST_BUSINESS_ID=your-uuid npx ts-node tests/integration/testRunner.ts\n`);
    process.exit(1);
  }

  console.log(`${colors.dim}Business ID: ${businessId}${colors.reset}\n`);

  // Check server is running
  try {
    const healthCheck = await fetch(`${BASE_URL}/health`);
    if (!healthCheck.ok) {
      throw new Error('Health check failed');
    }
    console.log(`${colors.green}✓ Server is running${colors.reset}\n`);
  } catch (error) {
    console.error(`\n${colors.red}Error: Cannot connect to server at ${BASE_URL}${colors.reset}`);
    console.log(`Make sure the server is running: npm run dev\n`);
    process.exit(1);
  }

  const scenarios = loadScenarios();
  const allResults: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  for (const scenario of scenarios) {
    const results = await runScenario(scenario, businessId);
    allResults.push(...results);

    const scenarioPassed = results.every(r => r.passed);
    if (scenarioPassed) {
      passed++;
    } else {
      failed++;
    }
  }

  // Summary
  console.log(`\n${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.cyan}Summary${colors.reset}`);
  console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`  Total Scenarios: ${scenarios.length}`);
  console.log(`  ${colors.green}Passed: ${passed}${colors.reset}`);
  console.log(`  ${colors.red}Failed: ${failed}${colors.reset}`);

  if (failed > 0) {
    console.log(`\n${colors.yellow}Failed Steps:${colors.reset}`);
    allResults
      .filter(r => !r.passed)
      .forEach(r => {
        console.log(`  - ${r.scenario} step ${r.step}: "${r.userInput}"`);
        console.log(`    ${colors.dim}${r.message}${colors.reset}`);
      });
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
