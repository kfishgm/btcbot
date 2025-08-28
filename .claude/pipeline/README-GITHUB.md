# GitHub Issues-based Pipeline

This is a simplified pipeline system that uses GitHub Issues as the single source of truth for task management.

## Key Benefits

1. **No State Sync Issues**: GitHub Issues is the only state
2. **Real-time Updates**: All agents see the same information
3. **Built-in History**: Comments and activity tracked automatically
4. **Simple CLI**: Uses GitHub CLI (`gh`) for all operations
5. **No Complex Recovery**: If something fails, just check GitHub

## Architecture

```
GitHub Issues (Source of Truth)
     |
     ├── Task Scheduler (reads issues)
     ├── Agent Interface (updates issues)
     └── Monitor (watches issues)
```

## Quick Start

### 1. Migrate Existing Tasks (One Time)

```bash
# This creates GitHub Issues from your tasks.md file
.claude/pipeline/commands/migrate-to-github
```

### 2. Start Monitor

```bash
# Basic monitoring
.claude/pipeline/commands/github-monitor start

# With auto-assignment (assigns tasks automatically)
.claude/pipeline/commands/github-monitor start --auto
```

### 3. Agent Commands

From any agent worktree:

```bash
# Check current task
task check

# See next available task
task next

# Start working on next task
task start

# Mark current task complete
task complete

# List all tasks
task list
```

## How It Works

1. **Tasks are GitHub Issues** with a specific format:
   - Title: `TASK-001: Description`
   - Labels: `task`, `architect-wip`, etc.
   - Body contains task details and branches

2. **Agents Update Issues** when they complete work:
   - Add `-done` label for their role
   - Add comment with branch name
   - Remove `-wip` label

3. **Pipeline Monitors Issues** to determine:
   - Which tasks need work
   - Which agent should work next
   - When all agent work is complete

## Task Flow

```
1. Issue created with task label only
2. Architect assigned → works → pushes branch → adds architect-done label
3. Test assigned → works → pushes branch → adds test-done label  
4. Implementation assigned → works → runs quality checks → creates PR → closes issue
```

## Example Issue

```markdown
Title: UI-001: User registration form

## Task: User registration form

Category: UI - User Interface

## Branches
- architect: ui-001-arch
- test: ui-001-test
- implementation: ui-001-implementation

## Status
Labels: task, architect-done, test-done, implementation-wip
```

## Troubleshooting

**Q: Agent not getting tasks?**
A: Check `gh issue list --label task` to see available tasks

**Q: Task stuck?**
A: Check the issue on GitHub - comments show what happened

**Q: How to reset a task?**
A: Remove the -done label for the agent that needs to redo work

**Q: Monitor not working?**
A: Make sure `gh auth status` shows you're logged in

## Comparison with Old System

| Old System | GitHub Issues System |
|------------|---------------------|
| state.json file | GitHub Issues |
| Complex state sync | Single source of truth |
| Branch detection | Label tracking |
| Recovery scripts | Just edit labels |
| Multiple queues | Issue labels |
| Agent status in JSON | Agent status from task files |

## Manual Operations

Everything can be done manually via GitHub:

```bash
# See all tasks
gh issue list --label task

# See task details
gh issue view 123

# Update task
gh issue edit 123 --add-label "architect-done"

# Comment on task
gh issue comment 123 --body "Architecture complete!"
```

This system is much simpler and more reliable than the previous state-based approach!