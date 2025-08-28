# Pipeline Workflow System - User Guide

## Table of Contents
1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [Understanding Modes](#understanding-modes)
4. [Daily Operations](#daily-operations)
5. [Mode Switching](#mode-switching)
6. [Monitoring & Status](#monitoring--status)
7. [Troubleshooting](#troubleshooting)
8. [Best Practices](#best-practices)

## Introduction

The Pipeline Workflow System orchestrates multi-agent development with two distinct modes:
- **Sequential Mode**: Traditional workflow where all agents work on the same task
- **Parallel Mode**: Pipeline workflow where agents work on different tasks simultaneously

## Getting Started

### Initial Setup
```bash
# 1. Initialize the pipeline
cd /path/to/project
./pipeline init

# 2. Check installation
./pipeline status

# 3. View current mode
./pipeline mode
```

### Quick Mode Selection
```bash
# Use traditional workflow (all agents same task)
./pipeline mode traditional

# Use pipeline workflow (agents on different tasks)
./pipeline mode pipeline

# Use test mode (for experimentation)
./pipeline mode test
```

## Understanding Modes

### Two-Dimensional Mode System

The pipeline has two independent dimensions:

#### 1. Orchestration Mode (How tasks are assigned)
- **`sequential`**: All agents work on the same task
- **`parallel`**: Each agent works on a different task

#### 2. Rollout Mode (What actions are taken)
- **`shadow`**: Monitor only, no real actions
- **`pilot`**: Selected tasks only
- **`production`**: All tasks automated

### Mode Combinations

| Command | Orchestration | Rollout | Use Case |
|---------|--------------|---------|----------|
| `mode traditional` | sequential | production | Classic TDD workflow |
| `mode pipeline` | parallel | production | Maximum throughput |
| `mode test` | parallel | pilot | Safe testing |
| `mode sequential` | sequential | (unchanged) | Just change orchestration |
| `mode production` | (unchanged) | production | Just change rollout |

## Daily Operations

### Starting Your Day

#### Option 1: Traditional Workflow
```bash
# 1. Set traditional mode
./pipeline mode traditional

# 2. Start the monitor
./pipeline monitor

# 3. Check status
./pipeline status
```

All agents will work on the current task from `.claude/current-task.txt`.

#### Option 2: Pipeline Workflow
```bash
# 1. Set pipeline mode
./pipeline mode pipeline

# 2. Start the monitor
./pipeline monitor

# 3. View task distribution
./pipeline status
```

Each agent will be assigned different tasks based on dependencies.

### During Development

#### Monitor Task Progress
```bash
# View current status
./pipeline status

# Watch logs in real-time
./pipeline logs

# Check specific agent
./pipeline agent-status
```

#### Handle Task Completion
In pipeline mode, the monitor automatically:
1. Detects when agents complete tasks
2. Assigns new tasks based on availability
3. Manages worktree updates
4. Coordinates supervisor merges

## Mode Switching

### Safe Mode Switching

The system protects your work:

```bash
# Switch to pipeline mode
./pipeline mode pipeline
# System will:
# 1. Check if agents are busy
# 2. Warn about potential work loss
# 3. Ask for confirmation
# 4. Gracefully transition
```

### Force Mode Switch
```bash
# If you need to force a switch
./switch-mode stop        # Stop all orchestration
./switch-mode sequential  # Start sequential mode
./switch-mode pipeline    # Start parallel mode
```

### Mode Detection
```bash
# Check current mode
./detect-mode

# Get mode programmatically
MODE=$(./detect-mode --mode)
if [ "$MODE" = "PIPELINE" ]; then
    echo "Pipeline mode active"
fi
```

## Monitoring & Status

### Status Command
```bash
./pipeline status
```

Shows:
- Current orchestration mode
- Current rollout mode
- Active tasks and assignments
- Agent states
- Queue contents

### Real-time Monitoring
```bash
# Start monitor in foreground
./pipeline monitor

# Or watch logs
tail -f .claude/pipeline/logs/pipeline.log
```

### Metrics
```bash
# View performance metrics
./pipeline status

# Check completion rates
grep "completed" .claude/pipeline/logs/pipeline.log | wc -l
```

## Troubleshooting

### Common Issues

#### 1. Mode Not Switching
```bash
# Check for running monitors
ps aux | grep -E "(monitor|pipeline)"

# Kill stuck processes
pkill -f "pipeline/commands/monitor"

# Restart
./pipeline monitor
```

#### 2. Agent Not Getting Tasks
```bash
# Check agent status
./pipeline agent-status

# Force sync
./pipeline agent-sync

# Check task queue
./pipeline status
```

#### 3. Tasks Stuck
```bash
# View detailed state
cat .claude/pipeline/state/pipeline-state.json | jq .

# Reset specific agent
./pipeline task unassign <agent>

# Reassign task
./pipeline task assign <agent> <task>
```

### Recovery Procedures

#### Reset to Clean State
```bash
# 1. Stop monitor
pkill -f "pipeline/commands/monitor"

# 2. Clear state (backup first!)
cp .claude/pipeline/state/pipeline-state.json .claude/pipeline/state/backup.json
./pipeline init --reset

# 3. Restart
./pipeline monitor
```

#### Switch to Safe Mode
```bash
# Use traditional workflow when in doubt
./pipeline mode traditional
```

## Best Practices

### 1. Mode Selection

**Use Sequential Mode When:**
- Working on complex, interdependent features
- Debugging issues that span multiple agents
- Training new team members
- Need predictable, linear workflow

**Use Parallel Mode When:**
- Working on multiple independent tasks
- Need maximum throughput
- Tasks have clear boundaries
- Team is experienced with the workflow

### 2. Gradual Rollout

Start conservatively:
```bash
# 1. Test in pilot mode
./pipeline mode test
./pipeline pilot add TASK-001
./pipeline pilot add TASK-002

# 2. Monitor results
./pipeline status
./pipeline logs

# 3. Expand gradually
./pipeline pilot add FEATURE-*

# 4. Move to production
./pipeline rollout check
./pipeline mode pipeline
```

### 3. Daily Workflow

**Morning Routine:**
1. Check current mode: `./pipeline mode`
2. Review task queue: `./pipeline status`
3. Start monitor: `./pipeline monitor`
4. Verify agents ready: `./pipeline agent-status`

**End of Day:**
1. Check agent status: `./pipeline agent-status`
2. Review completions: `./pipeline status`
3. Stop if needed: `pkill -f monitor`

### 4. Emergency Procedures

**If Things Go Wrong:**
```bash
# 1. Stop everything
./switch-mode stop

# 2. Check agent states
./pipeline agent-status

# 3. Return to safe mode
./pipeline mode traditional

# 4. Restart carefully
./pipeline monitor
```

## Advanced Usage

### Custom Mode Combinations
```bash
# Set specific combination
./pipeline mode set sequential pilot
./pipeline mode set parallel shadow
```

### Pilot Mode Management
```bash
# Enable pilot mode
./pipeline pilot start

# Add specific tasks
./pipeline pilot add TASK-001
./pipeline pilot add-pattern "FEATURE-*"

# Remove from pilot
./pipeline pilot remove TASK-001

# List pilot tasks
./pipeline pilot list
```

### Integration with CI/CD
```bash
# Check if safe to deploy
./pipeline rollout check

# Get metrics for reporting
./pipeline status --json | jq '.metrics'
```

## Summary

The Pipeline Workflow System provides flexible orchestration for multi-agent development:

1. **Choose Your Mode**: Sequential for simplicity, Parallel for speed
2. **Monitor Progress**: Real-time status and logging
3. **Switch Safely**: Built-in protections for mode changes
4. **Scale Gradually**: Pilot mode for safe testing

Remember: When in doubt, use `./pipeline mode traditional` for the familiar sequential workflow!