#!/usr/bin/env node
/**
 * PostToolUse hook for Bash commands
 * Monitors test execution results and provides guidance to implementer
 */

import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';

try {
  // Read input from stdin
  const input = JSON.parse(fs.readFileSync(0, 'utf-8'));
  const { tool_name, tool_input, tool_response } = input;

  // Only process Bash commands
  if (tool_name !== 'Bash') {
    process.exit(0);
  }

  const command = tool_input.command || '';

  // Check if this was a test command
  const isTestCommand = command.includes('pnpm test') || 
                       command.includes('npm test') ||
                       command.includes('jest') ||
                       command.includes('playwright test') ||
                       command.includes('run-tests') ||
                       command.includes('run-e2e-tests');

  if (!isTestCommand) {
    process.exit(0);
  }

  // Detect agent
  let agent = 'main';
  try {
    const detectScript = path.join(process.env.CLAUDE_PROJECT_DIR || '', '.claude/hooks/detect-agent.js');
    agent = execSync(`node "${detectScript}"`, { encoding: 'utf-8' }).trim();
  } catch {
    agent = 'main';
  }

  // Only apply to implementer
  if (agent !== 'implementer') {
    // For tester, failing tests are expected
    if (agent === 'tester' && tool_response) {
      const output = tool_response.output || tool_response.stdout || '';
      if (output.includes('failed') || output.includes('FAIL')) {
        // This is expected for TDD
        console.log('✅ Tests are failing as expected (TDD red phase). The implementer will make them pass.');
      }
    }
    process.exit(0);
  }

  // For implementer, check if tests failed
  if (tool_response) {
    const output = tool_response.output || tool_response.stdout || '';
    const exitCode = tool_response.exit_code || tool_response.exitCode || 0;
    
    // Common failure indicators
    const testsFailed = exitCode !== 0 ||
                       output.includes('failed') || 
                       output.includes('FAIL') ||
                       output.includes('✗') ||
                       output.includes('failing') ||
                       (output.includes('Tests:') && output.includes('failed')) ||
                       (output.includes('Test Suites:') && output.includes('failed'));

    if (testsFailed) {
      // Extract failure count if possible
      let failureInfo = '';
      const failMatch = output.match(/(\d+)\s+fail/i);
      if (failMatch) {
        failureInfo = ` (${failMatch[1]} test${failMatch[1] === '1' ? '' : 's'} failing)`;
      }

      // Don't block (exit 0) but provide clear feedback to Claude
      console.log(`⚠️ Tests are failing${failureInfo}. You MUST fix the implementation.

IMPORTANT: Do NOT run complete-task with failing tests!

Use the TodoWrite tool to track ALL failing tests:
1. Add each failing test as a todo item
2. Work through them one by one
3. Do NOT run full test suites repeatedly
4. Fix each specific test in your todo list
5. Mark each todo as completed when fixed
6. Only run complete-task when ALL todos are done and tests pass

Remember: Your task is to make ALL tests pass with real implementations, not stubs.`);
    } else if (output.includes('passed') || output.includes('PASS') || output.includes('✓')) {
      // Tests are passing
      console.log(`✅ Tests are passing! If all tests pass, you can run: .claude/commands/complete-task`);
    }
  }

  process.exit(0);
} catch (error) {
  // Don't block on errors
  console.error('Hook error:', error.message);
  process.exit(0);
}