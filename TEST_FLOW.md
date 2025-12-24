
  Test Structure

  tests/
  ├── chats/               # Drop your chat files here
  │   ├── CHAT-1.md
  │   └── CHAT-2.md
  ├── scenarios/           # Test scenarios (JSON)
  │   └── order-flows.json # 15 scenarios ready
  ├── mocks/
  │   └── mockAIService.ts # Pattern-based mock AI
  ├── utils/
  │   ├── chatParser.ts    # Parse chat → scenarios
  │   └── addScenario.ts   # Add scenarios easily
  ├── setup.ts
  └── orderFlow.test.ts    # Main test file

  Commands

  # Install Jest (one time)
  pnpm install

  # Run all tests
  npm test

  # Watch mode (re-run on changes)
  npm run test:watch

  # Test with coverage report
  npm run test:coverage

  # List all scenarios
  npm run test:list-scenarios

  # Add new scenario (interactive)
  npm run test:add-scenario add

  # Parse chat files → extract scenarios
  npm run test:parse-chats

  Adding New Chat Files

  1. Drop chat .md file in tests/chats/
  2. Run npm run test:parse-chats to auto-extract scenarios
  3. Or manually add via npm run test:add-scenario add

  Current Scenarios (15)

  - Basic burger delivery flow
  - Cake with inline size
  - Takeaway flow
  - Show menu
  - Modify custom text
  - Remove custom text
  - Remove addon
  - Cancel order
  - Check order status
  - Empty cart checkout
  - Address with time
  - Manglish order
  - Multiple items
  - Quantity change
    - Edge cases & regression tests

  Run pnpm install then npm test to try it!