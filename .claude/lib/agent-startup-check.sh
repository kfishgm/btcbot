#!/bin/bash
# Agent startup check script - run this when agent begins work
# Usage: source .claude/lib/agent-startup-check.sh <agent-role>

# Get agent role from argument
AGENT_ROLE="${1:-}"

# Source utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/issue-utils.sh"
source "$SCRIPT_DIR/git-utils.sh"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check if agent role is provided
if [ -z "$AGENT_ROLE" ]; then
    echo -e "${RED}ERROR: Agent role required${NC}"
    echo "Usage: source .claude/lib/agent-startup-check.sh <agent-role>"
    echo "Valid roles: architect, test, implementation"
    return 1 2>/dev/null || exit 1
fi

# Normalize agent role
AGENT_ROLE=$(echo "$AGENT_ROLE" | tr '[:upper:]' '[:lower:]')

# Validate agent role
case "$AGENT_ROLE" in
    architect|test|implementation|implementer)
        if [ "$AGENT_ROLE" = "implementer" ]; then
            AGENT_ROLE="implementation"
        fi
        ;;
    *)
        echo -e "${RED}ERROR: Invalid agent role: $AGENT_ROLE${NC}"
        echo "Valid roles: architect, test, implementation"
        return 1 2>/dev/null || exit 1
        ;;
esac

echo -e "${GREEN}=== Agent Startup Check ===${NC}"
echo "Agent role: $AGENT_ROLE"

# Get current task
TASK_ID=$(get_current_task)

if [ -z "$TASK_ID" ]; then
    echo -e "${YELLOW}No TASK file found. Waiting for assignment...${NC}"
    return 0 2>/dev/null || exit 0
fi

echo "Current task: #$TASK_ID"

# Check if issue exists and is open
if is_issue_closed "$TASK_ID"; then
    echo -e "${RED}Task #$TASK_ID is already closed!${NC}"
    echo "Removing TASK file..."
    rm -f "TASK-${TASK_ID}.md"
    return 0 2>/dev/null || exit 0
fi

# Check if agent's work is already complete
if is_agent_work_complete "$TASK_ID" "$AGENT_ROLE"; then
    echo -e "${YELLOW}⚠️  Your work is already marked complete for task #$TASK_ID${NC}"
    
    # Get branch name
    BRANCH_NAME=$(echo "$TASK_ID" | tr '[:upper:]' '[:lower:]')-${AGENT_ROLE}
    
    # Check if branch exists locally or remotely
    if branch_exists "$BRANCH_NAME" || branch_exists "origin/$BRANCH_NAME"; then
        echo -e "${GREEN}✅ Work already completed. Branch exists: $BRANCH_NAME${NC}"
        echo ""
        echo "Since your work is already marked complete, you can:"
        echo "1. Skip to marking complete in the system:"
        echo "   ${GREEN}.claude/commands/task-complete${NC}"
        echo ""
        echo "2. Or if you need to make updates:"
        echo "   - Checkout the existing branch: ${GREEN}git checkout $BRANCH_NAME${NC}"
        echo "   - Make your changes"
        echo "   - Push updates: ${GREEN}git push origin $BRANCH_NAME${NC}"
        
        # Set flag for agent to check
        export AGENT_WORK_ALREADY_COMPLETE="true"
        export AGENT_BRANCH_NAME="$BRANCH_NAME"
    else
        echo -e "${YELLOW}⚠️  Work marked complete but branch not found: $BRANCH_NAME${NC}"
        echo "You should create the branch and complete the work."
        export AGENT_WORK_ALREADY_COMPLETE="false"
    fi
else
    echo -e "${GREEN}✅ Ready to start work on task #$TASK_ID${NC}"
    
    # Check prerequisites based on role
    case "$AGENT_ROLE" in
        test|implementation)
            if ! is_task_ready_for "$TASK_ID" "$AGENT_ROLE"; then
                echo -e "${RED}❌ Prerequisites not met for $AGENT_ROLE${NC}"
                echo "Waiting for previous agents to complete their work."
                return 1 2>/dev/null || exit 1
            fi
            ;;
    esac
    
    export AGENT_WORK_ALREADY_COMPLETE="false"
fi

echo -e "${GREEN}=== Startup Check Complete ===${NC}"

# Return success
return 0 2>/dev/null || exit 0