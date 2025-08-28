# Claude Code Hooks System

This directory contains automated hooks that enforce code quality and development standards across the btcbot project. These hooks run automatically during Claude Code sessions to prevent common mistakes and ensure consistent quality.

## Overview

The hooks system reduces the need for lengthy instructions in CLAUDE.md by automatically:
- Protecting critical system files
- Enforcing proper command usage
- Preventing stub implementations
- Ensuring tests pass before completion
- Guiding agents with real-time feedback

## Hook Files

### Core Scripts

- **`detect-agent.js`** - Identifies which agent is running (architect/tester/implementer/main)
- **`check-stub-implementations.js`** - Scans code for stub implementations (empty returns, TODOs, etc.)

### PreToolUse Hooks (Before Operations)

- **`protect-system-files.js`** - Prevents modification of .claude/ files in worktrees, blocks duplicate file creation
- **`validate-commands.js`** - Enforces correct command syntax and agent-specific rules

### PostToolUse Hooks (After Operations)

- **`check-test-status.js`** - Monitors test execution and provides guidance based on results

### Stop Hooks

- **`enforce-implementer-completion.js`** - Prevents implementer from stopping with failing tests or incomplete work

## Configuration

Hooks are configured in `.claude/settings.json`. Each hook specifies:
- Event type (PreToolUse, PostToolUse, Stop)
- Tool matcher pattern (Edit, Write, Bash, etc.)
- Command to execute
- Timeout in seconds

## Agent-Specific Rules

### Implementer
- ✅ Must use `complete-task` command
- ❌ Cannot use `task-complete`
- ❌ Cannot create PRs manually
- ❌ Cannot stop with failing tests
- ❌ Cannot have stub implementations

### Tester
- ✅ Must use `task-complete` command
- ✅ Can write failing tests (TDD)
- ❌ Cannot use `complete-task`

### Architect
- ✅ Must use `task-complete` command
- ✅ Can create stub implementations
- ❌ Cannot use `complete-task`

### Main Project
- ✅ Can modify .claude/ files
- ✅ Can use any commands
- No restrictions (for maintenance)

## How Hooks Work

### File Protection Example
When an agent tries to edit a protected file:
```
❌ Modifying .claude/ directory files is forbidden in worktrees
These files control the pipeline infrastructure and must remain intact.
```

### Command Validation Example
When using incorrect command syntax:
```
❌ Don't use '--' separator with pnpm test
✅ Correct: pnpm test --maxWorkers=2 --forceExit
```

### Test Monitoring Example
After running tests:
```
⚠️ Tests are failing (3 tests failing). You MUST fix the implementation.

Next steps:
1. Analyze the test failure messages above
2. Fix the implementation code (not the tests)
3. Re-run tests to verify they pass
```

### Completion Enforcement Example
When implementer tries to stop with incomplete work:
```
You cannot stop yet - tests are still failing. Task #123 is incomplete.

Continue with:
1. Run 'pnpm test' to see detailed failure messages
2. Fix the implementation code to make tests pass
3. Once ALL tests pass, run '.claude/commands/complete-task'
```

## Stub Detection

The stub checker looks for patterns like:
- Empty returns: `return []` or `return {}`
- Not implemented errors: `throw new Error('not implemented')`
- TODO comments: `// TODO: implement`
- Empty function bodies
- Placeholder implementations

It runs BEFORE quality checks to save time and tokens.

## Troubleshooting

### Hook Not Running
- Check `.claude/settings.json` for correct configuration
- Verify script has execute permissions: `chmod +x .claude/hooks/*.js`
- Check hook output with `claude --debug`

### False Positives
The stub checker has context awareness to avoid false positives:
- Legitimate empty returns in error handlers
- Default/initial state values
- Type definitions

### Bypassing Hooks (Emergency Only)
If a hook is blocking legitimate work:
1. Report the issue for fix
2. Temporarily comment out the hook in `.claude/settings.json`
3. Re-enable after completing the work

## Token Savings

This hooks system replaces approximately 1,800 tokens of instructions in CLAUDE.md with automated enforcement, reducing token usage by ~45% per agent session.

## Security Note

Hooks execute with the same permissions as Claude Code. They cannot:
- Access files outside the project
- Make network requests (unless explicitly coded)
- Modify system files

All hooks are project-specific and only run within the btcbot project context.