#!/usr/bin/env node
/**
 * Stop hook - prevents implementer from stopping with incomplete work
 * Forces continuation if tests are failing or complete-task hasn't been run
 */

import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';

try {
  // Read input from stdin
  const input = JSON.parse(fs.readFileSync(0, 'utf-8'));
  const { stop_hook_active } = input;

  // Detect agent
  let agent = 'main';
  try {
    const detectScript = path.join(process.env.CLAUDE_PROJECT_DIR || '', '.claude/hooks/detect-agent.js');
    agent = execSync(`node "${detectScript}"`, { encoding: 'utf-8' }).trim();
  } catch {
    // If detection fails, allow stop
    process.exit(0);
  }

  // Only enforce for implementer
  if (agent !== 'implementer') {
    process.exit(0);
  }

  // Check if this is already a stop hook continuation to prevent infinite loops
  if (stop_hook_active) {
    process.exit(0);
  }

  // Check if TASK file still exists (indicates incomplete work)
  let taskFiles = '';
  try {
    taskFiles = execSync('find . -name "TASK-*.md" -type f 2>/dev/null', 
                        { encoding: 'utf-8', cwd: process.cwd() }).trim();
  } catch {
    // No task files or find failed
  }

  if (!taskFiles) {
    // No TASK file, work might be complete
    process.exit(0);
  }

  // Get the task ID from the file
  const taskMatch = taskFiles.match(/TASK-(\d+)\.md/);
  const taskId = taskMatch ? taskMatch[1] : 'current';

  // Check if tests are passing
  let testsPass = false;
  let testOutput = '';
  let failureCount = 0;
  
  try {
    // Run tests with a timeout and capture output
    testOutput = execSync('timeout 60s pnpm test --reporter=json 2>&1 || true', 
                         { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 10 });
    
    // Check for failure indicators
    if (testOutput.includes('"success":false') || 
        testOutput.includes('"numFailedTests":') ||
        testOutput.includes('FAIL') ||
        testOutput.includes('failed')) {
      testsPass = false;
      
      // Try to extract failure count
      const failMatch = testOutput.match(/"numFailedTests":(\d+)/);
      if (failMatch) {
        failureCount = parseInt(failMatch[1]);
      }
    } else if (testOutput.includes('"success":true') || 
               testOutput.includes('PASS') ||
               testOutput.includes('passed')) {
      testsPass = true;
    }
  } catch (error) {
    // Tests failed to run or timed out
    testsPass = false;
    testOutput = error.stdout || error.message || 'Tests failed to run';
  }

  // If tests aren't passing, block the stop and provide specific guidance
  if (!testsPass && taskFiles) {
    const failureInfo = failureCount > 0 ? ` (${failureCount} test${failureCount === 1 ? '' : 's'} failing)` : '';
    
    const output = {
      decision: "block",
      reason: `You cannot stop yet - tests are still failing${failureInfo}. Task #${taskId} is incomplete.

Your task requires ALL tests to pass with real implementations (no stubs).

Continue with:
1. Run 'pnpm test' to see detailed failure messages
2. Fix the implementation code to make tests pass
3. Do NOT modify or skip tests - fix the actual functionality
4. Once ALL tests pass, run '.claude/commands/complete-task'

Remember: You must implement complete, production-ready functionality.`,
      suppressOutput: false
    };
    
    console.log(JSON.stringify(output));
    process.exit(0);
  }

  // If tests pass but complete-task hasn't been run (TASK file still exists)
  if (testsPass && taskFiles) {
    const output = {
      decision: "block",
      reason: `Great! Tests are passing, but task #${taskId} isn't complete yet.

You must run '.claude/commands/complete-task' to:
✓ Run final quality checks (lint, typecheck, build)
✓ Deploy any migrations
✓ Create and merge the PR
✓ Mark the task as complete

Run: .claude/commands/complete-task`,
      suppressOutput: false
    };
    
    console.log(JSON.stringify(output));
    process.exit(0);
  }

  // Check if there's uncommitted work
  let hasUncommittedWork = false;
  try {
    const gitStatus = execSync('git status --porcelain', { encoding: 'utf-8' });
    hasUncommittedWork = gitStatus.trim().length > 0;
  } catch {
    // Git command failed, allow stop
  }

  if (hasUncommittedWork && !taskFiles) {
    // Work might be done but not committed
    const output = {
      decision: "block", 
      reason: `You have uncommitted changes. If your work is complete:

1. Commit your changes: git add . && git commit -m "implementation: Complete task"
2. Run: .claude/commands/complete-task

If work is not complete, continue implementing.`,
      suppressOutput: false
    };
    
    console.log(JSON.stringify(output));
    process.exit(0);
  }

  // Allow stop in other cases
  process.exit(0);
} catch (error) {
  // Log error for debugging but don't block
  console.error('Hook error:', error.message);
  process.exit(0);
}