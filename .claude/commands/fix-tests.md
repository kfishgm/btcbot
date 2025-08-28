---
allowed-tools: Bash(*), Read(*), Edit(*), Write(*), TodoWrite(*), Grep(*), Glob(*)
description: Implement functionality to make failing tests pass (TDD GREEN phase)
---

# Fix Failing Tests - TDD Implementation Phase

You are a software engineer that excels at TDD, the test engineer has finished (RED phase). You must implement even the most complex functionality (GREEN phase). You are NOT running as an agent, so DO NOT run any agent startup checks or look for TASK files.

## Context
- Current directory: !`pwd`
- Test status: !`timeout 30s pnpm test --listTests 2>&1 | grep -c "test\." || echo "0 test files found"`

## CRITICAL RULES:
- **YOU ARE THE IMPLEMENTER**, you implement missing functionality or fix functionality. Your job is not to fix tests, it's to make them GREEN
- **QUALITY FIRST**: Read `.claude/docs/quality-rules.md` before implementing - NO TypeScript or ESLint errors allowed
- Don't stop until all __tests__ pass, use the most performant test commands to avoid long wait time
- Use --bail to stop on first failure for faster fixing!
- Look for conflicting expectations with other tests (such as 'AUTH_INVALID_PASSWORD' and 'VAL_PASSWORD_WEAK') and edit the test picking the best one
- NEVER modify test files UNLESS they are **clearly wrong or have unrealistic expectations**
- NEVER add .skip() or .only() to tests
- NEVER add @ts-ignore or @ts-expect-error
- NEVER disable ESLint rules
- NEVER use `any` types - follow TypeScript strict mode rules
- Implement robust solutions
- You MUST run `.claude/lib/cleanup-processes.sh` after every test command NO EXCEPTIONS
- Favor implementations over mocks
- You MUST not have regressions
- RUN test __tests__ only to identify new failures to work on if you don't have any

## TASK:

IMMEDIATELY start with this command:
```bash
pnpm test --bail && .claude/lib/cleanup-processes.sh
```

Then for EACH failure:
1. Read the error output
2. Find and read the failing test file to understand expectations
3. Look for conflicting expectations with other tests (such as 'AUTH_INVALID_PASSWORD' and 'VAL_PASSWORD_WEAK') and edit the test picking the best one
4. Replace mocks with implementations
5. Refer to the architect's documentation under @docs/architect
6. Implement solutions to satisfy the test no matter how complex the functionality might be
7. Run a targeted test again to ensure it passes:
   ```bash
   pnpm test [specific-test-file] --bail && .claude/lib/cleanup-processes.sh
   ```
8. Run pnpm test --bail to find next test

Continue until pnpm test --bail shows no failures.

Then verify with full suite:
```bash
.claude/lib/run-quality-checks
```

## QUALITY CHECKS:
Before considering ANY implementation complete, verify:
1. `pnpm typecheck` - MUST pass with zero errors
2. `pnpm lint` - MUST pass with zero errors
3. Review `.claude/docs/quality-rules.md` for common violations

## DO NOT:
- Run agent-startup-check.sh
- Look for TASK files
- Add skip/only/ignore comments
- DO NOT add .skip or .only
- DO NOT delete tests unless they are duplicates
- DO NOT test __tests__ unless you don't have tests to fix in your todos (extremely slow operation)
- DO NOT test __tests__ to see progress
- DO NOT skip `.claude/lib/cleanup-processes.sh` after every test command

## START NOW by running:
```bash
pnpm test --bail && .claude/lib/cleanup-processes.sh
```