---
allowed-tools: Bash(*), Task(*), Read(*), TodoWrite(*)
description: Fix TypeScript errors in parallel with safety checks - ensures functionality is preserved and tests pass
argument-hint: [max-agents] (default: 10)
---

# Fix TypeScript Errors in Parallel (Safe Mode)

## Context
- Current TypeScript errors: !`timeout 30s pnpm typecheck 2>&1 | grep -c "error TS" || echo 0`
- Working directory: !`pwd`

## Task

I'll help you fix TypeScript errors safely by distributing them across multiple subagents who will ensure functionality is preserved and tests continue to pass.

### Step 1: Run the safe TypeScript fix script

```bash
# Run the safe version of the fix script that emphasizes safety
echo "Running safe TypeScript fix with ${ARGUMENTS:-10} max agents..."

# Run the safe fix script in the same directory
OUTPUT=$(./.claude/commands/fix-typescript-safe --max-agents "${ARGUMENTS:-10}" 2>&1 | tee /tmp/safe-fix-output.txt)

# Extract work directory from output
WORK_DIR=$(echo "$OUTPUT" | grep "Work directory saved to:" | tail -1 | sed 's/.*Work directory saved to: //' | tr -d '\r\n' | sed 's/\x1b\[[0-9;]*m//g')

if [ -z "$WORK_DIR" ]; then
    echo "ERROR: Could not find work directory in output"
    echo "Check /tmp/safe-fix-output.txt for details"
    exit 1
fi

echo "Work directory: $WORK_DIR"

# Extract number of agents with work
AGENTS_WITH_WORK=$(echo "$OUTPUT" | grep "Distributing work among" | sed 's/.*among \([0-9]*\) agents.*/\1/')

if [ -z "$AGENTS_WITH_WORK" ]; then
    echo "ERROR: Could not determine number of agents"
    exit 1
fi

echo "Number of agents with work: $AGENTS_WITH_WORK"
```

### Step 2: Read task files and launch safety-focused subagents

```bash
# For each agent with work
for i in $(seq 1 $AGENTS_WITH_WORK); do
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
    
    # Display a summary of the task
    echo "Agent $i will work on:"
    grep "^- " "$TASK_FILE" | head -5
    FILE_COUNT=$(grep "^- " "$TASK_FILE" | wc -l)
    if [ "$FILE_COUNT" -gt 5 ]; then
        echo "... and $((FILE_COUNT - 5)) more files"
    fi
    
    # The task file now contains enhanced safety instructions
    echo "Task includes safety requirements and test-first approach"
done

echo ""
echo "Tasks prepared with safety emphasis:"
echo "- Test before and after each file change"
echo "- Preserve all functionality"
echo "- Revert if tests fail"
echo "- Only fix type annotations, no logic changes"
```

### Step 3: Launch ALL subagents in PARALLEL using Task tool

**IMPORTANT**: Launch agents based on the number requested:

- **If 10 or fewer agents**: Launch all agents simultaneously in a single message with multiple tool uses
- **If more than 10 agents**: Launch in batches of 10 in parallel
  - First launch agents 1-10 together
  - Wait for them to complete
  - Then launch agents 11-20 together
  - Continue until all agents are launched

For each agent, launch a subagent with:
- description: "Safe TypeScript fix batch N"
- subagent_type: "general-purpose"
- prompt: The complete content from the enhanced task file

**IMPORTANT**: Each agent's task file already includes instructions to:
- Review `.claude/docs/quality-rules.md` before making changes
- Follow all TypeScript strict mode rules
- Never use `any` types - always find proper types
- Handle null/undefined cases properly
- Run tests after each fix to ensure safety

When launching a batch, all agents in that batch should be launched in the SAME response using multiple Task tool invocations.

### Step 4: Track progress and collect results

```bash
# After all agents complete, run the collection script
echo "Running results collection..."
"$WORK_DIR/collect-results.sh"
```

## Key Safety Features:

1. **Enhanced Task Files**: Each agent receives detailed safety instructions
2. **Test-Driven Fixes**: Agents test before and after each file
3. **Revert Protocol**: Clear instructions to revert if tests fail
4. **Final Verification**: Full test suite run after all fixes

## Instructions for me:

1. Run the fix-typescript-safe script and capture output
2. Extract work directory and agent count
3. Read ALL task files first (collect all prompts)
4. Launch subagents based on the number:
   - **10 or fewer**: Launch ALL in a single response with multiple Task tool invocations
   - **More than 10**: Launch in batches of 10:
     - Launch agents 1-10 in parallel (single response, multiple Task tools)
     - Wait for batch to complete
     - Launch agents 11-20 in parallel
     - Continue until all agents are launched
5. Use TodoWrite to track which agents/batches have been launched
6. Wait for all agents to complete
7. Run `$WORK_DIR/collect-results.sh` to verify all tests still pass
8. Report success only if tests pass

This approach prioritizes code safety over fixing all TypeScript errors.