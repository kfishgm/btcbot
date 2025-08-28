#!/usr/bin/env bash
# GitHub Issues-based Agent Interface
# Simplified task management using GitHub Issues

# Removed set -e to handle errors gracefully

# Get directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIPELINE_ROOT="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$(dirname "$PIPELINE_ROOT")")"
PROJECT_NAME=$(basename "$PROJECT_ROOT")
PROJECT_NAME_LOWER=$(echo "$PROJECT_NAME" | tr '[:upper:]' '[:lower:]')

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Get agent worktree directory
get_agent_worktree() {
    local agent=$1
    local parent_dir="$(dirname "$PROJECT_ROOT")"
    local suffix=""
    
    case "$agent" in
        architect) suffix="arch" ;;
        test) suffix="test" ;;
        implementation) suffix="impl" ;;
    esac
    
    echo "$parent_dir/${PROJECT_NAME_LOWER}-${suffix}"
}

# Get next task for agent
get_next_task() {
    local agent=$1
    "$SCRIPT_DIR/github-task-scheduler.mjs" next-task "$agent"
}

# Start agent with task
start_agent_task() {
    local agent=$1
    local issue_number=$2
    
    if [ -z "$issue_number" ] || [ "$issue_number" = "No eligible tasks" ]; then
        echo -e "${YELLOW}No available tasks for $agent${NC}"
        return 1
    fi
    
    echo -e "${CYAN}Starting $agent with task #$issue_number${NC}"
    
    # Check if issue is closed before proceeding
    local issue_state=$(gh issue view "$issue_number" --json state -q .state 2>/dev/null || echo "UNKNOWN")
    if [ "$issue_state" = "CLOSED" ]; then
        echo -e "${RED}ERROR: Issue #$issue_number is already CLOSED!${NC}"
        echo "Cannot assign closed issues to agents. Skipping assignment."
        return 1
    fi
    
    # Check if task is already marked complete for this agent
    local done_label="${agent}-done"
    local labels=$(gh issue view "$issue_number" --json labels -q '.labels[].name' 2>/dev/null)
    if echo "$labels" | grep -q "^${done_label}$"; then
        echo -e "${YELLOW}⚠️  WARNING: Task #$issue_number already has ${done_label} label${NC}"
        echo "This agent has already completed this task."
        echo "Possible causes:"
        echo "  - Branch was deleted but work was complete"
        echo "  - Task being re-assigned incorrectly"
        echo ""
        echo "Skipping assignment to prevent duplicate work."
        return 1
    fi
    
    # Get task details
    local task_details=$("$SCRIPT_DIR/github-task-scheduler.mjs" details "$issue_number")
    local task_title=$(echo "$task_details" | jq -r '.title')
    local task_id=$(echo "$task_title" | grep -oE '^[A-Z]+-[0-9]+' || echo "TASK")
    
    # Assign task
    "$SCRIPT_DIR/github-task-scheduler.mjs" assign "$agent" "$issue_number"
    
    # Get agent's worktree
    local worktree=$(get_agent_worktree "$agent")
    
    # Step 1: Clean and prepare the worktree (this switches to base branch and regenerates CLAUDE.md)
    echo -e "${CYAN}Preparing $agent worktree for new task...${NC}"
    if ! "$PROJECT_ROOT/.claude/commands/setup-single-agent" "$agent"; then
        echo -e "${RED}Failed to prepare agent worktree${NC}"
        return 1
    fi
    
    # Step 2: Clean any old task files and recovery markers
    if [ -f "$PROJECT_ROOT/.claude/lib/task-file-security.sh" ]; then
        source "$PROJECT_ROOT/.claude/lib/task-file-security.sh"
        clean_task_files "$worktree"
    else
        rm -f "$worktree"/TASK-*.md
    fi
    # Also clean up recovery markers from previous task
    rm -f "$worktree/.claude-recovery-sent"
    rm -f "$worktree/.claude-idle-reminder"
    
    # Convert agent role to uppercase
    local agent_upper=$(echo "$agent" | tr '[:lower:]' '[:upper:]')
    
    # Step 3: Create task file (before switching branches)
    if [ "$agent" = "implementation" ]; then
        # Special instructions for implementation agent
        cat > "$worktree/TASK-${issue_number}.md" <<EOF
# Task #${issue_number}: ${task_title}
Branch: ${issue_number}-${agent}

## 🚨 CRITICAL INSTRUCTIONS FOR IMPLEMENTATION AGENT 🚨

**STRICTLY PROHIBITED:**
- **NEVER modify ANY files under .claude/ directory**
- **NEVER create workarounds to skip tests**
- **NEVER disable or bypass quality checks**
- **NEVER skip e2e tests - they are MANDATORY**

**IMPLEMENTATION REQUIREMENTS:**
1. **ALL tests must pass** - unit, integration, AND e2e tests
2. **Implement FULL production features** - NO MINIMAL STUBS OR PLACEHOLDERS
3. **Only use mocks for external services** (APIs, third-party services)
4. **Fix test expectations if wrong** - but NEVER remove test intent
5. **If tests fail, FIX THE CODE with REAL implementations**

**🚨 NO STUB IMPLEMENTATIONS ALLOWED 🚨**
- Creating "minimal stubs" is FORBIDDEN
- Returning empty arrays/objects to pass tests is FORBIDDEN
- You must implement COMPLETE, PRODUCTION-READY functionality
- Every feature must work with real database operations
- No placeholder code - this goes to production!

**DATABASE MIGRATION HANDLING:**
If tests fail due to missing database tables or columns:
1. Create migration: \`pnpm supabase migration new descriptive_name\`
2. Write SQL in the migration file (use Supabase SQL, NOT psql)
3. Apply migration: \`pnpm supabase migration up\`
4. If it fails: \`pnpm supabase db reset\` and fix the SQL
5. Generate types: \`pnpm supabase gen types typescript --local > src/types/database.types.ts\`
6. Commit BOTH migration and types files

**If migration push fails during complete-task:**
- Use Supabase MCP to debug: \`mcp__supabase__execute_sql\`
- Check table dependencies and constraints
- Fix the migration file and retry
- DO NOT skip - migrations MUST deploy successfully

**NEVER use psql directly - ALWAYS use Supabase CLI commands**

**YOU MUST USE \`.claude/commands/complete-task\` TO FINISH YOUR WORK**
**NEVER ATTEMPT TO COMPLETE A TASK WITHOUT USING \`complete-task\`**
**NEVER MANUALLY CREATE A PR WITH \`gh pr create\`**
**NEVER MANUALLY EDIT LABELS WITH \`gh issue edit\`**
**NEVER USE \`task-complete\` - THAT IS FOR OTHER AGENTS ONLY**

When you have:
1. Implemented all features with PRODUCTION CODE
2. Made ALL tests pass (including e2e)
3. Fixed all lint/type/build errors
4. Ensured all quality checks pass

Then run THIS SINGLE COMMAND:
\`\`\`bash
.claude/commands/complete-task
\`\`\`

**DO NOT EVER:**
- Modify .claude/ files
- Create PRs manually with \`gh pr create\`
- Add labels manually with \`gh issue edit --add-label\`
- Use \`task-complete\` command (wrong for implementation)
- Close issues manually with \`gh issue close\`
- Try to complete the task any other way

**The complete-task command will handle EVERYTHING automatically.**
EOF
    else
        # Standard task file for other agents
        cat > "$worktree/TASK-${issue_number}.md" <<EOF
# Task #${issue_number}: ${task_title}
Branch: ${issue_number}-${agent}
EOF
    fi

    echo -e "${GREEN}✓ Task file created at $worktree/TASK-${issue_number}.md${NC}"
    
    # Step 4: Now create the task branch (agent should be on base branch from setup-single-agent)
    (
        cd "$worktree"
        
        # Verify we're on the base branch
        case "$agent" in
            architect) suffix="arch" ;;
            test) suffix="test" ;;
            implementation) suffix="impl" ;;
            supervisor) suffix="supervisor" ;;
        esac
        base_branch="feature/${PROJECT_NAME_LOWER}-${suffix}"
        current_branch=$(git branch --show-current)
        
        if [ "$current_branch" != "$base_branch" ]; then
            echo -e "${YELLOW}Warning: Not on base branch (on $current_branch, expected $base_branch)${NC}"
        fi
        
        # Create and switch to task branch
        echo -e "${CYAN}Creating task branch ${issue_number}-${agent}...${NC}"
        git checkout -b "${issue_number}-${agent}" || {
            echo -e "${YELLOW}Branch might already exist, checking out...${NC}"
            git checkout "${issue_number}-${agent}"
        }
    )
    
    echo -e "${GREEN}✓ Task #$issue_number assigned to $agent${NC}"
}

# Complete agent's work
complete_agent_work() {
    local agent=$1
    local issue_number=$2
    local branch_name=$3
    
    echo -e "${CYAN}Marking $agent work complete for task #$issue_number${NC}"
    
    # Mark complete in GitHub
    "$SCRIPT_DIR/github-task-scheduler.mjs" complete "$agent" "$issue_number" "$branch_name"
    
    # Remove task file
    local worktree=$(get_agent_worktree "$agent")
    rm -f "$worktree/TASK-${issue_number}.md"
    
    echo -e "${GREEN}✓ $agent work completed for task #$issue_number${NC}"
    
    # Exit Claude to ensure fresh instance for next task
    echo "Exiting Claude for $agent..."
    
    # Get tmux session and pane info
    local project_name="$(basename "$PROJECT_ROOT")"
    local session_name="$(echo "${project_name}" | tr '[:upper:]' '[:lower:]')-dev"
    
    # Determine pane number based on agent role
    case "$agent" in
        architect) pane_num=0 ;;
        test) pane_num=1 ;;
        implementation) pane_num=2 ;;
        supervisor) pane_num=3 ;;
    esac
    
    # Kill Claude process for this worktree
    "$PROJECT_ROOT/.claude/lib/kill-worktree-claude.sh" "$worktree" "$agent"
    
    echo -e "${GREEN}✓ Claude exited for $agent${NC}"
    
    # Note: Worktree cleanup happens when next task is assigned
}

# Check agent status
check_agent_status() {
    local agent=$1
    local worktree=$(get_agent_worktree "$agent")
    
    # Source issue utilities for label checking
    if [ -f "$PROJECT_ROOT/.claude/lib/issue-utils.sh" ]; then
        source "$PROJECT_ROOT/.claude/lib/issue-utils.sh" 2>/dev/null || true
    fi
    
    # Check for active task files
    local task_count=$(find "$worktree" -name "TASK-*.md" 2>/dev/null | wc -l)
    
    if [ $task_count -gt 1 ]; then
        # Multiple TASK files - clean up all but the most recent
        local tasks=$(find "$worktree" -name "TASK-*.md" 2>/dev/null | xargs -n1 basename | sed 's/TASK-\(.*\)\.md/#\1/' | tr '\n' ' ')
        echo "ERROR: multiple tasks found: $tasks - cleaning up"
        
        # Remove all but the most recent TASK file (macOS compatible)
        find "$worktree" -name "TASK-*.md" -type f -print0 | xargs -0 ls -t | tail -n +2 | xargs rm -f
        
        # Re-check status after cleanup
        check_agent_status "$agent"
    elif [ $task_count -eq 1 ]; then
        local task_file=$(find "$worktree" -name "TASK-*.md" 2>/dev/null)
        local issue_number=$(basename "$task_file" | sed 's/TASK-\(.*\)\.md/\1/')
        
        # Check if work is already marked complete for this agent
        local api_result
        is_agent_work_complete "$issue_number" "$agent" 2>/dev/null
        api_result=$?
        
        if [ $api_result -eq 0 ]; then
            # Work is complete but TASK file remains - clean it up
            rm -f "$task_file"
            echo "idle"
        elif [ $api_result -eq 2 ]; then
            # API failure - keep current state
            echo "working on task #$issue_number (api check failed)"
        else
            echo "working on task #$issue_number"
        fi
    else
        echo "idle"
    fi
}

# CLI interface
case "${1:-help}" in
    worktree)
        if [ $# -lt 2 ]; then
            echo "Usage: github-agent-interface worktree <agent>"
            exit 1
        fi
        get_agent_worktree "$2"
        ;;
        
    start)
        if [ $# -lt 2 ]; then
            echo "Usage: github-agent-interface start <agent> [issue-number]"
            exit 1
        fi
        agent=$2
        issue=${3:-$(get_next_task "$agent")}
        start_agent_task "$agent" "$issue"
        ;;
        
    complete)
        if [ $# -lt 4 ]; then
            echo "Usage: github-agent-interface complete <agent> <issue-number> <branch-name>"
            exit 1
        fi
        complete_agent_work "$2" "$3" "$4"
        ;;
        
    next)
        if [ $# -lt 2 ]; then
            echo "Usage: github-agent-interface next <agent>"
            exit 1
        fi
        task=$(get_next_task "$2")
        if [ "$task" != "No eligible tasks" ]; then
            echo "Next task for $2: #$task"
        else
            echo "$task"
        fi
        ;;
        
    status)
        echo -e "${CYAN}Agent Status:${NC}"
        for agent in architect test implementation supervisor; do
            status=$(check_agent_status "$agent")
            printf "  %-15s: %s\n" "$agent" "$status"
        done
        ;;
        
    list)
        "$SCRIPT_DIR/github-task-scheduler.mjs" list
        ;;
        
    *)
        echo "GitHub Issues Agent Interface"
        echo "Commands:"
        echo "  start <agent> [issue]  - Start agent with task"
        echo "  complete <agent> <issue> <branch> - Complete agent work"
        echo "  next <agent>          - Get next task for agent"
        echo "  status               - Show all agent status"
        echo "  list                 - List all tasks"
        ;;
esac