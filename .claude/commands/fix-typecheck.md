---
allowed-tools: Bash(*), Task(*), Read(*), TodoWrite(*)
description: Fix TypeScript errors in parallel using subagents
argument-hint: [max-agents] (default: 10)
---

# Fix TypeScript Errors in Parallel

## Context
- Current TypeScript errors: !`timeout 30s pnpm typecheck 2>&1 | grep -c "error TS" || echo 0`
- Working directory: !`pwd`

## Task

I'll help you fix TypeScript errors by distributing them across multiple subagents for parallel processing.

### Step 1: Run the parallel fix script and capture work directory

```bash
# Set max agents (default 10, or from argument)
MAX_AGENTS="${ARGUMENTS:-10}"

# Run the fix-typescript-parallel script and capture output
echo "Running TypeScript error analysis with max $MAX_AGENTS agents..."
# Run script and save output to file to avoid truncation
TEMP_OUTPUT="/tmp/fix-typecheck-output-$$.txt"
./.claude/commands/fix-typescript-parallel --max-agents "$MAX_AGENTS" 2>&1 | tee "$TEMP_OUTPUT"

# Get key information from the output
OUTPUT=$(cat "$TEMP_OUTPUT")

# Extract the work directory from output
# Look for line like: "Work directory saved to: /tmp/ts-fix-20241231_123456-12345"
WORK_DIR=$(echo "$OUTPUT" | grep "Work directory saved to:" | sed 's/.*Work directory saved to: //' | tr -d '\r\n')

if [ -z "$WORK_DIR" ]; then
    echo "ERROR: Could not find work directory in output"
    exit 1
fi

echo "Work directory: $WORK_DIR"

# Extract number of agents from output
# Look for line like: "Distributing work among N agents"
ACTUAL_AGENTS=$(echo "$OUTPUT" | grep "Distributing work among" | sed 's/.*among \([0-9]*\) agents.*/\1/')

if [ -z "$ACTUAL_AGENTS" ]; then
    echo "ERROR: Could not determine number of agents"
    exit 1
fi

echo "Number of agents to launch: $ACTUAL_AGENTS"
```

### Step 2: Read task files and launch subagents

After extracting the work directory, I'll:

```bash
# Count agents with actual work
AGENTS_WITH_WORK=0
for i in $(seq 1 $ACTUAL_AGENTS); do
    TASK_FILE="$WORK_DIR/batches/agent-$i/task.md"
    if [ -f "$TASK_FILE" ]; then
        # Check if agent has files to fix
        if grep -q "^- " "$TASK_FILE" 2>/dev/null; then
            ((AGENTS_WITH_WORK++))
        fi
    fi
done

echo "Agents with work to do: $AGENTS_WITH_WORK out of $ACTUAL_AGENTS"

# For each agent (1 to ACTUAL_AGENTS):
for i in $(seq 1 $ACTUAL_AGENTS); do
    TASK_FILE="$WORK_DIR/batches/agent-$i/task.md"
    
    # Skip if no task file
    if [ ! -f "$TASK_FILE" ]; then
        echo "Agent $i: No task file found, skipping"
        continue
    fi
    
    # Check if agent has actual work
    if ! grep -q "^- " "$TASK_FILE" 2>/dev/null; then
        echo "Agent $i: No files assigned, skipping"
        continue
    fi
    
    # Read the task file content
    echo "Reading task for agent $i..."
    TASK_CONTENT=$(cat "$TASK_FILE")
    
    # Launch subagent with Task tool
    # Using the exact content from the task file
done
```

### Step 3: Track progress and collect results

```bash
# After all agents complete, run the collect script
echo "Running results collection..."
"$WORK_DIR/collect-results.sh"

# Clean up temp output file
rm -f "$TEMP_OUTPUT"
```

## Instructions for me:

1. Run the fix-typescript-parallel script and capture its output
2. Extract the work directory path from the line "Work directory saved to: /tmp/ts-fix-..."
3. Extract the number of agents from "Distributing work among N agents"
4. For each agent (1 to N):
   - Read the task file at `$WORK_DIR/batches/agent-$i/task.md`
   - Launch a subagent using Task tool with:
     - description: "Fix TypeScript errors batch $i"
     - subagent_type: "general-purpose"
     - prompt: [the full content from the task file]
5. Use TodoWrite to track which agents have been launched
6. Wait for all agents to complete
7. Run `$WORK_DIR/collect-results.sh` to see final results
8. Report the outcome and whether another run is needed

This automated approach extracts all necessary information from the script output to handle the entire parallel fixing process.