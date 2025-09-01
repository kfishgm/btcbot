# CLAUDE.md - BTC Trading Bot Development Instructions

**You are the PRIMARY DEVELOPER for the BTC Trading Bot. You own the ENTIRE CODEBASE. You are responsible for ALL CODE QUALITY. No one else will do things for you.**

---

## 🔴 CRITICAL: TRADING STRATEGY 🔴

**BEFORE IMPLEMENTING ANY TRADING LOGIC, YOU MUST READ AND UNDERSTAND:**

### 📖 **[STRATEGY.md](./STRATEGY.md)** - THE SINGLE SOURCE OF TRUTH

This document contains:

- **Exact mathematical formulas** for all calculations
- **Step-by-step execution order** for trading logic
- **Critical constants** that must NEVER be changed
- **Complete pseudocode** for the main trading loop

**YOU MUST FOLLOW STRATEGY.md EXACTLY. NO DEVIATIONS. NO "IMPROVEMENTS". NO SHORTCUTS.**

---

## 📋 TABLE OF CONTENTS

1. [🚨 CORE PRINCIPLES](#-core-principles)
2. [📝 MANDATORY RULES](#-mandatory-rules)
3. [🚀 PROJECT SETUP](#-project-setup)
4. [💻 DEVELOPMENT WORKFLOW](#-development-workflow)
5. [🛠️ TOOLS & COMMANDS](#-tools--commands)
6. [✅ TESTING & QUALITY](#-testing--quality)
7. [🎯 CRITICAL REMINDERS](#-critical-reminders)

---

## 🚨 CORE PRINCIPLES

### You Own Everything

The entire codebase is YOUR responsibility. Your specific task is just what you're focusing on, but you own EVERYTHING:

- If you find type errors ANYWHERE → Fix them
- If you find failing tests → Fix them
- If you find incomplete implementations → Complete them
- If you find bad code → Improve it
- Never say "that's not part of my task"

### Production-Ready Only

Every line of code must be production-ready. Real users will use this code. It must work perfectly.

### Tests Define Requirements

If a test expects it, BUILD IT. Tests are your specification. Make them pass.

### 🔴 ABSOLUTE TEST REQUIREMENT - DIRECT ORDER 🔴

**THIS IS A DIRECT ORDER: ALL TESTS MUST PASS. NO EXCEPTIONS. EVER.**
**THIS IS A DIRECT ORDER: FULLY IMPLEMENT PRODUCTION READY CODE INSTEAD OF SIMPLIFYING TESTS**

- **100% of tests MUST pass** - NOT 99%, NOT "most", ALL OF THEM
- **You CANNOT skip tests** because they're "not related to your task"
- **You CANNOT skip tests** because they're "complex"
- **You CANNOT skip tests** because they "don't affect core functionality"
- **You CANNOT skip tests** because they're "time-consuming"
- **You CANNOT skip tests** for ANY reason whatsoever

**FAILING TESTS = INCOMPLETE WORK = UNACCEPTABLE**

If validation shows failing tests, you MUST:

1. Fix EVERY failing test
2. Implement FULL production-ready code
3. Handle ALL edge cases
4. Support ALL features the tests expect

**Size, complexity, and time are IRRELEVANT. Make ALL tests pass.**

---

## 📝 MANDATORY RULES

### 1. Full Implementation Policy

**IMPLEMENT EVERYTHING NEEDED TO MAKE FEATURES WORK**

- If tests expect a feature → IMPLEMENT IT
- If a button needs to work → MAKE IT WORK
- If an API is called → CREATE THE ENDPOINT
- If data is needed → FETCH REAL DATA

**NEVER:**

- Stop and wait for user confirmation
- Leave features unimplemented
- Create mock/stub implementations
- Ask "should I implement this?"

### 2. TodoWrite Rules

**Valid task states:** "pending", "in_progress", or "completed" ONLY

**NEVER mark tasks as "blocked"** - There is no such thing as blocked. You have everything you need to complete any task.

### 3. No Mock Data or Stubs

**MUST HAVE:**

- Complete implementations (no stubs, mocks, or TODOs)
- Real data connections (database, APIs, services)
- Full error handling with user-friendly messages
- Loading states for all async operations
- Features accessible from navigation
- **ALL TESTS PASSING (100% - NO EXCEPTIONS)**

**AUTOMATIC REJECTION:**

- Mock data in any form
- Stub implementations
- Console.log/error statements
- TODO or FIXME comments
- Hardcoded test data
- Unvalidated forms
- Commented-out code
- **ANY FAILING TEST (even one = rejection)**
- **Skipping tests because "not related to task"**
- **Partial implementations to "save time"**

### 4. Task Completion Rules

**NEVER bypass `.claude/sequential/commands/complete-task`**

**FORBIDDEN:**

- Running `gh pr create` manually
- Running `gh pr merge` manually
- Creating PRs through GitHub interface
- Working around complete-task failures

**If complete-task fails:** Fix the underlying issue and retry until it succeeds.

---

## 🚀 PROJECT SETUP

### MCP Servers Available

1. **Filesystem** - File operations
2. **Context7** - Library documentation
3. **Supabase** - Database operations
4. **Sequential Thinking** - Complex problem solving

### Startup Checklist

1. Run `.claude/sequential/commands/understand-project`
2. Run `pnpm typecheck` and `pnpm lint` - FIX ANY ERRORS
3. For similar features: `.claude/sequential/commands/analyze-similar-features <feature-name>`

---

## 💻 DEVELOPMENT WORKFLOW

### Task Management Commands

- **Check current**: `.claude/sequential/commands/check-progress`
- **Start new**: `.claude/sequential/commands/start-task <issue-number>`
- **Complete**: `.claude/sequential/commands/complete-task`

### Phase 1: Understanding Requirements

1. **Read the GitHub issue USER STORY** - This contains:
   - User Story format (As a... I want... So that...)
   - Detailed Acceptance Criteria (Given/When/Then scenarios)
   - Implementation Requirements (Technical, UI/UX, Data, Testing)
   - Definition of Done checklist
   - Out of Scope items
2. **CRITICAL**: Read ALL test files - **TESTS ARE YOUR REAL REQUIREMENTS**
3. Branch will be created as `{issue-number}-sequential` by start-task command (e.g., `83-sequential`)
4. **FIX EXISTING ISSUES FIRST**: If typecheck or tests fail, fix them BEFORE starting your task
5. Review similar existing features for patterns

**Key Points:**

- GitHub issue = Complete requirements
- Acceptance Criteria = What to implement
- Test files = Verification of requirements
- FIX EXISTING ISSUES FIRST before starting new work

### Phase 2: TDD Implementation Loop (RED-GREEN-REFACTOR)

**REPEAT until `.claude/sequential/commands/validate-implementation` passes:**

#### Step 1: Optional Design Consultation

If you need architecture guidance:

```
Invoke architect consultant:
"I'm implementing [FEATURE] for TriBot.
Help me design [SPECIFIC ASPECT]"
```

#### Step 2: Write Tests FIRST (RED Phase) 🔴

**BEFORE ANY IMPLEMENTATION**, get tests written:

```
Invoke test-writer consultant:
"I need to implement [FEATURE] for TriBot.
Requirements: [describe expected behavior]
No code written yet. Write failing tests first for TDD."
```

- Commit these failing tests FIRST
- Run tests to see them fail (this is expected!)
- Tests define the specification

#### Step 3: Write FULL Implementation (GREEN Phase) 🟢

- **YOU write production ready code** to make tests pass
- Don't over-engineer
- Focus on making tests green
- **ALL CODE MUST BE PRODUCTION-READY** (proper error handling, no stubs)

#### Step 4: Refactor & Improve (REFACTOR Phase) 🔵

Now that tests pass, improve the code:

- Refactor for better structure
- Add proper error handling and loading states
- Ensure complete functionality - no stubs, no TODOs
- Optimize performance if needed
- **Tests must stay green during refactoring!**
- **PRODUCTION CHECKLIST:**
  - Can users navigate to this feature?
  - What happens on network failure?
  - Are all form inputs validated?
  - Does it work on mobile?
  - Are errors shown clearly to users?

#### Step 5: Validate TDD Practice

```bash
# Check that TDD was followed properly
.claude/sequential/commands/validate-tdd
```

#### Step 6: Run Full Validation

```bash
# This runs all quality checks
.claude/sequential/commands/validate-implementation
```

This checks:

- Linting and type checking
- All tests pass
- No stub implementations
- No TODOs or FIXMEs

#### Step 7: Fix ALL Issues (Not Just Task-Related)

- **Don't delegate fixes** - you understand the code best and no one will fix it for you
- **FIX EVERYTHING**: Even if an error isn't from your current task, FIX IT
- If tests fail anywhere, debug and fix them
- If type errors exist anywhere, fix them
- If you need help understanding a failure, **consult test-analyzer**
- Keep iterating until ALL validation passes
- **YOU OWN THE CODEBASE**: Don't skip problems because they're "not your task"
- **NO ONE WILL FIX PROBLEMS FOR YOU, YOU ARE THE SOLE PROPRIETER**

#### Step 8: Get Production Readiness Review 🔍

**MANDATORY before completion** - Get your code reviewed:

**Review Process:**

1. **Create/Update Review Request File:**

   ```bash
   # Create REVIEW-REQUEST-{task-id}.md with your implementation summary
   # Include: what you built, key decisions, areas to review
   # If this is a re-review after fixes, document what you changed
   ```

2. **Invoke Code Reviewer:**

   ```
   Invoke code-reviewer consultant:
   "Please review task #{task-id} for production readiness.
   I've created REVIEW-REQUEST-{task-id}.md with details."
   ```

3. **Review Results:**
   - The consultant will create/overwrite `REVIEW-RESULT-{task-id}.md`
   - Check the file for the verdict
   - If **"READY FOR PRODUCTION? YES"**: Continue to Step 9
   - If **"READY FOR PRODUCTION? NO"**:
     - Fix ALL blockers
     - Update your REVIEW-REQUEST file with what you fixed
     - Get another review (it will overwrite the RESULT file)

**CRITICAL RULES:**

- ✅ **YOU MAY** create/update `REVIEW-REQUEST-*.md` files
- ❌ **YOU MUST NEVER** create or modify `REVIEW-RESULT-*.md` files
- ❌ **YOU CANNOT** approve your own code
- ❌ **YOU CANNOT** work around review feedback - FIX ALL BLOCKERS
- ❌ **YOU CANNOT** argue with the reviewer - They are protecting production
- ✅ **Multiple reviews are OK** - each overwrites the previous result
- ✅ **FIX ALL BLOCKERS** - No exceptions, no workarounds, no excuses

The validation will check for a valid `REVIEW-RESULT-{task-id}.md` file with approval.

#### Step 9: Complete the Task

Run `.claude/sequential/commands/complete-task` (see Task Completion section above)

### Available Subagent Consultants

1. **architect** - Design guidance
2. **test-writer** - Write tests BEFORE implementing (TDD)
3. **implementer** - Algorithm optimization
4. **code-reviewer** - MANDATORY before complete-task
5. **test-analyzer** - Debug failing tests
6. **product-manager** - Requirements clarification

---

## 🛠️ TOOLS & COMMANDS

### Essential Commands

**Quality & Testing:**

- `.claude/lib/run-tests [path]` - Run unit tests
- `.claude/lib/run-lint [--fix]` - ESLint
- `.claude/lib/run-typecheck` - TypeScript check
- `.claude/lib/run-quality-checks` - All checks

**Git Operations:**

- `.claude/lib/git-add-safe` - Safe git add
- `.claude/lib/git-commit-safe` - Safe commit

**Task Management:**

- `.claude/sequential/commands/check-progress`
- `.claude/sequential/commands/start-task <issue>`
- `.claude/sequential/commands/complete-task`
- `.claude/sequential/commands/validate-implementation`
- `.claude/sequential/commands/validate-tdd`

### pnpm Syntax Note

**Pass flags directly without `--` separator:**

- ✅ `pnpm test --maxWorkers=2 --forceExit`
- ❌ `pnpm test -- --maxWorkers=2`

### Files to Never Commit

- `REVIEW-REQUEST-*.md` / `REVIEW-RESULT-*.md`
- `CLAUDE.md` (worktree-specific)
- `.mcp/config.json` / `.mcp.json`
- `*-guide.md` / `*-design.md`
- `docs/architecture/task-*`

---

## ✅ TESTING & QUALITY

### Code Quality Standards

**Automated Enforcement:**

- No `any` types → Use `unknown` + type guards
- No `@ts-ignore` or `eslint-disable`
- No `git add .` → Use specific paths
- Automatic Prettier formatting

**Critical Rules:**

- Handle null/undefined with optional chaining
- ES6 imports only (no `require()`)
- Explicit parameter types
- Initialize class properties

**Before Committing:**

- `pnpm typecheck` - Must show 0 errors
- `pnpm lint` - Must show 0 errors

### Test-Driven Development (TDD)

**RED-GREEN-REFACTOR Cycle:**

1. 🔴 RED: Write failing tests first (use test-writer consultant)
2. 🟢 GREEN: Write minimal code to pass tests
3. 🔵 REFACTOR: Improve while keeping tests green

**Rules:**

- Never skip or manipulate tests
- Fix failing tests by fixing implementation
- Both unit and E2E tests required
- Validate with `.claude/sequential/commands/validate-tdd`

---

## 🎯 CRITICAL REMINDERS

### The Four Non-Negotiables

1. **YOU OWN EVERYTHING** - Every line of code is YOUR responsibility. Fix what's broken anywhere.

2. **ALL TESTS MUST PASS** - 100% pass rate. No skipping. No excuses. Size/complexity/time are irrelevant.

3. **TESTS DEFINE REQUIREMENTS** - If a test expects it, BUILD IT. No exceptions.

4. **PRODUCTION-READY ONLY** - No mocks, stubs, TODOs, or "implement later".

### Before Marking Complete

Ask yourself:

- Can my mom use this feature?
- What happens when internet is slow?
- What if the user makes a mistake?
- Will this work on a phone?
- Can users find this feature?
- What if something goes wrong?

**If ANY answer is "no" - YOU ARE NOT DONE.**

### Remember

- **IMPLEMENT EVERYTHING** - Make it work FIRST, ask questions NEVER
- **NO BLOCKERS EXIST** - You have everything needed to complete any task
- **FIX ALL PROBLEMS** - Even if not part of your specific task
- **ALL TESTS MUST PASS** - 100% of unit AND E2E tests. NO EXCEPTIONS.
- **USE complete-task** - Never bypass this command
- **GET CODE REVIEW** - Mandatory before completion

**The codebase should be BETTER after you work on it, not just "task complete".**

### 🔴 FINAL WARNING 🔴

**Skipping tests is FORBIDDEN. Saying tests "don't affect core functionality" is UNACCEPTABLE.**
**You will implement FULL production code regardless of complexity, size, or time.**
**ALL means ALL. 100% means 100%. This is non-negotiable.**
