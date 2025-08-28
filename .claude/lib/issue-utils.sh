#!/bin/bash
# GitHub issue and task management utilities
# Source this file: source .claude/lib/issue-utils.sh

# Configuration
export GH_FORMAT="${GH_FORMAT:-}"  # Set to --json for JSON output
export PROJECT_NAME="${PROJECT_NAME:-$(basename $(pwd))}"

# Check if an issue is closed
is_issue_closed() {
    local issue="$1"
    
    if [ -z "$issue" ]; then
        echo "ERROR: Issue number required"
        return 2
    fi
    
    local state=$(gh issue view "$issue" --json state -q .state 2>/dev/null || echo "UNKNOWN")
    
    [ "$state" = "CLOSED" ]
}

# (Removed check_three_boxes - using labels instead)

# Get current task from TASK file or branch name
get_current_task() {
    local worktree="${1:-.}"
    
    # First try to find TASK file
    local task_file=$(find "$worktree" -name "TASK-*.md" 2>/dev/null | head -1)
    
    if [ -n "$task_file" ]; then
        # Extract issue number from filename
        basename "$task_file" | sed 's/TASK-\(.*\)\.md/\1/'
        return 0
    fi
    
    # Fallback: Try to extract from current branch name
    local current_branch=$(git branch --show-current 2>/dev/null || echo "")
    
    # Match patterns like "52-implementation", "67-test", etc.
    local task_number=$(echo "$current_branch" | grep -E '^[0-9]+-(implementation|test|architect|impl|arch)$' | cut -d'-' -f1)
    
    if [ -n "$task_number" ]; then
        echo "$task_number"
        return 0
    fi
    
    # No task found
    echo ""
    return 1
}

# Get task details
get_task_details() {
    local issue="$1"
    local field="${2:-}"
    
    if [ -z "$issue" ]; then
        echo "ERROR: Issue number required"
        return 2
    fi
    
    if [ -n "$field" ]; then
        gh issue view "$issue" --json "$field" -q ".$field" 2>/dev/null
    else
        gh issue view "$issue" --json number,title,body,state,labels 2>/dev/null
    fi
}

# Get task title
get_task_title() {
    local issue="$1"
    get_task_details "$issue" "title"
}

# Check if issue has a specific label
has_label() {
    local issue="$1"
    local label="$2"
    
    if [ -z "$issue" ] || [ -z "$label" ]; then
        return 1
    fi
    
    gh issue view "$issue" --json labels -q '.labels[].name' 2>/dev/null | grep -q "^${label}$"
}

# Check if task is ready for agent
is_task_ready_for() {
    local issue="$1"
    local agent="$2"
    
    if [ -z "$issue" ] || [ -z "$agent" ]; then
        echo "ERROR: Issue number and agent role required"
        return 2
    fi
    
    # Check if issue is open
    if is_issue_closed "$issue"; then
        echo "Issue #$issue is closed"
        return 1
    fi
    
    # Check based on labels
    case "$agent" in
        architect)
            # Architect can start any task without architect-done
            ! has_label "$issue" "architect-done"
            ;;
        test)
            # Test needs architect-done but not test-done
            has_label "$issue" "architect-done" && ! has_label "$issue" "test-done"
            ;;
        implementation)
            # Implementation needs architect-done AND test-done but not implementation-done
            has_label "$issue" "architect-done" && \
            has_label "$issue" "test-done" && \
            ! has_label "$issue" "implementation-done"
            ;;
        *)
            echo "ERROR: Unknown agent role: $agent"
            return 2
            ;;
    esac
}

# (Removed update_agent_checkbox - using labels instead)

# Create task assignment file
create_task_file() {
    local issue="$1"
    local agent="$2"
    local worktree="${3:-.}"
    
    if [ -z "$issue" ] || [ -z "$agent" ]; then
        echo "ERROR: Issue number and agent role required"
        return 2
    fi
    
    local title=$(get_task_title "$issue")
    local task_file="$worktree/TASK-${issue}.md"
    
    cat > "$task_file" << EOF
# Task #${issue}: ${title}
Branch: ${issue}-${agent}
EOF
    
    echo "Created $task_file"
}

# Clean up task branches for closed issues
cleanup_closed_issue_branches() {
    echo "Finding branches for closed issues..."
    
    # Get all closed issues
    local closed_issues=$(gh issue list --state closed --limit 200 --json number -q '.[].number')
    
    for issue in $closed_issues; do
        local issue_lower=$(echo "$issue" | tr '[:upper:]' '[:lower:]')
        
        # Find and delete matching branches
        git branch -r | grep -E "origin/.*${issue_lower}.*" | sed 's/origin\///' | while read branch; do
            echo "Deleting branch for closed issue #$issue: $branch"
            git push origin --delete "$branch" 2>/dev/null || true
        done
    done
    
    echo "✅ Cleanup complete"
}

# Check if agent's work is already marked complete
is_agent_work_complete() {
    local issue="$1"
    local agent="$2"
    
    if [ -z "$issue" ] || [ -z "$agent" ]; then
        echo "ERROR: Issue number and agent role required"
        return 2
    fi
    
    # Check if agent has -done label
    has_label "$issue" "${agent}-done"
}

# Show help
issue_utils_help() {
    cat << EOF
GitHub Issue Utilities

Functions:
  is_issue_closed <issue>           - Check if issue is closed
  has_label <issue> <label>         - Check if issue has a specific label
  get_current_task [worktree]       - Get current task from TASK file
  get_task_details <issue> [field]  - Get issue details
  get_task_title <issue>            - Get issue title
  is_task_ready_for <issue> <agent> - Check if task is ready for agent
  create_task_file <issue> <agent> [worktree]    - Create TASK assignment file
  cleanup_closed_issue_branches     - Delete branches for closed issues
  is_agent_work_complete <issue> <agent>         - Check if agent's work is already marked

Environment Variables:
  GH_FORMAT     - Output format for gh commands
  PROJECT_NAME  - Project name (default: current directory)

Example:
  source .claude/lib/issue-utils.sh
  
  # Check if supervisor can work on issue
  if is_task_ready_for 123 supervisor; then
    echo "Ready for supervisor"
  fi
  
  # Check if issue has a label
  if has_label 123 "architect-done"; then
    echo "Architect has completed"
  fi
EOF
}

# If sourced with --help, show help
if [[ "${1:-}" == "--help" ]]; then
    issue_utils_help
fi