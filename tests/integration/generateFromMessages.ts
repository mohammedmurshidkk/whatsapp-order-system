/**
 * Generate Test Scenarios from Real Messages
 *
 * Fetches actual conversations from Supabase messages table
 * and converts them into test scenarios.
 *
 * Usage:
 *   npx ts-node tests/integration/generateFromMessages.ts
 *   npx ts-node tests/integration/generateFromMessages.ts --limit 5
 *   npx ts-node tests/integration/generateFromMessages.ts --session SESSION_ID
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

interface Message {
  id: string;
  session_id: string;
  direction: 'outbound' | 'outgoing'; // outbound = customer, outgoing = bot
  content: string;
  created_at: string;
}

interface TestStep {
  user: string;
  expect_reply_contains: string[];
}

interface TestScenario {
  id: string;
  name: string;
  description: string;
  steps: TestStep[];
  source_session_id: string;
}

async function getCompletedSessions(limit: number = 10): Promise<string[]> {
  // Get sessions that resulted in confirmed orders (successful flows)
  const { data: sessions, error } = await supabase
    .from('sessions')
    .select('id, created_at')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching sessions:', error);
    return [];
  }

  return sessions?.map(s => s.id) || [];
}

async function getSessionMessages(sessionId: string): Promise<Message[]> {
  const { data: messages, error } = await supabase
    .from('messages')
    .select('id, session_id, direction, content, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching messages:', error);
    return [];
  }

  return messages || [];
}

function messagesToScenario(messages: Message[], sessionId: string, index: number): TestScenario | null {
  const steps: TestStep[] = [];

  // Group consecutive messages
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];

    if (msg.direction === 'outbound') {
      // User message (outbound = customer sent to us)
      const userMessage = msg.content;

      // Look for the next outgoing message(s) as expected response
      const expectedPhrases: string[] = [];
      let j = i + 1;
      while (j < messages.length && messages[j].direction === 'outgoing') {
        // Extract key words from bot response (first 3 significant words)
        const words = messages[j].content
          .toLowerCase()
          .replace(/[^\w\s]/g, '')
          .split(/\s+/)
          .filter(w => w.length > 3)
          .slice(0, 2);
        expectedPhrases.push(...words);
        j++;
      }

      steps.push({
        user: userMessage,
        expect_reply_contains: [...new Set(expectedPhrases)].slice(0, 2), // Max 2 unique phrases
      });

      i = j;
    } else {
      i++;
    }
  }

  if (steps.length === 0) {
    return null;
  }

  // Limit steps to keep scenarios manageable
  const limitedSteps = steps.slice(0, 10);

  return {
    id: `real_session_${index + 1}`,
    name: `Real Conversation #${index + 1}`,
    description: `Actual customer conversation from session ${sessionId.slice(0, 8)}...`,
    steps: limitedSteps,
    source_session_id: sessionId,
  };
}

async function generateScenarios(options: { limit?: number; sessionId?: string }) {
  console.log('\n📊 Generating test scenarios from real messages...\n');

  let sessionIds: string[];

  if (options.sessionId) {
    sessionIds = [options.sessionId];
  } else {
    sessionIds = await getCompletedSessions(options.limit || 5);
  }

  if (sessionIds.length === 0) {
    console.log('❌ No completed sessions found.');
    console.log('   Make sure you have sessions with status="completed" in your database.\n');
    return;
  }

  console.log(`Found ${sessionIds.length} completed session(s)\n`);

  const scenarios: TestScenario[] = [];

  for (let i = 0; i < sessionIds.length; i++) {
    const sessionId = sessionIds[i];
    console.log(`Processing session ${i + 1}/${sessionIds.length}: ${sessionId.slice(0, 8)}...`);

    const messages = await getSessionMessages(sessionId);
    console.log(`  → ${messages.length} messages found`);

    if (messages.length > 0) {
      const scenario = messagesToScenario(messages, sessionId, i);
      if (scenario) {
        scenarios.push(scenario);
        console.log(`  → Generated scenario with ${scenario.steps.length} steps`);
      }
    }
  }

  if (scenarios.length === 0) {
    console.log('\n❌ No scenarios could be generated from the messages.');
    return;
  }

  // Write to file
  const outputPath = path.join(__dirname, 'scenarios-real.json');
  const output = {
    _comment: 'Auto-generated from real Supabase messages. Review and adjust expect_reply_contains as needed.',
    generated_at: new Date().toISOString(),
    scenarios,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`\n✅ Generated ${scenarios.length} scenario(s)`);
  console.log(`   Saved to: ${outputPath}`);
  console.log(`\n📝 Next steps:`);
  console.log(`   1. Review scenarios-real.json`);
  console.log(`   2. Adjust expect_reply_contains for accuracy`);
  console.log(`   3. Copy desired scenarios to scenarios.json`);
  console.log(`   4. Run: npm run test:integration\n`);
}

// Parse command line arguments
const args = process.argv.slice(2);
let limit = 5;
let sessionId: string | undefined;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) {
    limit = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--session' && args[i + 1]) {
    sessionId = args[i + 1];
    i++;
  }
}

generateScenarios({ limit, sessionId }).catch(console.error);
