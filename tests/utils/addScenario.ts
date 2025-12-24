/**
 * Add Scenario CLI Tool
 * Easily add new test scenarios from chat files or manually
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const SCENARIOS_FILE = path.join(__dirname, '..', 'scenarios', 'order-flows.json');

interface TestStep {
  user: string;
  expect_intent: string;
  expect_reply_contains?: string;
  expect_cart?: string[];
  expect_custom_text?: string;
}

interface TestScenario {
  id: string;
  name: string;
  description: string;
  steps: TestStep[];
  setup?: any;
}

interface ScenariosFile {
  scenarios: TestScenario[];
}

function loadScenarios(): ScenariosFile {
  if (fs.existsSync(SCENARIOS_FILE)) {
    return JSON.parse(fs.readFileSync(SCENARIOS_FILE, 'utf-8'));
  }
  return { scenarios: [] };
}

function saveScenarios(data: ScenariosFile): void {
  fs.writeFileSync(SCENARIOS_FILE, JSON.stringify(data, null, 2));
}

function generateId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

async function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function addScenarioInteractive(): Promise<void> {
  console.log('\n📝 Add New Test Scenario\n');

  const name = await promptUser('Scenario name: ');
  const description = await promptUser('Description: ');

  const steps: TestStep[] = [];
  console.log('\nAdd steps (type "done" to finish):\n');

  let stepNum = 1;
  while (true) {
    const userMsg = await promptUser(`Step ${stepNum} - User message: `);
    if (userMsg.toLowerCase() === 'done') break;

    const intent = await promptUser(`Step ${stepNum} - Expected intent: `);
    const replyContains = await promptUser(`Step ${stepNum} - Reply should contain (optional): `);

    const step: TestStep = {
      user: userMsg,
      expect_intent: intent,
    };

    if (replyContains) {
      step.expect_reply_contains = replyContains;
    }

    steps.push(step);
    stepNum++;
  }

  const scenario: TestScenario = {
    id: generateId(name),
    name,
    description,
    steps,
  };

  const data = loadScenarios();
  data.scenarios.push(scenario);
  saveScenarios(data);

  console.log(`\n✅ Added scenario "${name}" with ${steps.length} steps`);
  console.log(`   ID: ${scenario.id}`);
}

function addScenarioFromJson(jsonStr: string): void {
  try {
    const scenario = JSON.parse(jsonStr) as TestScenario;

    if (!scenario.id) {
      scenario.id = generateId(scenario.name || 'unnamed');
    }

    const data = loadScenarios();

    // Check for duplicate
    const existing = data.scenarios.findIndex(s => s.id === scenario.id);
    if (existing >= 0) {
      data.scenarios[existing] = scenario;
      console.log(`✅ Updated scenario: ${scenario.id}`);
    } else {
      data.scenarios.push(scenario);
      console.log(`✅ Added scenario: ${scenario.id}`);
    }

    saveScenarios(data);
  } catch (error) {
    console.error('❌ Invalid JSON:', error);
  }
}

function listScenarios(): void {
  const data = loadScenarios();
  console.log(`\n📋 Test Scenarios (${data.scenarios.length} total)\n`);

  data.scenarios.forEach((scenario, i) => {
    console.log(`${i + 1}. ${scenario.name}`);
    console.log(`   ID: ${scenario.id}`);
    console.log(`   Steps: ${scenario.steps.length}`);
    console.log(`   Description: ${scenario.description}`);
    console.log('');
  });
}

function removeScenario(id: string): void {
  const data = loadScenarios();
  const index = data.scenarios.findIndex(s => s.id === id);

  if (index >= 0) {
    const removed = data.scenarios.splice(index, 1)[0];
    saveScenarios(data);
    console.log(`✅ Removed scenario: ${removed.name}`);
  } else {
    console.log(`❌ Scenario not found: ${id}`);
  }
}

// CLI
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'add':
    if (args[1]) {
      // Add from JSON string
      addScenarioFromJson(args[1]);
    } else {
      // Interactive mode
      addScenarioInteractive().catch(console.error);
    }
    break;

  case 'list':
    listScenarios();
    break;

  case 'remove':
    if (args[1]) {
      removeScenario(args[1]);
    } else {
      console.log('Usage: ts-node addScenario.ts remove <scenario-id>');
    }
    break;

  default:
    console.log(`
Test Scenario Manager

Usage:
  ts-node addScenario.ts add              # Interactive mode
  ts-node addScenario.ts add '<json>'     # Add from JSON
  ts-node addScenario.ts list             # List all scenarios
  ts-node addScenario.ts remove <id>      # Remove a scenario

Example JSON:
  {
    "name": "My Test",
    "description": "Test description",
    "steps": [
      { "user": "Hi", "expect_intent": "ask_question" },
      { "user": "Burger large", "expect_intent": "add_item" }
    ]
  }
`);
}
