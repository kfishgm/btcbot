# Sequential Workflow Commands

This directory contains commands for the sequential workflow system.

## Commands

### Setup Commands

- `setup-sequential` - Create worktree and prepare environment
- `setup-tmux` - Start tmux session with orchestrator

### Task Management

- `start-task <issue>` - Begin working on a GitHub issue
- `check-progress` - Check current task status and labels  
- `mark-agent <task> <agent> <status>` - Update agent labels (wip/done)
- `complete-task [task-id]` - Complete task, merge PR, and cleanup
- `abort-task` - Cancel current task

### Control Commands

- `monitor` - Monitor orchestrator health and restart if needed
- `kill-orchestrator` - Stop orchestrator Claude process

## Quick Start

### 1. Initial Setup

```bash
# Create sequential worktree and environment
.claude/sequential/commands/setup-sequential
```

This creates:
- Git worktree at `../project-seq`
- Copies all necessary files and configurations
- Installs dependencies

### 2. Start Orchestrator

```bash
# Start orchestrator in tmux
.claude/sequential/commands/setup-tmux
```

The orchestrator will:
- Check for open GitHub issues with task label
- Invoke subagents sequentially using Task tool
- Track progress with agent-specific labels

## Workflow

1. Orchestrator checks for tasks
2. `start-task <issue>` - Begin work
3. Invoke subagents via Task tool
4. Track progress with labels
5. `complete-task` - Finish and merge

## Tmux Session Layout

**Window 0: Orchestrator**
- Pane 0: Claude orchestrator agent
- Pane 1: Monitor process

**Window 1: Services**  
- Pane 0: Dev server (port 3001)
- Pane 1: Test watcher
- Pane 2: Git status
- Pane 3: Supabase

## Label Management

Labels track agent progress:
- `sequential-wip` - Task in progress
- `architect-wip/done` - Architect status
- `test-writer-wip/done` - Test writer status
- `implementer-wip/done` - Implementer status
- `code-reviewer-wip/done` - Code reviewer status

## Troubleshooting

### Orchestrator Not Running

```bash
# Check if Claude is running
ps aux | grep claude

# Check tmux session
tmux list-sessions

# Restart orchestrator
tmux kill-session -t project-seq
.claude/sequential/commands/setup-tmux
```

### Task Stuck

```bash
# Check current progress
.claude/sequential/commands/check-progress

# Abort if needed
.claude/sequential/commands/abort-task

# Or manually clean labels
gh issue edit <task> --remove-label sequential-wip
```

### Quality Checks Failed

Before `complete-task` can merge:
- `pnpm lint` must pass
- `pnpm typecheck` must pass
- `pnpm test` must pass
- `pnpm test:e2e:chromium` must pass

## Project-Agnostic Design

All scripts dynamically detect:
- Project name from directory
- Worktree paths
- Session names

No hardcoded project names or paths.