#!/usr/bin/env node
/**
 * Hook to provide guidance when complete-task fails
 * Triggered on PostToolUse when complete-task exits with non-zero status
 */

const eventType = process.env.CLAUDE_HOOK_EVENT;
const toolName = process.env.CLAUDE_HOOK_TOOL;
const exitCode = process.env.CLAUDE_HOOK_EXIT_CODE;

// Only trigger on PostToolUse for Bash when complete-task fails
if (eventType !== 'PostToolUse' || toolName !== 'Bash') {
    process.exit(0);
}

// Check if this was a complete-task command that failed
const command = process.env.CLAUDE_HOOK_COMMAND || '';

// Check for various ways complete-task might be invoked:
// - Direct: .claude/commands/complete-task
// - With timeout: timeout 600s .claude/commands/complete-task
// - Piped: .claude/commands/complete-task | tee output.log
// - Redirected: .claude/commands/complete-task > output.log 2>&1
// - Background: .claude/commands/complete-task &
const completeTaskPatterns = [
    /complete-task/,  // Basic pattern
    /\.claude\/commands\/complete-task/,  // Full path
    /timeout\s+\d+[sm]?\s+.*complete-task/,  // With timeout
];

const isCompleteTask = completeTaskPatterns.some(pattern => pattern.test(command));

if (!isCompleteTask || exitCode === '0') {
    process.exit(0);
}

// Complete-task failed - provide guidance
console.error('\n' + '='.repeat(80));
console.error('🛑 COMPLETE-TASK FAILED - IMPORTANT GUIDANCE FOR IMPLEMENTER');
console.error('='.repeat(80));
console.error('');
console.error('❌ DO NOT run complete-task again until ALL of these pass:');
console.error('   • pnpm lint');
console.error('   • pnpm typecheck');
console.error('   • pnpm build');
console.error('   • ALL unit tests');
console.error('   • ALL e2e tests');
console.error('');
console.error('📋 REQUIRED WORKFLOW - Follow this EXACT process:');
console.error('');
console.error('1️⃣  INITIAL TEST DISCOVERY (do this ONCE):');
console.error('   ```bash');
console.error('   # Run unit tests ONCE to find ALL failures');
console.error('   pnpm test');
console.error('   # Add each failing test to TodoWrite tool');
console.error('   ');
console.error('   # Run e2e tests ONCE with fast settings');
console.error('   pnpm test:e2e:chromium  # Uses 8 workers automatically');
console.error('   # Add each failing e2e test to TodoWrite tool');
console.error('   ```');
console.error('');
console.error('2️⃣  FIX TESTS INDIVIDUALLY (work through your todo list):');
console.error('   ```bash');
console.error('   # For each unit test in your todo:');
console.error('   .claude/lib/run-tests path/to/specific.test.ts');
console.error('   # Fix the implementation');
console.error('   # Re-run that SPECIFIC test until it passes');
console.error('   # Mark todo item complete');
console.error('   ');
console.error('   # For each e2e test in your todo:');
console.error('   .claude/lib/run-e2e-tests e2e/specific.spec.ts');
console.error('   # Fix the implementation');
console.error('   # Re-run that SPECIFIC test until it passes');
console.error('   # Mark todo item complete');
console.error('   ```');
console.error('');
console.error('3️⃣  IMPLEMENT FULLY:');
console.error('   • NO STUBS - Implement real database operations');
console.error('   • NO SHORTCUTS - Full business logic required');
console.error('   • NO MOCKS in production code - Only in test files');
console.error('   • Make tests pass with REAL implementations');
console.error('');
console.error('4️⃣  ONLY after ALL todos are complete and fixed:');
console.error('   ```bash');
console.error('   # Final verification before complete-task');
console.error('   pnpm lint');
console.error('   pnpm typecheck');
console.error('   pnpm build');
console.error('   # Then and ONLY then:');
console.error('   .claude/commands/complete-task');
console.error('   ```');
console.error('');
console.error('⚠️  WARNINGS:');
console.error('   ❌ DO NOT run full test suites repeatedly to "check progress"');
console.error('   ❌ DO NOT run full test suites to "count remaining failures"');
console.error('   ❌ DO NOT run complete-task to "see what fails"');
console.error('   ✅ DO use TodoWrite to track every failing test');
console.error('   ✅ DO fix tests one by one from your todo list');
console.error('   ✅ DO implement full production-ready code');
console.error('');
console.error('💡 Remember: You are the IMPLEMENTER. Your job is to make ALL tests pass');
console.error('   with production-ready, fully-featured implementations!');
console.error('');
console.error('='.repeat(80));
console.error('');

// Exit with special code to indicate we handled this
process.exit(0);