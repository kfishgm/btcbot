#!/usr/bin/env node
/**
 * PreToolUse hook for Bash commands
 * Prevents using git add . or git add -A which can add unwanted files
 */

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

try {
  // Read input from stdin
  const input = JSON.parse(fs.readFileSync(0, 'utf-8'))
  const { tool_name, tool_input } = input

  // Only check Bash commands
  if (tool_name !== 'Bash') {
    process.exit(0)
  }

  const command = tool_input.command || ''

  // Patterns for dangerous git add commands
  const dangerousPatterns = [
    /\bgit\s+add\s+\.(?:\s|$)/, // git add . (only at end or followed by space)
    /\bgit\s+add\s+-A\b/, // git add -A
    /\bgit\s+add\s+--all\b/, // git add --all
    /\bgit\s+add\s+\*(?![.\w])/, // git add * (but allow *.ts, *.js, etc.)
    /\bgit\s+stage\s+\.(?:\s|$)/, // git stage . (only at end or followed by space)
    /\bgit\s+stage\s+-A\b/, // git stage -A
    /\bgit\s+stage\s+--all\b/, // git stage --all
    /\bgit\s+add\s+\.\/(?:\s|$)/, // git add ./ (only at end or followed by space)
    /\bgit\s+commit\s+.*-a(?:\s|$)/, // git commit -a (adds all tracked)
    /\bgit\s+commit\s+.*--all/, // git commit --all
  ]

  // Check if command matches any dangerous pattern
  const matchedPattern = dangerousPatterns.find((pattern) =>
    pattern.test(command)
  )

  if (matchedPattern) {
    console.error('❌ Dangerous git add pattern detected!')
    console.error('')
    console.error(`Command: ${command}`)
    console.error('')
    console.error('⚠️  "git add ." and similar commands can accidentally add:')
    console.error('  • Sensitive files (.env, .env.local, secrets)')
    console.error('  • Build artifacts (dist/, .next/, node_modules/)')
    console.error('  • Temporary files (.DS_Store, *.log, *.tmp)')
    console.error('  • Debug files (*.map, coverage/)')
    console.error('  • IDE configs (.vscode/, .idea/)')
    console.error('  • TASK files (TASK-*.md)')
    console.error('')
    console.error('✅ BETTER ALTERNATIVES:')
    console.error('')
    console.error('1. Use safe add helper (recommended):')
    console.error('   .claude/lib/git-add-safe')
    console.error('')
    console.error('2. Add specific directories:')
    console.error('   git add src/ components/ lib/')
    console.error('')
    console.error('3. Add by file extension:')
    console.error('   git add "*.ts" "*.tsx" "*.js" "*.jsx"')
    console.error('')
    console.error('4. Add specific files:')
    console.error('   git add path/to/file1.ts path/to/file2.ts')
    console.error('')
    console.error('5. Use interactive mode to review:')
    console.error('   git add -p  # Review each change')
    console.error('')
    console.error('6. Check what would be added first:')
    console.error('   git status')
    console.error('   git diff --cached  # See staged changes')
    console.error('')
    console.error('📝 If you really need to add everything (rare):')
    console.error('   1. First check: git status')
    console.error('   2. Review carefully')
    console.error('   3. Then explicitly list directories')

    // Special case: If in a worktree, provide worktree-specific advice
    const cwd = process.cwd()
    if (
      cwd.includes('-arch') ||
      cwd.includes('-test') ||
      cwd.includes('-impl')
    ) {
      console.error('')
      console.error('🔧 AGENT WORKTREE DETECTED:')
      console.error('Be extra careful - worktrees may have:')
      console.error('  • Different .env files')
      console.error('  • TASK-*.md files (never commit these)')
      console.error('  • Modified .claude/ files')
    }

    process.exit(2)
  }

  // Also warn about potentially dangerous patterns (but don't block)
  const warningPatterns = [
    /\bgit\s+add\s+--force/, // git add --force
    /\bgit\s+add\s+-f/, // git add -f
  ]

  const warningMatch = warningPatterns.find((pattern) => pattern.test(command))
  if (warningMatch) {
    console.error('⚠️  Warning: Using force flag with git add')
    console.error('Make sure you really want to override .gitignore rules')
    // Don't block, just warn
  }

  // Check for good patterns and provide positive feedback
  const goodPatterns = [
    /\bgit\s+add\s+src\//,
    /\bgit\s+add\s+components\//,
    /\bgit\s+add\s+lib\//,
    /\bgit\s+add\s+\*\.\w+/, // Adding by extension
    /\bgit\s+add\s+-p/, // Interactive add
    /\.claude\/lib\/git-add-safe/, // Using safe helper
  ]

  const goodMatch = goodPatterns.find((pattern) => pattern.test(command))
  if (goodMatch && command.includes('git add')) {
    console.log('✅ Good practice: Adding specific files/directories')
  }

  process.exit(0)
} catch (error) {
  // Log error but don't block the operation
  console.error('Hook error:', error.message)
  process.exit(0)
}
