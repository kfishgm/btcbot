# Complete Task Workflow

This workflow merges all agent work to main with quality gates.

## Quick Start

```bash
# Run the complete workflow
.claude/commands/complete-task
```

## What It Does

1. **Verifies Prerequisites**
   - All 3 agent labels marked (-done)
   - Issue is open (not closed)
   
2. **Merges All Work**
   - From main: merges architect, test, and implementation branches
   - Handles parallel development (test and impl work simultaneously)
   - Cleans forbidden files
   
3. **Quality Gate** (ALL must pass)
   - `pnpm lint` - Zero errors
   - `pnpm typecheck` - Zero errors  
   - `pnpm test` - 100% pass rate
   - `pnpm build:clean` - Successful
   
4. **Creates & Merges PR**
   - Links to GitHub issue
   - Auto-merges to main
   
5. **Cleanup**
   - Deletes feature branches
   - Kills lingering processes

## If It Fails

The script will tell you exactly what failed. Fix it and run again.

## Manual Steps

If you need to run steps individually:

```bash
source .claude/lib/complete-task-utils.sh

# Check prerequisites
verify_prerequisites

# Run quality checks only
run_quality_gate

# See all available functions
complete_task_help
```