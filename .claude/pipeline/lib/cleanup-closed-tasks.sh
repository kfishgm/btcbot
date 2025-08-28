#!/bin/bash
# Cleanup TASK files for closed GitHub issues

# Don't exit on errors - we want this to be resilient
set +e

# Get directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIPELINE_ROOT="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$(dirname "$PIPELINE_ROOT")")"

# Define colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Function to get all worktrees
get_all_worktrees() {
    git worktree list --porcelain | grep "^worktree" | cut -d' ' -f2
}

# Function to check if issue is closed
is_issue_closed() {
    local issue_number=$1
    local state=$(gh issue view "$issue_number" --json state -q .state 2>/dev/null || echo "UNKNOWN")
    [ "$state" = "CLOSED" ]
}

# Main cleanup function
cleanup_closed_tasks() {
    local cleaned_count=0
    
    echo -e "${CYAN}Checking for TASK files from closed issues...${NC}"
    
    # Check all worktrees
    for worktree in $(get_all_worktrees); do
        # Skip the main worktree
        if [ "$worktree" = "$PROJECT_ROOT" ]; then
            continue
        fi
        
        # Find all TASK files in this worktree
        for task_file in "$worktree"/TASK-*.md; do
            if [ -f "$task_file" ]; then
                # Extract issue number from filename
                local issue_number=$(basename "$task_file" | sed 's/TASK-\([0-9]*\)\.md/\1/')
                
                # Check if issue is closed
                if is_issue_closed "$issue_number"; then
                    echo -e "${YELLOW}Found TASK file for closed issue #$issue_number in $(basename "$worktree")${NC}"
                    rm -f "$task_file"
                    echo -e "${GREEN}✓ Removed $task_file${NC}"
                    ((cleaned_count++))
                fi
            fi
        done
    done
    
    if [ $cleaned_count -eq 0 ]; then
        echo -e "${GREEN}No TASK files from closed issues found${NC}"
    else
        echo -e "${GREEN}Cleaned up $cleaned_count TASK file(s) from closed issues${NC}"
    fi
    
    return 0
}

# Run if executed directly
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    cleanup_closed_tasks
fi