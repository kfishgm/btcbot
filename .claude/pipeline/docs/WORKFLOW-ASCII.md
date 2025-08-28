# GitHub Issues Pipeline - Complete Flow Diagram

## Overview: Label-Based Task Management System

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        GitHub Issues Pipeline Flow                               │
│                      (Label-Based State Management)                              │
└─────────────────────────────────────────────────────────────────────────────────┘

## 1. TASK CREATION & INITIAL STATE
════════════════════════════════════════════════════════════════════════════════════

GitHub Issue #123                              Labels: [task]
┌─────────────────────────┐
│ Title: User Registration│                    No agent labels yet
│ ----------------------- │                    Status: OPEN
│ Category: UI            │
│ Backlog Position: 15    │
│ Dependencies: None      │
└─────────────────────────┘

## 2. MONITOR CYCLE (every 30 seconds)
════════════════════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────────────────────┐
│                              github-monitor                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  for agent in [architect, test, implementation, supervisor]:                    │
│    ┌──────────────────────────────────────────────────────────────┐           │
│    │ 1. Check TASK file exists?                                   │           │
│    │    YES → Agent has work                                      │           │
│    │    NO  → Agent is idle                                       │           │
│    │                                                               │           │
│    │ 2. If has work:                                              │           │
│    │    - Check if Claude running (tmux pane check)               │           │
│    │    - If not: Start Claude with recovery message              │           │
│    │    - If idle: Send reminder                                  │           │
│    │                                                               │           │
│    │ 3. If idle:                                                  │           │
│    │    - Call github-task-scheduler.mjs next-task <agent>        │           │
│    │    - If task available and AUTO_ASSIGN=true:                 │           │
│    │      * Assign task                                           │           │
│    │      * Start new Claude instance                             │           │
│    └──────────────────────────────────────────────────────────────┘           │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘

## 3. TASK ASSIGNMENT FLOW
════════════════════════════════════════════════════════════════════════════════════

github-task-scheduler.mjs next-task architect
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ getNextTask('architect')                                            │
│                                                                      │
│ 1. Get all open issues with label "task"                           │
│ 2. Filter eligible tasks:                                           │
│    - Issue state == OPEN                                            │
│    - No assignees                                                   │
│    - Check dependencies satisfied                                   │
│    - For architect: NOT has_label('architect-done')                │
│ 3. Sort by backlog position                                         │
│ 4. Return first eligible task                                       │
└─────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
github-agent-interface.sh start architect 123
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 1. Add label: architect-wip                                         │
│ 2. Create TASK-123.md in architect worktree                        │
│ 3. Add comment: "🏗️ ARCHITECT agent starting work"                 │
└─────────────────────────────────────────────────────────────────────┘

## 4. AGENT WORK PROGRESSION
════════════════════════════════════════════════════════════════════════════════════

ARCHITECT PHASE                              Labels: [task, architect-wip]
┌─────────────┐
│   Claude    │ → Reads TASK-123.md
│  Architect  │ → Creates branch: 123-architect  
│   Agent     │ → Designs architecture
└─────────────┘
       │
       ▼ .claude/commands/task-complete
       │
┌──────────────────────────────────────────────────┐
│ task-complete-agent.sh                           │
│ 1. Push branch to origin                         │
│ 2. Remove label: architect-wip                   │
│ 3. Add label: architect-done                     │
│ 4. Add comment with branch info                  │
│ 5. Delete TASK-123.md                           │
└──────────────────────────────────────────────────┘
       │
       ▼
Issue #123                                   Labels: [task, architect-done]

TEST PHASE (auto-assigned by monitor)        Labels: [task, architect-done, test-wip]
┌─────────────┐
│   Claude    │ → Merges 123-architect
│    Test     │ → Creates branch: 123-test
│   Agent     │ → Writes comprehensive tests
└─────────────┘
       │
       ▼ task-complete
       │
Issue #123                                   Labels: [task, architect-done, test-done]

IMPLEMENTATION PHASE                         Labels: [task, architect-done, test-done, 
┌─────────────┐                                      implementation-wip]
│   Claude    │ → Merges 123-architect AND 123-test
│   Impl      │ → Creates branch: 123-implementation
│   Agent     │ → Implements to pass tests
└─────────────┘
       │
       ▼ task-complete
       │
Issue #123                                   Labels: [task, architect-done, test-done,
                                                     implementation-done]

## 5. SUPERVISOR COMPLETION FLOW
════════════════════════════════════════════════════════════════════════════════════

SUPERVISOR PHASE                             Labels: [task, architect-done, test-done,
┌─────────────┐                                      implementation-done, supervisor-wip]
│   Claude    │ 
│ Supervisor  │ → Runs complete-task orchestrator
│   Agent     │
└─────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ complete-task-utils.sh::complete_task_orchestrator()                     │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ 1. VERIFY PREREQUISITES                                                  │
│    └─ All agents have -done labels                                      │
│    └─ All branches exist                                                │
│                                                                          │
│ 2. MERGE BRANCHES                                                        │
│    └─ Create feature/123-complete from main                            │
│    └─ Merge origin/123-implementation (contains all work)              │
│                                                                          │
│ 3. RUN QUALITY GATE                                                      │
│    ├─ pnpm lint         (MUST PASS)                                    │
│    ├─ pnpm typecheck    (MUST PASS)                                    │
│    ├─ pnpm test         (MUST PASS)                                    │
│    └─ pnpm build        (MUST PASS)                                    │
│                                                                          │
│ 4. CREATE & MERGE PR                                                     │
│    ├─ Title: "123: User Registration"                                   │
│    ├─ Body includes: "Closes #123"                                      │
│    └─ gh pr merge --merge                                               │
│                                                                          │
│ 5. POST-MERGE ACTIONS                                                    │
│    ├─ Add label: supervisor-done         ← CRITICAL!                    │
│    ├─ Issue auto-closes (due to "Closes #123")                         │
│    └─ Clean up agent branches                                           │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘

Final State:
Issue #123                                   Labels: [task, architect-done, test-done,
Status: CLOSED                                       implementation-done, supervisor-done]

## 6. KEY SCRIPTS AND FUNCTIONS
════════════════════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────────────────────┐
│ github-task-scheduler.mjs                                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│ parseLabels(labels)        - Extract completion status from labels              │
│ getNextTask(agent)         - Find next eligible task for agent                 │
│ completeAgentWork(agent)   - Update labels when agent completes                │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────┐
│ issue-utils.sh                                                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│ has_label(issue, label)    - Check if issue has specific label                 │
│ is_task_ready_for(issue)   - Check if task ready for specific agent            │
│ create_task_file(issue)    - Create TASK-*.md assignment file                  │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────┐
│ complete-task-utils.sh                                                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│ verify_prerequisites()     - Ensure all agents complete & branches exist        │
│ merge_agent_branches()     - Merge implementation branch (contains all)         │
│ run_quality_gate()         - Execute all quality checks                        │
│ create_and_merge_pr()      - Create PR with "Closes #X" and merge              │
│ Add supervisor-done label  - AFTER PR merge to prevent reassignment            │
└─────────────────────────────────────────────────────────────────────────────────┘

## 7. LABEL TRANSITIONS
════════════════════════════════════════════════════════════════════════════════════

Initial:     [task]
     ↓
Architect:   [task, architect-wip] → [task, architect-done]
     ↓
Test:        [task, architect-done, test-wip] → [task, architect-done, test-done]
     ↓
Impl:        [task, architect-done, test-done, implementation-wip] 
             → [task, architect-done, test-done, implementation-done]
     ↓
Supervisor:  [task, architect-done, test-done, implementation-done, supervisor-wip]
             → [task, architect-done, test-done, implementation-done, supervisor-done]
             → Issue CLOSED

## 8. BRANCH STRATEGY
════════════════════════════════════════════════════════════════════════════════════

main
 │
 ├─→ 123-architect         (architect's work)
 │    │
 │    └─→ 123-test        (includes architect + test work)
 │         │
 │         └─→ 123-implementation  (includes all three agents' work)
 │              │
 │              └─→ feature/123-complete  (final branch for PR)
 │                   │
 └───────────────────┘ (merged back to main)

## 9. CRITICAL POINTS
════════════════════════════════════════════════════════════════════════════════════

⚠️  SUPERVISOR-DONE LABEL: Must be added AFTER PR merge to prevent reassignment
⚠️  BRANCH NAMING: Use issue number (123-architect) not task prefix  
⚠️  CLAUDE.md: Never commit agent-specific versions (use templates)
⚠️  QUALITY GATE: ALL checks must pass - no exceptions
⚠️  PR BODY: Must include "Closes #X" for auto-close
```