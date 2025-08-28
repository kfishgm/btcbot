# Start Agents Command

Start all claude agents with autonomous permissions in their respective worktrees.

## Prerequisites

- Tmux session must be running (`./.claude/commands/setup-tmux`)
- Agents must be set up (`/setup-agents`)
- Task must be assigned (`/next-task`)

## Usage

```bash
./.claude/commands/start-agents
```

## What it does

1. Starts claude with `--dangerously-skip-permissions` in each agent pane
2. Sends initial instructions to each agent
3. Agents will:
   - Read their TASK-\*.md files
   - Work autonomously within their worktrees
   - Coordinate through shared files and git

## Manual Start

If you prefer to start agents manually:

1. Switch to tmux: `tmux attach-session -t PROJECT-dev`
2. Navigate to agent window: `Ctrl+b 1`
3. In each pane, run: `claude --dangerously-skip-permissions`

## Agent Behavior

With the `--dangerously-skip-permissions` flag, agents can:

- ✅ Create and modify files in their worktree
- ✅ Run any development commands
- ✅ Install dependencies
- ✅ Read files from other worktrees
- ✅ Make git commits

But they cannot:

- ❌ Modify system files
- ❌ Access production credentials
- ❌ Push to main branch
- ❌ Run sudo commands

## Coordination

Agents coordinate through:

- TASK-\*.md files for status updates
- Checking sibling worktree directories
- Git commits to share work
- docs/agent-communication.md protocol