#!/usr/bin/env node
/**
 * PreToolUse hook for Bash commands
 * Validates command syntax and enforces agent-specific rules
 */

import fs from 'fs'
import { execSync } from 'child_process'
import path from 'path'

try {
  // Read input from stdin
  const input = JSON.parse(fs.readFileSync(0, 'utf-8'))
  const { tool_input } = input
  const command = tool_input.command || ''

  // Detect agent using our helper script
  let agent = 'main'
  try {
    const detectScript = path.join(
      process.env.CLAUDE_PROJECT_DIR || '',
      '.claude/hooks/detect-agent.js'
    )
    agent = execSync(`node "${detectScript}"`, { encoding: 'utf-8' }).trim()
  } catch (error) {
    // If detection fails, assume main
    agent = 'main'
  }

  // Protect .claude/ directory in worktrees from bash modifications
  const cwd = process.cwd()
  const isWorktree =
    cwd.includes('btcbot-arch') ||
    cwd.includes('btcbot-test') ||
    cwd.includes('btcbot-impl')

  if (isWorktree) {
    // Check for commands that modify .claude/ files
    const modifyingCommands = [
      'mv',
      'rm',
      'chmod',
      'cp',
      'touch',
      'sed',
      'echo',
    ]
    const commandLower = command.toLowerCase()

    for (const cmd of modifyingCommands) {
      if (commandLower.includes(cmd) && command.includes('.claude/')) {
        // Allow reading operations but block modifications
        if (
          !commandLower.includes('ls ') &&
          !commandLower.includes('cat ') &&
          !commandLower.includes('grep ') &&
          !commandLower.includes('find ')
        ) {
          console.error(
            '❌ Modifying .claude/ directory files is forbidden in worktrees'
          )
          console.error(
            'These files control the pipeline infrastructure and must remain intact.'
          )
          console.error(
            'To modify pipeline behavior, edit files in the main project instead.'
          )
          process.exit(2)
        }
      }
    }

    // Block skipping tests or migrations by renaming (but allow restoring)
    if (command.includes('mv ') || command.includes('rename ')) {
      // Extract source and destination from mv command
      const mvMatch = command.match(/mv\s+(\S+)\s+(\S+)/)
      if (mvMatch) {
        const [, source, dest] = mvMatch

        // Check if this is ADDING a skip suffix (blocking) vs REMOVING one (allowing)
        const skipSuffixes = /\.(skip|disabled|old|backup|temp)$/i
        const isAddingSkip =
          !skipSuffixes.test(source) && skipSuffixes.test(dest)
        const isRemovingSkip =
          skipSuffixes.test(source) && !skipSuffixes.test(dest)

        // Block adding skip suffixes to test files
        if (
          isAddingSkip &&
          source.match(/\.(test|spec|e2e)\.(ts|tsx|js|jsx)$/i)
        ) {
          console.error('❌ Renaming test files to skip them is forbidden')
          console.error('You must fix failing tests, not skip them.')
          console.error(
            'If a test is invalid, delete it properly with justification.'
          )
          process.exit(2)
        }

        // Block adding skip suffixes to migration files
        if (isAddingSkip && source.includes('migrations/')) {
          console.error('❌ Renaming migration files to skip them is forbidden')
          console.error(
            'Migrations must be fixed or properly removed, not skipped.'
          )
          console.error(
            'If a migration is problematic, fix it or use proper rollback procedures.'
          )
          process.exit(2)
        }

        // Allow removing skip suffixes (restoring files)
        if (isRemovingSkip) {
          // This is allowed - restoring a previously skipped file
          console.log('✅ Restoring previously skipped file')
        }
      }
    }

    // Block moving files to skip/temp directories
    if (
      (command.includes('mv ') || command.includes('cp ')) &&
      (command.match(/\/(skip|temp|disabled|old|backup)\//i) ||
        command.match(/\/\.\w+\//))
    ) {
      // Hidden directories like /.backup/
      console.error('❌ Moving files to skip/temp directories is forbidden')
      console.error('Fix issues directly instead of hiding files.')
      process.exit(2)
    }
  }

  // Check pnpm test syntax - no -- separator needed
  if (command.includes('pnpm test') && command.includes(' -- ')) {
    console.error("❌ Don't use '--' separator with pnpm test")
    console.error('✅ Correct: pnpm test --maxWorkers=2 --forceExit')
    console.error('❌ Wrong: pnpm test -- --maxWorkers=2 --forceExit')
    process.exit(2)
  }

  // Check Playwright reporter only (no longer enforcing workers)
  if (
    command.includes('pnpm playwright test') ||
    (command.includes('playwright test') &&
      !command.includes('.claude/lib/run-e2e-tests'))
  ) {
    // Check reporter (unless using pnpm test:e2e which has it built-in)
    if (!command.includes('test:e2e') && !command.includes('--reporter')) {
      console.error(
        '❌ Always use --reporter=list with Playwright to prevent browser opening'
      )
      console.error(`✅ Correct: pnpm playwright test --reporter=list`)
      console.error('Or use: pnpm test:e2e (which includes this flag)')
      console.error(
        'The HTML report will open in your browser without this flag.'
      )
      process.exit(2)
    }
  }

  // Agent-specific command enforcement
  if (agent === 'implementer') {
    // Check for wrong completion command
    if (
      command.match(/\btask-complete\b/) &&
      !command.includes('complete-task')
    ) {
      console.error(
        "❌ Implementer must use 'complete-task', not 'task-complete'"
      )
      console.error('✅ Correct: .claude/commands/complete-task')
      console.error(
        'This command creates the PR and completes your implementation task.'
      )
      process.exit(2)
    }

    // Prevent manual PR operations
    if (command.includes('gh pr create')) {
      console.error("❌ Don't manually create PRs")
      console.error('Use: .claude/commands/complete-task')
      console.error(
        'This will run quality checks and create the PR automatically.'
      )
      process.exit(2)
    }

    // Prevent manual label operations
    if (command.includes('gh issue edit') && command.includes('--add-label')) {
      console.error("❌ Don't manually add labels to issues")
      console.error('Use: .claude/commands/complete-task')
      console.error(
        'This will add the implementation-done label automatically.'
      )
      process.exit(2)
    }
  }

  // Architect and Tester should use task-complete
  if (agent === 'architect' || agent === 'tester') {
    if (
      command.match(/\bcomplete-task\b/) &&
      !command.includes('task-complete')
    ) {
      console.error(
        `❌ ${agent.charAt(0).toUpperCase() + agent.slice(1)} should use 'task-complete', not 'complete-task'`
      )
      console.error('✅ Correct: .claude/commands/task-complete')
      console.error('The complete-task command is only for the implementer.')
      process.exit(2)
    }
  }

  // Warn about common mistakes
  if (command.includes('git add .') && agent !== 'main') {
    console.error("⚠️  Warning: 'git add .' can add unwanted files")
    console.error('Consider using: .claude/lib/git-add-safe')
    console.error('Or specify exact files: git add src/ tests/')
    // Don't block, just warn
  }

  // All checks passed
  process.exit(0)
} catch (error) {
  // If there's an error, allow the operation
  console.error('Hook error:', error.message)
  process.exit(0)
}
