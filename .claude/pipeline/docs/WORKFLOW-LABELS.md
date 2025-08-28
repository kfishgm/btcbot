# GitHub Issues Pipeline - Label-Based Workflow

## Overview

The btcbot pipeline uses GitHub Issues with labels to track task progress. This document explains the complete workflow using labels instead of checkboxes.

## Label System

### Progress Labels

Each agent has two labels to track their work status:

- **`architect-wip`** / **`architect-done`** - Architecture phase
- **`test-wip`** / **`test-done`** - Testing phase  
- **`implementation-wip`** / **`implementation-done`** - Implementation phase (includes quality checks and PR)

### Other Labels

- **`task`** - Identifies an issue as a pipeline task
- **`priority:P0`** to **`priority:P3`** - Task priority (optional)

## Complete Task Flow

### 1. Task Creation

When a task is created (via `backlog-add`, `backlog-generate`, or `github-task-scheduler.mjs`):

```markdown
## Task: User registration form

Category: UI - User Interface

## Branches
_Branches will be listed here as work progresses_

## Dependencies
_No dependencies_

## Acceptance Criteria
- User can enter email and password
- Form validates input
- Success redirects to dashboard

## Metadata
Backlog Position: 15
```

**Initial State:**
- Labels: `task`
- No agent labels yet

### 2. Architect Phase

**Assignment:**
```bash
github-task-scheduler.mjs assign architect 123
```
- Adds `architect-wip` label
- Creates `TASK-123.md` in architect worktree
- Architect creates branch `123-architect`

**Completion:**
```bash
.claude/commands/task-complete
```
- Removes `architect-wip` label
- Adds `architect-done` label
- Adds comment: "✅ ARCHITECT work completed\nBranch: 123-architect"

### 3. Test Phase

**Eligibility Check:**
```javascript
// In parseLabels()
if (labels.includes('architect-done') && !labels.includes('test-done')) {
  // Task is ready for test agent
}
```

**Assignment:**
- Adds `test-wip` label
- Creates `TASK-123.md` in test worktree
- Test agent merges `123-architect` branch
- Creates branch `123-test`

**Completion:**
- Removes `test-wip` label
- Adds `test-done` label
- Adds comment with branch info

### 4. Implementation Phase

**Eligibility Check:**
```javascript
if (labels.includes('architect-done') && 
    labels.includes('test-done') && 
    !labels.includes('implementation-done')) {
  // Task is ready for implementation
}
```

**Assignment:**
- Adds `implementation-wip` label
- Merges both `123-architect` and `123-test` branches
- Creates branch `123-implementation`

**Completion:**
- Removes `implementation-wip` label
- Adds `implementation-done` label

### 5. Implementation Completes Task

**After implementation, the implementer runs:**
```bash
.claude/commands/complete-task
```

**Completion Flow:**
1. Runs quality checks (lint, typecheck, test, build)
2. Fixes any issues found
3. Creates PR: "#123: User registration form"
4. PR body includes "Closes #123"
5. Merges PR to main
6. Issue automatically closes due to "Closes #123"
7. `implementation-done` label is already set

## Key Functions

### issue-utils.sh

```bash
# Check if issue has a specific label
has_label() {
    local issue="$1"
    local label="$2"
    gh issue view "$issue" --json labels -q '.labels[].name' | grep -q "^${label}$"
}

# Check if task is ready for agent
is_task_ready_for() {
    case "$agent" in
        architect)
            ! has_label "$issue" "architect-done"
            ;;
        test)
            has_label "$issue" "architect-done" && ! has_label "$issue" "test-done"
            ;;
        implementation)
            has_label "$issue" "architect-done" && \
            has_label "$issue" "test-done" && \
            ! has_label "$issue" "implementation-done"
            ;;
    esac
}

# Check if agent's work is complete
is_agent_work_complete() {
    has_label "$issue" "${agent}-done"
}
```

### github-task-scheduler.mjs

```javascript
// Parse completion status from labels
parseLabels(labels = []) {
  const status = {
    architect: false,
    test: false,
    implementation: false
  };

  labels.forEach(label => {
    const labelName = typeof label === 'string' ? label : label.name;
    if (labelName === 'architect-done') status.architect = true;
    if (labelName === 'test-done') status.test = true;
    if (labelName === 'implementation-done') status.implementation = true;
  });

  return status;
}

// Mark agent work complete
completeAgentWork(agentRole, issueNumber, branchName) {
  // Remove WIP label and add done label
  this.gh(`issue edit ${issueNumber} --remove-label "${agentRole}-wip" --add-label "${agentRole}-done"`);
  
  // Add completion comment
  this.gh(`issue comment ${issueNumber} --body "✅ ${agentRole.toUpperCase()} work completed\\nBranch: ${branchName}"`);
}
```

## Monitor Behavior

The GitHub monitor (`github-monitor`) checks agent status every 30 seconds:

1. **For each agent:**
   - Check if TASK file exists → agent has work
   - Check if -done label exists → work might be complete
   - If both exist → clean up TASK file (work already done)
   - If neither → agent is idle, check for available tasks

2. **Task eligibility** is determined by labels:
   - No duplicate assignments (checks -wip labels)
   - Correct sequence (architect → test → implementation)
   - No reassignment of completed work (checks -done labels)

## Manual Operations

### Reset an Agent's Work
```bash
# Remove the done label to allow agent to redo work
gh issue edit 123 --remove-label "architect-done"
```

### Force Complete a Phase
```bash
# Add done label manually
gh issue edit 123 --add-label "test-done"

# Add comment for tracking
gh issue comment 123 --body "Manually marked test phase complete"
```

### Check Task Status
```bash
# View all labels on an issue
gh issue view 123 --json labels

# Check specific label
gh issue view 123 --json labels -q '.labels[].name' | grep "architect-done"
```

## Benefits of Label System

1. **Atomic Operations** - Adding/removing labels is atomic
2. **Query-able** - Can filter issues by labels in GitHub UI
3. **Visible** - Labels show in issue lists
4. **Reliable** - No parsing of issue body text
5. **Auditable** - Label changes are tracked in issue history

## Troubleshooting

**Q: Agent not picking up work?**
- Check if previous agents have -done labels
- Ensure no -wip label for that agent
- Verify issue is open and has `task` label

**Q: Task stuck in progress?**
- Check for -wip label without corresponding -done
- Look for stale TASK files in worktrees
- Review issue comments for errors

**Q: Implementation not completing task?**
- Ensure implementation runs `complete-task` after implementing
- Check that PR includes "Closes #X" to auto-close issue
- Verify quality checks are passing