# Pipeline Workflow System

## Overview
The Pipeline Workflow System is an advanced multi-agent orchestration engine that supports both **sequential** (traditional) and **parallel** (pipeline) task execution modes. It provides seamless switching between workflows while maintaining quality and managing dependencies.

## Quick Start

```bash
# 1. Initialize the pipeline system
./pipeline init

# 2. Check current status
./pipeline status

# 3. View current mode
./pipeline mode

# 4. Start the monitor
./pipeline monitor

# 5. Switch modes
./pipeline mode traditional  # Sequential workflow
./pipeline mode pipeline     # Parallel workflow
```

## Two Orchestration Modes

### 1. Sequential Mode (Traditional)
All agents work on the **same task** in sequence:

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│ ARCHITECT   │ → │   TESTER    │ → │ IMPLEMENTER │ → │ SUPERVISOR  │
│  (Task A)   │   │  (Task A)   │   │  (Task A)   │   │  (Task A)   │
└─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘
      ↓                   ↓                  ↓                 ↓
   Design →           Tests →          Feature →           Merge
```

### 2. Parallel Mode (Pipeline)
Agents work on **different tasks** in parallel:

```
Time →
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│ ARCHITECT   │   │ ARCHITECT   │   │ ARCHITECT   │   │ ARCHITECT   │
│  (Task D)   │   │  (Task E)   │   │  (Task F)   │   │  (Task G)   │
└─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘
      ↓                   ↓                  ↓                 ↓
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│   TESTER    │   │   TESTER    │   │   TESTER    │   │   TESTER    │
│  (Task C)   │   │  (Task D)   │   │  (Task E)   │   │  (Task F)   │
└─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘
      ↓                   ↓                  ↓                 ↓
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│ IMPLEMENTER │   │ IMPLEMENTER │   │ IMPLEMENTER │   │ IMPLEMENTER │
│  (Task B)   │   │  (Task C)   │   │  (Task D)   │   │  (Task E)   │
└─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘
      ↓                   ↓                  ↓                 ↓
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│ SUPERVISOR  │   │ SUPERVISOR  │   │ SUPERVISOR  │   │ SUPERVISOR  │
│  (Task A)   │   │  (Task B)   │   │  (Task C)   │   │  (Task D)   │
└─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘
```

## Mode System

The pipeline uses a two-dimensional mode system:

### Orchestration Modes
- **`sequential`**: All agents work on same task (traditional workflow)
- **`parallel`**: Agents work on different tasks (pipeline workflow)

### Rollout Modes
- **`shadow`**: Monitor runs but takes no actions (testing only)
- **`pilot`**: Pipeline manages selected tasks (gradual rollout)
- **`production`**: Pipeline manages all tasks (full automation)

### Quick Presets
```bash
# Traditional workflow (sequential + production)
./pipeline mode traditional

# Pipeline workflow (parallel + production)
./pipeline mode pipeline

# Test mode (parallel + pilot)
./pipeline mode test
```

## Directory Structure

```
.claude/pipeline/
├── commands/              # Main pipeline commands
│   ├── init              # Initialize pipeline system
│   ├── status            # Show current status
│   ├── monitor           # Unified monitor (both modes)
│   ├── mode              # Mode management
│   ├── pilot             # Pilot mode operations
│   ├── rollout           # Production rollout
│   └── simulate          # Simulation for testing
├── lib/                  # Core libraries
│   ├── state-utils.sh    # State management
│   ├── task-scheduler.js # Task assignment logic
│   ├── agent-interface.sh# Agent communication
│   └── branch-manager.sh # Git branch operations
├── config/               # Configuration
│   └── pipeline.yaml     # Main config file
├── state/                # Runtime state
│   └── pipeline-state.json
├── logs/                 # Log files
│   └── pipeline.log
└── docs/                 # Documentation
    ├── user-guide.md
    └── architecture.md
```

## Core Features

### 1. **Unified Monitor**
- Single monitor supports both sequential and parallel modes
- Automatic mode detection and switching
- No downtime when changing modes

### 2. **Smart Task Assignment**
- **Sequential**: Reads from `.claude/current-task.txt`
- **Parallel**: Uses dependency-aware scheduling
- Automatic conflict prevention

### 3. **Agent Communication**
- Mode-aware task assignment
- Completion detection
- State synchronization
- Automatic worktree updates

### 4. **Safety Features**
- Agent busy detection before mode switches
- Graceful mode transitions
- State preservation across restarts
- Comprehensive logging

## Commands Reference

### Main Pipeline Command
```bash
# Show status
./pipeline status

# Manage modes
./pipeline mode               # Show current mode
./pipeline mode traditional   # Switch to traditional
./pipeline mode pipeline      # Switch to pipeline
./pipeline mode sequential    # Change orchestration only
./pipeline mode production    # Change rollout only

# Monitor operations
./pipeline monitor            # Start monitor
./pipeline logs              # View logs

# Pilot mode
./pipeline pilot start       # Enable pilot mode
./pipeline pilot add TASK-1  # Add task to pilot
./pipeline pilot list        # Show pilot tasks

# Agent operations
./pipeline agent-status      # Show agent status
./pipeline agent-sync        # Sync with agents
```

### Mode Detection & Switching
```bash
# Detect current mode
./.claude/commands/detect-mode

# Switch between modes (standalone)
./.claude/commands/switch-mode sequential
./.claude/commands/switch-mode pipeline
./.claude/commands/switch-mode stop
```

## Configuration

### Pipeline State (`state/pipeline-state.json`)
```json
{
  "version": "1.0.0",
  "mode": "production",          // Rollout mode
  "orchestration_mode": "parallel", // Or "sequential"
  "tasks": { ... },
  "agents": { ... },
  "queues": { ... }
}
```

### Mode Combinations
| Preset | Orchestration | Rollout | Use Case |
|--------|--------------|---------|----------|
| `traditional` | sequential | production | Classic workflow, all tasks |
| `pipeline` | parallel | production | Maximum throughput |
| `test` | parallel | pilot | Testing parallel workflow |
| Custom | Any | Any | Fine-tuned control |

## Workflow Integration

### For Agents
Agents automatically detect the current mode:
```bash
# In agent startup
MODE=$(.claude/commands/detect-mode --mode)
if [ "$MODE" = "PIPELINE" ]; then
  # Pipeline behavior
else
  # Sequential behavior
fi
```

### For Supervisor
The supervisor adapts based on mode:
- **Sequential Mode**: Runs `/transition-task` and `/setup-agents`
- **Pipeline Mode**: Only merges work, no orchestration

## Metrics and Monitoring

```bash
# View real-time status
./pipeline status

# Monitor logs
./pipeline logs

# Check metrics
tail -f .claude/pipeline/logs/pipeline.log
```

## Development Workflow

### 1. Start in Test Mode
```bash
./pipeline init
./pipeline mode test  # Parallel + pilot
./pipeline pilot add TASK-001
./pipeline monitor
```

### 2. Validate Results
```bash
./pipeline status
./pipeline agent-status
```

### 3. Expand to Production
```bash
./pipeline rollout check     # Verify readiness
./pipeline mode pipeline     # Full pipeline mode
```

### 4. Switch Back if Needed
```bash
./pipeline mode traditional  # Return to sequential
```

## Troubleshooting

### Common Issues

1. **Mode conflicts**
   ```bash
   ./pipeline mode show  # Check current state
   pkill -f "pipeline/commands/monitor"  # Stop monitor
   ./pipeline monitor    # Restart
   ```

2. **Agent synchronization**
   ```bash
   ./pipeline agent-sync
   ./pipeline agent-status
   ```

3. **Task assignment issues**
   ```bash
   ./pipeline task status
   ./pipeline task reassign <agent> <task>
   ```

## Safety & Best Practices

1. **Always check agent status before mode switches**
   - The system warns if agents are busy
   - Can force switch but may lose work

2. **Use pilot mode for testing**
   - Add specific tasks to pilot
   - Monitor results before full rollout

3. **Monitor logs during transitions**
   - Mode changes are logged
   - Agent notifications tracked

4. **State preservation**
   - State persists across restarts
   - Can resume after crashes

## Future Enhancements

- [ ] Web UI for monitoring
- [ ] Advanced dependency resolution
- [ ] Performance analytics
- [ ] Automatic rollback on errors
- [ ] Multi-project support

---

**Current Status**: Full implementation complete with both sequential and parallel modes. Production ready.