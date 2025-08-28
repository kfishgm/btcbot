# Pipeline Workflow System - Architecture

## Overview

The Pipeline Workflow System is a sophisticated orchestration engine that manages multi-agent software development workflows. It supports both traditional sequential workflows and modern parallel pipeline workflows through a unified architecture.

## Core Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        Pipeline Monitor                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │
│  │   Mode      │  │   State     │  │   Task Scheduler    │   │
│  │  Manager    │  │  Manager    │  │                     │   │
│  └─────────────┘  └─────────────┘  └─────────────────────┘   │
│         │                 │                    │               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              Orchestration Engine                        │  │
│  │  ┌──────────────┐              ┌──────────────┐        │  │
│  │  │  Sequential  │              │   Parallel   │        │  │
│  │  │    Mode      │              │     Mode     │        │  │
│  │  └──────────────┘              └──────────────┘        │  │
│  └─────────────────────────────────────────────────────────┘  │
│                              │                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                  Agent Interface                         │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌───────────┐ │  │
│  │  │Architect│  │ Tester  │  │Implement│  │Supervisor │ │  │
│  │  └─────────┘  └─────────┘  └─────────┘  └───────────┘ │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

#### Sequential Mode
```
current-task.txt → Monitor → All Agents (same task) → Supervisor → Transition
     ↑                                                                    │
     └────────────────────────────────────────────────────────────────────┘
```

#### Parallel Mode
```
Task Queue → Scheduler → Agent Assignment → Completion Detection → Next Task
    ↑                                                                   │
    └───────────────────────────────────────────────────────────────────┘
```

## Mode System

### Two-Dimensional Configuration

```yaml
# Orchestration Mode (HOW tasks are assigned)
orchestration_mode: sequential | parallel

# Rollout Mode (WHAT actions are taken)
mode: shadow | pilot | production
```

### Mode State Machine

```
┌─────────────┐     switch      ┌─────────────┐
│ Sequential  │ ←─────────────→ │  Parallel   │
│    Mode     │                 │    Mode     │
└─────────────┘                 └─────────────┘
      │                               │
      │         ┌─────────┐          │
      └────────→│ Unified │←─────────┘
                │ Monitor │
                └─────────┘
                     │
      ┌──────────────┼──────────────┐
      ↓              ↓              ↓
┌──────────┐  ┌──────────┐  ┌──────────┐
│  Shadow  │  │  Pilot   │  │Production│
└──────────┘  └──────────┘  └──────────┘
```

## Key Components

### 1. Pipeline Monitor (`commands/monitor`)

The unified monitor that handles both modes:

```javascript
monitor_loop() {
    state = load_state()
    orchestration_mode = state.orchestration_mode || "parallel"
    
    if (orchestration_mode === "sequential") {
        state = monitor_sequential(state)
    } else {
        state = monitor_parallel(state)
    }
    
    update_metrics(state)
    save_state(state)
}
```

### 2. State Management (`lib/state-utils.sh`)

Centralized state management with atomic operations:

```json
{
  "version": "1.0.0",
  "orchestration_mode": "parallel",
  "mode": "production",
  "tasks": {
    "TASK-001": {
      "id": "TASK-001",
      "status": "arch_wip",
      "assigned_to": "architect",
      "created_at": "2024-07-24T10:00:00Z"
    }
  },
  "agents": {
    "architect": {
      "status": "working",
      "current_task": "TASK-001"
    }
  },
  "queues": {
    "unassigned": ["TASK-002", "TASK-003"],
    "completed": []
  }
}
```

### 3. Task Scheduler (`lib/task-scheduler.js`)

Intelligent task assignment with dependency resolution:

```javascript
// Sequential Mode
function getNextTaskSequential(agent) {
    const currentTask = readCurrentTask()
    if (agent.currentTask !== currentTask) {
        return currentTask
    }
    return null
}

// Parallel Mode
function getNextTaskParallel(agent) {
    const eligible = tasks.filter(task => 
        canAssign(task, agent) && 
        !hasConflicts(task, activeTask)
    )
    return prioritize(eligible)[0]
}
```

### 4. Agent Interface (`lib/agent-interface.sh`)

Communication layer between pipeline and agents:

```bash
# Start agent on task
start_agent() {
    local agent=$1
    local task=$2
    
    # Update worktree
    update_worktree $agent
    
    # Create task file
    create_task_file $agent $task
    
    # Notify agent via tmux
    notify_agent $agent "New task: $task"
}

# Check completion
check_complete() {
    local agent=$1
    local task=$2
    
    # Check for completion marker
    grep -q "## Status: COMPLETED ✅" $agent_dir/TASK-*.md
}
```

## Workflow Implementations

### Sequential Workflow

1. **Task Reading**
   ```bash
   current_task=$(cat .claude/current-task.txt)
   ```

2. **Agent Assignment**
   - All agents assigned same task
   - Maintains traditional arch→test→impl flow

3. **Completion Detection**
   - Waits for all agents to complete
   - Supervisor handles merge and transition

### Parallel Workflow

1. **Task Queue Management**
   ```javascript
   queues: {
       unassigned: [],    // New tasks
       architect: [],     // Agent-specific queues
       test: [],
       implementation: [],
        blocked: [],       // Dependency blocked
       completed: []      // Done
   }
   ```

2. **Dependency Resolution**
   - Tasks have prerequisites
   - Scheduler ensures proper ordering
   - Prevents conflicts

3. **Pipeline Stages**
   ```
   Stage 1: architect(TASK-D), test(TASK-C), impl(TASK-B), super(TASK-A)
   Stage 2: architect(TASK-E), test(TASK-D), impl(TASK-C), super(TASK-B)
   ```

## Safety Mechanisms

### 1. Mode Switching Protection
```bash
check_agents_busy() {
    for agent in arch test impl; do
        if task_in_progress $agent; then
            warn "Agent $agent has work in progress"
            return 1
        fi
    done
}
```

### 2. State Consistency
- Atomic state updates via file locking
- Transaction log for recovery
- Validation before state changes

### 3. Graceful Degradation
```javascript
try {
    executeTask()
} catch (error) {
    if (canRecover(error)) {
        retryWithBackoff()
    } else {
        markTaskBlocked()
        notifySupervisor()
    }
}
```

## Performance Optimizations

### 1. Efficient State Updates
- Only write changed portions
- Batch updates when possible
- Use jq for atomic JSON updates

### 2. Smart Polling
```bash
MONITOR_INTERVAL=30  # Default
# Adjust based on activity
if [ $active_tasks -eq 0 ]; then
    MONITOR_INTERVAL=60  # Slow when idle
elif [ $active_tasks -gt 3 ]; then
    MONITOR_INTERVAL=15  # Fast when busy
fi
```

### 3. Resource Management
- Process cleanup after task completion
- Worktree management
- Log rotation

## Extension Points

### 1. Custom Task Schedulers
```javascript
// Implement your own scheduling logic
class PriorityScheduler extends TaskScheduler {
    getNextTask(agent) {
        // Custom logic here
    }
}
```

### 2. Agent Plugins
```bash
# Add custom agent types
AGENT_TYPES="architect test implementation custom"
```

### 3. Mode Extensions
```javascript
// Add new orchestration modes
orchestration_modes: {
    sequential: sequentialHandler,
    parallel: parallelHandler,
    hybrid: hybridHandler  // Custom mode
}
```

## Integration Points

### 1. Git Integration
- Branch management per task
- Automatic worktree updates
- Conflict detection

### 2. CI/CD Integration
```bash
# Pre-deployment check
./pipeline rollout check

# Export metrics
./pipeline status --json > metrics.json
```

### 3. Monitoring Integration
- Prometheus metrics export
- Log aggregation support
- Health check endpoints

## Future Architecture

### Planned Enhancements

1. **Distributed Execution**
   - Multi-machine agent support
   - Network-based communication
   - Distributed state management

2. **Advanced Scheduling**
   - ML-based task prediction
   - Resource-aware assignment
   - Dynamic priority adjustment

3. **Enhanced Safety**
   - Automatic rollback
   - Canary deployments
   - A/B testing support

## Summary

The Pipeline Workflow System architecture provides:
- **Flexibility**: Support for multiple workflow styles
- **Safety**: Protected mode switching and state management
- **Performance**: Optimized for both sequential and parallel execution
- **Extensibility**: Clear extension points for customization

The unified monitor design ensures seamless transitions between modes while maintaining system integrity and performance.