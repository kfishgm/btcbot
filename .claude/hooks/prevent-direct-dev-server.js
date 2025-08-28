#!/usr/bin/env node
/**
 * Prevents direct usage of pnpm run dev/pnpm dev and directs to utility functions
 * This ensures proper dev server management through tmux
 */

import fs from 'fs'

// Read tool input from stdin
let input = ''
process.stdin.on('data', (chunk) => {
  input += chunk
})

process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input)
    const command = data.tool_input?.command || ''

    // Check for various forms of running dev server directly
    // Must be at start of command or after common separators
    const devPatterns = [
      /(?:^|;|&&|\|\|)\s*pnpm\s+(run\s+)?dev\b/,
      /(?:^|;|&&|\|\|)\s*npm\s+(run\s+)?dev\b/,
      /(?:^|;|&&|\|\|)\s*yarn\s+(run\s+)?dev\b/,
      /(?:^|;|&&|\|\|)\s*next\s+dev\b/,
      /(?:^|;|&&|\|\|)\s*pnpm\s+(run\s+)?start\b/,
      /(?:^|;|&&|\|\|)\s*npm\s+(run\s+)?start\b/,
      /(?:^|;|&&|\|\|)\s*yarn\s+(run\s+)?start\b/,
    ]

    const isDevCommand = devPatterns.some((pattern) => pattern.test(command))

    if (isDevCommand) {
      // Block with helpful message
      console.log(
        JSON.stringify({
          decision: 'block',
          reason: `❌ Direct dev server commands are not allowed!

⚠️  Running dev servers directly can:
  • Create orphaned processes
  • Conflict with tmux-managed servers
  • Cause port conflicts
  • Break the sequential workflow

✅ REQUIRED: Use the dev server utility functions instead:

📌 Available Commands:
  • .claude/lib/start-dev-server   - Start the dev server in tmux
  • .claude/lib/stop-dev-server    - Stop the dev server cleanly
  • .claude/lib/restart-dev-server - Restart the dev server
  • .claude/lib/check-dev-server   - Check dev server status

These utilities:
  • Manage dev servers in tmux window 2
  • Handle ports correctly (3000 for main, 3001 for sequential)
  • Prevent orphaned processes
  • Integrate with the workflow

Example usage:
  .claude/lib/check-dev-server    # Check if running
  .claude/lib/start-dev-server    # Start if needed
  .claude/lib/restart-dev-server  # Restart if issues`,
        })
      )
      process.exit(0)
    }

    // Allow the command
    console.log(JSON.stringify({ decision: 'approve' }))
  } catch (error) {
    // On error, allow the command
    console.log(JSON.stringify({ decision: 'approve' }))
  }
})
