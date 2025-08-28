---
allowed-tools: Bash(*), Task(*), Read(*), TodoWrite(*)
description: Fix ESLint errors in parallel using subagents
argument-hint: [max-agents] [--auto-fix] (default: 10 agents)
---

# Fix ESLint Errors in Parallel

## Context
- Current ESLint issues: !`timeout 30s pnpm lint 2>&1 | grep -E "error|warning" | wc -l || echo 0`
- Working directory: !`pwd`

## Task

I'll help you fix ESLint errors by distributing them across multiple subagents for parallel processing.

### Step 1: Run the parallel lint fix script

```bash
# Parse arguments
ARGS="${ARGUMENTS:-}"
MAX_AGENTS="10"
AUTO_FIX=""

# Check if --auto-fix is in arguments
if [[ "$ARGS" =~ --auto-fix ]]; then
    AUTO_FIX="--auto-fix"
    # Remove --auto-fix from args to get max agents
    ARGS=$(echo "$ARGS" | sed 's/--auto-fix//g' | xargs)
fi

# Extract max agents number if provided
if [[ "$ARGS" =~ ^[0-9]+$ ]]; then
    MAX_AGENTS="$ARGS"
fi

# Run the fix-lint-parallel script
echo "Running ESLint error analysis with max $MAX_AGENTS agents..."
if [ -n "$AUTO_FIX" ]; then
    echo "Will run auto-fix first for formatting issues..."
fi

OUTPUT=$(./.claude/commands/fix-lint-parallel --max-agents "$MAX_AGENTS" $AUTO_FIX 2>&1)
echo "$OUTPUT"

# Extract the work directory from output
WORK_DIR=$(echo "$OUTPUT" | grep "Work directory saved to:" | sed 's/.*Work directory saved to: //' | tr -d '\r\n')

if [ -z "$WORK_DIR" ]; then
    echo "ERROR: Could not find work directory in output"
    exit 1
fi

echo "Work directory: $WORK_DIR"

# Extract number of agents from output
ACTUAL_AGENTS=$(echo "$OUTPUT" | grep "Distributing work among" | sed 's/.*among \([0-9]*\) agents.*/\1/')

if [ -z "$ACTUAL_AGENTS" ]; then
    echo "ERROR: Could not determine number of agents"
    exit 1
fi

echo "Number of agents to launch: $ACTUAL_AGENTS"
```

### Step 2: Read ALL task files and launch subagents

**IMPORTANT**: Launch agents based on the number requested:

- **If 10 or fewer agents**: Launch all agents simultaneously in a single message with multiple tool uses
- **If more than 10 agents**: Launch in batches of 10 in parallel
  - First launch agents 1-10 together
  - Wait for them to complete
  - Then launch agents 11-20 together
  - Continue until all agents are launched

```bash
# First, read ALL task files:
echo "Reading all task files..."
for i in $(seq 1 $ACTUAL_AGENTS); do
    TASK_FILE="$WORK_DIR/batches/agent-$i/task.md"
    echo "Task file $i ready at: $TASK_FILE"
done

# Determine batching strategy
if [ "$ACTUAL_AGENTS" -le 10 ]; then
    echo "Launching all $ACTUAL_AGENTS agents in PARALLEL"
else
    echo "Will launch agents in batches of 10"
    echo "Total batches needed: $(( (ACTUAL_AGENTS + 9) / 10 ))"
fi
```

### Step 3: Track progress and collect results

```bash
# After all agents complete, run the collect script
echo "Running results collection..."
"$WORK_DIR/collect-results.sh"
```

## Instructions for me:

1. Parse arguments to check for --auto-fix flag and max agents number
2. Run the fix-lint-parallel script with appropriate options
3. Extract the work directory path from "Work directory saved to: /tmp/lint-fix-..."
4. Extract the number of agents from "Distributing work among N agents"
5. Read ALL task files first (collect all prompts from 1 to N)
6. Launch subagents based on the number:
   - **10 or fewer**: Launch ALL in a single response with multiple Task tool invocations
   - **More than 10**: Launch in batches of 10:
     - Launch agents 1-10 in parallel (single response, multiple Task tools)
     - Wait for batch to complete
     - Launch agents 11-20 in parallel
     - Continue until all agents are launched
   - Each Task tool call launches one agent:
     - description: "Fix ESLint errors batch $i"
     - subagent_type: "general-purpose"
     - prompt: [the full content from the task file]
7. Use TodoWrite to track which agents/batches have been launched
8. Wait for all agents to complete
9. Run `$WORK_DIR/collect-results.sh` to see final results
10. Report the outcome and whether another run is needed

**IMPORTANT**: Each agent's task file already includes:
- Instructions to review `.claude/docs/quality-rules.md` before making changes
- Prohibition on using `eslint-disable` comments
- Requirement to fix one file at a time with test verification
- List of all ESLint rules that must be followed

## Usage Examples:
- `/fix-lint` - Uses default 10 agents, no auto-fix
- `/fix-lint 5` - Uses 5 agents
- `/fix-lint --auto-fix` - Uses 10 agents with auto-fix first
- `/fix-lint 3 --auto-fix` - Uses 3 agents with auto-fix first

This automated approach handles the entire parallel lint fixing process, including optional auto-fix for formatting issues.