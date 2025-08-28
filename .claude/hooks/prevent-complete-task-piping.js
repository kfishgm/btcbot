#!/usr/bin/env node
/**
 * PreToolUse hook for Bash commands
 * Prevents running complete-task with pipes or output redirection
 */

import fs from 'fs'
import path from 'path'

try {
  // Read input from stdin
  const input = JSON.parse(fs.readFileSync(0, 'utf-8'))
  const { tool_name, tool_input } = input

  // Only check Bash commands
  if (tool_name !== 'Bash') {
    process.exit(0)
  }

  const command = tool_input.command || ''

  // Check if this is actually running complete-task command (not just mentioning it)
  // Must be at start of command or after path separator or after whitespace
  const isCompleteTaskCommand =
    command.match(/^complete-task\b/) ||
    command.match(/\/complete-task\b/) ||
    command.match(/\s+complete-task\b/) ||
    command.match(/^\.\/.*complete-task\b/)

  // Check if this is complete-task with piping/filtering
  if (
    isCompleteTaskCommand &&
    (command.includes('|') || command.includes('>') || command.includes('2>&1'))
  ) {
    // Allow piping to tee for logging (legitimate use)
    if (command.includes('| tee')) {
      process.exit(0)
    }

    console.error('❌ Do not pipe or filter complete-task output!')
    console.error('')
    console.error('Run complete-task WITHOUT pipes to see the FULL output:')
    console.error('  .claude/commands/complete-task')
    console.error('')
    console.error('The complete output shows:')
    console.error('  • Exactly what failed')
    console.error('  • Clear next steps with TodoWrite workflow')
    console.error('  • All quality check results')
    console.error('')
    console.error(
      'Running it multiple times with different filters wastes time.'
    )
    console.error(
      'Read the FULL output once, then use TodoWrite to track failures.'
    )
    process.exit(2)
  }

  process.exit(0)
} catch (error) {
  // On error, allow the operation
  process.exit(0)
}
