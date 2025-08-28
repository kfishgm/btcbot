# GitHub Issues Pipeline System Flow Chart

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            MONITOR LOOP (every 30 seconds)                        │
│                          github-monitor start --auto                              │
└─────────────────────────────────────────────┬───────────────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 1. LIST ALL TASKS                                                                │
│    github-task-scheduler.mjs list                                                │
│    └─ Shows all open issues with task label                                      │
└─────────────────────────────────────────────┬───────────────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 2. CHECK EACH AGENT (architect, test, implementation, supervisor)                 │
└─────────────────────────────────────────────┬───────────────────────────────────┘
                                              │
                                              ▼
                    ┌─────────────────────────┴─────────────────────────┐
                    │ 2a. GET AGENT STATUS                              │
                    │     github-agent-interface.sh status              │
                    │     └─ check_agent_status()                       │
                    │         ├─ Sources issue-utils.sh                 │
                    │         ├─ Looks for TASK-*.md files             │
                    │         ├─ If TASK file exists:                  │
                    │         │   └─ Checks is_agent_work_complete()   │
                    │         │       ├─ If complete: removes TASK file│
                    │         │       │   and returns "idle"           │
                    │         │       └─ If not: returns "working"     │
                    │         ├─ Returns "idle" if no TASK file        │
                    │         └─ Returns "ERROR" if multiple files     │
                    └─────────────────────────┬─────────────────────────┘
                                              │
                    ┌─────────────────────────┴─────────────────────────┐
                    │          Agent Status Decision Tree               │
                    └─────────────────────────┬─────────────────────────┘
                                              │
                ┌─────────────────────────────┴─────────────────────────────┐
                │                                                           │
                ▼                                                           ▼
┌───────────────────────────────┐                         ┌────────────────────────────────┐
│ Status: "working on task #N"   │                         │ Status: "idle"                 │
└───────────────┬───────────────┘                         └────────────┬───────────────────┘
                │                                                       │
                ▼                                                       ▼
┌───────────────────────────────┐                         ┌────────────────────────────────┐
│ 2b. CHECK IF CLAUDE RUNNING   │                         │ 2c. GET NEXT AVAILABLE TASK    │
│     tmux check pane command   │                         │     github-task-scheduler.mjs  │
│     ├─ If "node": check idle  │                         │     next-task <agent>          │
│     │   └─ check-agent-idle   │                         └────────────┬───────────────────┘
│     │       ├─ Idle: remind   │                                      │
│     │       └─ Active: skip   │                                      │
│     └─ If not: start Claude   │                                      │
│         with recovery message │                                      │
└───────────────────────────────┘                                      │
                                                                        ▼
                                                         ┌──────────────────────────────────┐
                                                         │ next-task LOGIC:                 │
                                                         │ 1. Get all OPEN tasks            │
                                                         │ 2. Filter by dependencies:       │
                                                         │    - Architect: no deps          │
                                                         │    - Test: needs architect ✓     │
                                                         │    - Impl: needs arch ✓ + test ✓ │
                                                         │    - Super: needs all 3 ✓        │
                                                         │ 3. Check labels:                 │
                                                         │    - Skip if agent-done label    │
                                                         │ 4. Return first eligible task    │
                                                         └────────────┬─────────────────────┘
                                                                      │
                                                  ┌───────────────────┴────────────────────┐
                                                  │                                        │
                                                  ▼                                        ▼
                                    ┌─────────────────────────┐          ┌──────────────────────────┐
                                    │ "No eligible tasks"     │          │ Task #N available        │
                                    │ → Continue to next agent│          └──────────┬───────────────┘
                                    └─────────────────────────┘                     │
                                                                                    ▼
                                                                    ┌───────────────────────────────┐
                                                                    │ 2d. AUTO-ASSIGN TASK          │
                                                                    │ if AUTO_ASSIGN=true           │
                                                                    └───────────────┬───────────────┘
                                                                                    │
                                                                                    ▼
                                                                    ┌───────────────────────────────┐
                                                                    │ CHECK FOR EXISTING TASK FILE  │
                                                                    │ ls worktree/TASK-*.md         │
                                                                    └───────────────┬───────────────┘
                                                                                    │
                                                    ┌───────────────────────────────┴───────────────────┐
                                                    │                                                   │
                                                    ▼                                                   ▼
                                    ┌───────────────────────────────┐                   ┌───────────────────────────┐
                                    │ Has TASK file                 │                   │ No TASK file              │
                                    │ → Skip (already has task)     │                   │ → Proceed with assignment │
                                    └───────────────────────────────┘                   └───────────┬───────────────┘
                                                                                                    │
                                                                                                    ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 3. ASSIGN TASK TO AGENT                                                                                            │
│    github-agent-interface.sh start <agent> <task>                                                                  │
│    └─ start_agent_task()                                                                                           │
│        ├─ 1. setup-single-agent <agent> - Clean worktree, regenerate CLAUDE.md, copy .gitignore                   │
│        ├─ 2. Clean any old TASK files                                                                             │
│        ├─ 3. Create new TASK-N.md file in worktree                                                                │
│        ├─ 4. Create git branch (task-id-agent)                                                                    │
│        └─ 5. Kill existing Claude and start fresh with task assignment message                                    │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

                                            AGENT WORKFLOW (in Claude)
                                                        │
                                                        ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 1. AGENT STARTS                                                                                                    │
│    Claude reads CLAUDE.md with role-specific instructions                                                          │
│    └─ Sees instruction to run: .claude/lib/check-agent-startup <role>                                             │
└───────────────────────────────────────────────┬───────────────────────────────────────────────────────────────────┘
                                                │
                                                ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 2. CHECK STARTUP STATUS                                                                                            │
│    .claude/lib/check-agent-startup <role>                                                                          │
│    └─ Checks if AGENT_WORK_ALREADY_COMPLETE=true                                                                   │
│        ├─ If true: Skip to step 5 (task-complete)                                                                 │
│        └─ If false: Continue with work                                                                            │
└───────────────────────────────────────────────┬───────────────────────────────────────────────────────────────────┘
                                                │
                                                ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 3. READ TASK FILE                                                                                                  │
│    cat TASK-*.md                                                                                                   │
│    └─ Contains: issue number, branch name, instructions                                                           │
└───────────────────────────────────────────────┬───────────────────────────────────────────────────────────────────┘
                                                │
                                                ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 4. DO THE WORK                                                                                                     │
│    ├─ Architect: Design and create schemas                                                                        │
│    ├─ Test: Write comprehensive tests                                                                              │
│    ├─ Implementation: Make tests pass                                                                              │
│    └─ Supervisor: Merge all branches, ensure quality                                                              │
│                                                                                                                    │
│    Git workflow:                                                                                                   │
│    ├─ source .claude/lib/git-utils.sh                                                                              │
│    ├─ safe_add .  (excludes CLAUDE.md, TASK-*.md, .mcp/config.json)                                               │
│    └─ safe_commit "role: complete task #N"                                                                        │
└───────────────────────────────────────────────┬───────────────────────────────────────────────────────────────────┘
                                                │
                                                ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 5. COMPLETE TASK                                                                                                   │
│    .claude/commands/task-complete                                                                                  │
│    └─ Sources: issue-utils.sh, git-utils.sh                                                                       │
│        ├─ Check if label already exists (is_agent_work_complete)                                                  │
│        │   └─ If yes: Just cleanup and exit                                                                       │
│        ├─ Push branch to origin                                                                                    │
│        ├─ github-agent-interface.sh complete <agent> <issue> <branch>                                             │
│        │   └─ github-task-scheduler.mjs complete <agent> <issue> <branch>                                         │
│        │       └─ completeAgentWork()                                                                             │
│        │           ├─ Removes -wip label and adds -done label for agent                                            │
│        │           └─ Adds comment with completion and branch info                                                  │
│        ├─ Remove TASK-*.md file                                                                                   │
│        └─ Kill Claude (3x Ctrl+C) to exit                                                                         │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

                                        SOLUTION IMPLEMENTED
                                                │
                                                ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ IMPROVEMENTS MADE:                                                                                                  │
│                                                                                                                    │
│ 1. CHECK_AGENT_STATUS() NOW:                                                                                      │
│    - Sources issue-utils.sh for label checking                                                                    │
│    - When TASK file exists, checks is_agent_work_complete()                                                       │
│    - If -done label exists but TASK file remains: removes TASK file and returns "idle"                           │
│    - Enables immediate assignment of new tasks                                                                    │
│                                                                                                                    │
│ 2. MONITOR IMPROVEMENTS:                                                                                           │
│    - Removed aggressive process cleanup (no more killing tmux/agents)                                             │
│    - Removed cleanup-closed-tasks.sh (agents handle their own cleanup)                                            │
│    - Stateless operation - relies only on GitHub Issues as source of truth                                        │
│    - Recovery messages for idle agents with tasks                                                                 │
│    - Uses check-agent-idle script to detect actual idle state (no "esc to interrupt")                             │
│    - Only sends idle reminders when Claude is truly idle, not actively working                                    │
│                                                                                                                    │
│ 3. GIT SAFETY:                                                                                                     │
│    - Agents use safe_add instead of git add .                                                                     │
│    - Multiple layers prevent TASK file commits                                                                    │
│    - .gitignore copied to all worktrees                                                                           │
│    - CLAUDE.md preserved during merges                                                                            │
│                                                                                                                    │
│ 4. PARALLEL EXECUTION:                                                                                             │
│    - Architect: Any open task                                                                                      │
│    - Test: Tasks where architect-done label exists                                                                │
│    - Implementation: Tasks where architect-done AND test-done labels exist                                         │
│    - Supervisor: Tasks where all three -done labels exist                                                          │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## System Flow Summary:

1. **Monitor continuously checks** GitHub Issues and agent status
2. **Automatic cleanup** of stale TASK files when work is complete
3. **Immediate task assignment** when agents become idle
4. **Safe git operations** prevent system file commits
5. **True parallel execution** with proper dependency management