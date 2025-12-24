/**
 * Chat Parser Utility
 * Parses WhatsApp chat export files into test scenarios
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ChatMessage {
  timestamp: string;
  sender: 'user' | 'bot';
  message: string;
}

export interface TestScenario {
  name: string;
  description: string;
  messages: ChatMessage[];
  // Extracted from conversation
  expectedFlow: string[]; // e.g., ['add_item', 'ready_for_checkout', 'confirm_order']
}

export interface ConversationSession {
  startIndex: number;
  endIndex: number;
  messages: ChatMessage[];
}

// Bot phone number patterns to identify bot messages
const BOT_PATTERNS = [
  /^\+1 \(555\) \d{3}-\d{4}$/,  // +1 (555) 145-4496
  /^Bot$/i,
  /^Assistant$/i,
];

/**
 * Parse a single line from chat export
 * Format: [HH:MM, DD/MM/YYYY] Sender: Message
 */
function parseChatLine(line: string): ChatMessage | null {
  // Match: [20:11, 17/12/2025] Sender: Message
  const match = line.match(/^\[(\d{2}:\d{2}, \d{2}\/\d{2}\/\d{4})\]\s+(.+?):\s*(.*)$/);

  if (!match) return null;

  const [, timestamp, sender, message] = match;

  // Determine if sender is bot or user
  const isBot = BOT_PATTERNS.some(pattern => pattern.test(sender.trim()));

  return {
    timestamp,
    sender: isBot ? 'bot' : 'user',
    message: message.trim(),
  };
}

/**
 * Parse multi-line messages (bot responses often span multiple lines)
 */
function parseMultiLineMessages(lines: string[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let currentMessage: ChatMessage | null = null;

  for (const line of lines) {
    const parsed = parseChatLine(line);

    if (parsed) {
      // New message starts
      if (currentMessage) {
        messages.push(currentMessage);
      }
      currentMessage = parsed;
    } else if (currentMessage && line.trim()) {
      // Continuation of previous message
      currentMessage.message += '\n' + line.trim();
    }
  }

  // Don't forget the last message
  if (currentMessage) {
    messages.push(currentMessage);
  }

  return messages;
}

/**
 * Split messages into conversation sessions (separated by "Hi" or greeting)
 */
function splitIntoSessions(messages: ChatMessage[]): ConversationSession[] {
  const sessions: ConversationSession[] = [];
  let sessionStart = 0;

  const greetings = ['hi', 'hello', 'hey', 'hlo', 'hii'];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Check if this is a new session (user greeting after a completed order or timeout)
    if (msg.sender === 'user' && greetings.includes(msg.message.toLowerCase().trim())) {
      // Check if previous message was order confirmation or it's the start
      if (i > 0) {
        const prevBotMsg = messages.slice(0, i).reverse().find(m => m.sender === 'bot');
        if (prevBotMsg && (
          prevBotMsg.message.includes('Order confirmed') ||
          prevBotMsg.message.includes('Order #:') ||
          prevBotMsg.message.includes('Thank you for your order')
        )) {
          // End previous session
          if (i > sessionStart) {
            sessions.push({
              startIndex: sessionStart,
              endIndex: i - 1,
              messages: messages.slice(sessionStart, i),
            });
          }
          sessionStart = i;
        }
      }
    }
  }

  // Add the last session
  if (sessionStart < messages.length) {
    sessions.push({
      startIndex: sessionStart,
      endIndex: messages.length - 1,
      messages: messages.slice(sessionStart),
    });
  }

  return sessions;
}

/**
 * Infer expected intents from bot responses
 */
function inferIntentsFromSession(session: ConversationSession): string[] {
  const intents: string[] = [];

  for (const msg of session.messages) {
    if (msg.sender !== 'bot') continue;

    const text = msg.message.toLowerCase();

    if (text.includes('added') && text.includes('to your cart')) {
      intents.push('add_item');
    } else if (text.includes('order summary') && text.includes('how would you like to receive')) {
      intents.push('ready_for_checkout');
    } else if (text.includes('what size') || text.includes('which size')) {
      intents.push('ask_question:size');
    } else if (text.includes('delivery address') || text.includes('share your delivery')) {
      intents.push('ask_question:delivery');
    } else if (text.includes('pickup location') || text.includes('select your preferred pickup')) {
      intents.push('ask_question:pickup');
    } else if (text.includes('what time') || text.includes('when would you like')) {
      intents.push('ask_question:time');
    } else if (text.includes('order confirmed') || text.includes('order #:')) {
      intents.push('confirm_order');
    } else if (text.includes('our menu')) {
      intents.push('show_menu');
    } else if (text.includes('what would you like the new message')) {
      intents.push('modify_custom_text:ask');
    } else if (text.includes('updated the') && text.includes('message')) {
      intents.push('modify_custom_text:done');
    } else if (text.includes('removed the text')) {
      intents.push('remove_custom_text');
    }
  }

  return intents;
}

/**
 * Parse a chat file and return test scenarios
 */
export function parseChatFile(filePath: string): TestScenario[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  const messages = parseMultiLineMessages(lines);
  const sessions = splitIntoSessions(messages);

  const fileName = path.basename(filePath, path.extname(filePath));

  return sessions.map((session, index) => ({
    name: `${fileName}_session_${index + 1}`,
    description: `Session ${index + 1} from ${fileName}`,
    messages: session.messages,
    expectedFlow: inferIntentsFromSession(session),
  }));
}

/**
 * Parse all chat files in a directory
 */
export function parseAllChatFiles(dirPath: string): TestScenario[] {
  const scenarios: TestScenario[] = [];

  const files = fs.readdirSync(dirPath).filter(f =>
    f.endsWith('.md') || f.endsWith('.txt')
  );

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const fileScenarios = parseChatFile(filePath);
    scenarios.push(...fileScenarios);
  }

  return scenarios;
}

/**
 * Convert scenarios to JSON format for easier editing
 */
export function scenariosToJson(scenarios: TestScenario[]): string {
  return JSON.stringify(scenarios, null, 2);
}

/**
 * Generate test cases from scenarios
 */
export function generateTestCases(scenarios: TestScenario[]): string {
  let output = '// Auto-generated test cases from chat history\n\n';

  for (const scenario of scenarios) {
    output += `describe('${scenario.name}', () => {\n`;
    output += `  // ${scenario.description}\n`;
    output += `  // Expected flow: ${scenario.expectedFlow.join(' -> ')}\n\n`;

    const userMessages = scenario.messages.filter(m => m.sender === 'user');

    for (let i = 0; i < userMessages.length; i++) {
      const msg = userMessages[i];
      output += `  it('should handle: "${msg.message.substring(0, 50)}..."', async () => {\n`;
      output += `    const result = await processTestMessage('${msg.message.replace(/'/g, "\\'")}');\n`;
      output += `    expect(result).toBeDefined();\n`;
      output += `  });\n\n`;
    }

    output += '});\n\n';
  }

  return output;
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: ts-node chatParser.ts <chat-file-or-directory>');
    process.exit(1);
  }

  const inputPath = args[0];
  const stat = fs.statSync(inputPath);

  let scenarios: TestScenario[];

  if (stat.isDirectory()) {
    scenarios = parseAllChatFiles(inputPath);
  } else {
    scenarios = parseChatFile(inputPath);
  }

  console.log(`Parsed ${scenarios.length} test scenarios:\n`);

  for (const scenario of scenarios) {
    console.log(`📋 ${scenario.name}`);
    console.log(`   Messages: ${scenario.messages.length}`);
    console.log(`   Flow: ${scenario.expectedFlow.join(' -> ')}`);
    console.log('');
  }

  // Output JSON
  const jsonPath = path.join(path.dirname(inputPath), 'parsed-scenarios.json');
  fs.writeFileSync(jsonPath, scenariosToJson(scenarios));
  console.log(`\n✅ Saved scenarios to: ${jsonPath}`);
}
