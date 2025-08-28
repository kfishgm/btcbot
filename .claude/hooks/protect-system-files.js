#!/usr/bin/env node
/**
 * PreToolUse hook for Edit|Write|MultiEdit operations
 * Protects system files and enforces file naming conventions
 * .claude/ protection only applies in worktrees (not main project)
 */

import fs from 'fs';
import path from 'path';

try {
  // Read input from stdin
  const input = JSON.parse(fs.readFileSync(0, 'utf-8'));
  const { tool_input } = input;
  const filePath = tool_input.file_path || '';

  // Detect if we're in a worktree (not main project)
  const cwd = process.cwd();
  const isWorktree = cwd.includes('btcbot-arch') || 
                     cwd.includes('btcbot-test') || 
                     cwd.includes('btcbot-impl');

  // Only protect .claude/ in worktrees (allow edits in main project)
  if (isWorktree && filePath.includes('/.claude/')) {
    console.error('❌ Modifying .claude/ directory files is forbidden in worktrees');
    console.error('These files control the pipeline infrastructure and must remain intact.');
    console.error('To modify pipeline behavior, edit files in the main project instead.');
    process.exit(2); // Exit code 2 blocks the tool and shows error to Claude
  }

  // Check for duplicate file patterns (applies everywhere)
  const duplicatePattern = /-(fixed|new|updated|v2|temp|backup)\.(ts|tsx|js|jsx)$/;
  if (duplicatePattern.test(filePath)) {
    console.error('❌ Creating duplicate files with suffixes is forbidden');
    console.error(`Instead of creating: ${path.basename(filePath)}`);
    console.error(`Edit the original file: ${filePath.replace(duplicatePattern, '.$2')}`);
    console.error('Use Edit or MultiEdit tools to modify existing files in place.');
    process.exit(2);
  }

  // TASK files shouldn't be edited in worktrees
  if (isWorktree && filePath.includes('TASK-') && filePath.endsWith('.md')) {
    console.error('❌ TASK-*.md files should not be modified in worktrees');
    console.error('These files are managed by the pipeline system.');
    process.exit(2);
  }

  // CLAUDE.md shouldn't be edited in worktrees
  if (isWorktree && filePath.endsWith('CLAUDE.md')) {
    console.error('❌ CLAUDE.md should not be modified in worktrees');
    console.error('This file is agent-specific and managed by the pipeline.');
    process.exit(2);
  }

  // All checks passed
  process.exit(0);
} catch (error) {
  // If there's an error parsing input, allow the operation
  // (better to allow than to block everything on error)
  console.error('Hook error:', error.message);
  process.exit(0);
}