#!/bin/bash
# Project-agnostic git utilities
# Source this file: source .claude/lib/git-utils.sh

# Configuration
export FORBIDDEN_FILES_PATTERN="${FORBIDDEN_FILES_PATTERN:-TASK-.*\.md|CLAUDE\.md|\.mcp/config\.json|\.mcp\.json|docs/configuration/mcp\.md}"
export PROTECTED_BRANCH="${PROTECTED_BRANCH:-main}"

# Check for forbidden files in staging area
check_forbidden_files() {
    local forbidden=$(git status --porcelain | grep -E "^[AM].*($FORBIDDEN_FILES_PATTERN)")
    
    if [ -n "$forbidden" ]; then
        echo "❌ ERROR: Forbidden files are staged for commit:"
        echo "$forbidden"
        echo
        echo "These files should never be committed. Use:"
        echo "  git reset HEAD <file> - to unstage"
        echo "  git checkout -- <file> - to discard changes"
        return 1
    fi
    
    return 0
}

# Safe git add that excludes forbidden files
safe_add() {
    local paths="${@:-.}"
    
    # Add all files except forbidden ones
    git add $paths -- ":!CLAUDE.md" ":!TASK-*.md" ":!.mcp/config.json" ":!.mcp.json" 2>/dev/null || {
        # Fallback for older git versions
        git add $paths
        git reset HEAD CLAUDE.md 2>/dev/null || true
        git reset HEAD TASK-*.md 2>/dev/null || true
        git reset HEAD .mcp/config.json 2>/dev/null || true
        git reset HEAD .mcp.json 2>/dev/null || true
    }
}

# Safe commit with forbidden file check
safe_commit() {
    local message="$1"
    
    if [ -z "$message" ]; then
        echo "❌ ERROR: Commit message required"
        echo "Usage: safe_commit \"your commit message\""
        return 1
    fi
    
    # Check for forbidden files
    if ! check_forbidden_files; then
        return 1
    fi
    
    # Perform commit
    git commit -m "$message"
}

# Create AI-assisted commit message
ai_commit() {
    local type="${1:-fix}"
    local message="$2"
    
    if [ -z "$message" ]; then
        echo "❌ ERROR: Commit message required"
        echo "Usage: ai_commit [type] \"message\""
        echo "Types: feat, fix, chore, docs, test, refactor"
        return 1
    fi
    
    # Check for forbidden files
    if ! check_forbidden_files; then
        return 1
    fi
    
    # Create commit with AI attribution
    git commit -m "$type: $message

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"
}

# Clean up forbidden files from working directory
cleanup_forbidden() {
    echo "Cleaning up forbidden files..."
    
    # Remove TASK files
    find . -name "TASK-*.md" -type f -delete 2>/dev/null || true
    
    # Revert CLAUDE.md if modified
    if ! git diff --quiet HEAD -- CLAUDE.md 2>/dev/null; then
        echo "Reverting CLAUDE.md to HEAD version..."
        git checkout HEAD -- CLAUDE.md
    fi
    
    # Revert .mcp/config.json if modified
    if [ -f .mcp/config.json ] && ! git diff --quiet HEAD -- .mcp/config.json 2>/dev/null; then
        echo "Reverting .mcp/config.json to HEAD version..."
        git checkout HEAD -- .mcp/config.json
    fi
    
    # Revert .mcp.json if modified
    if [ -f .mcp.json ] && ! git diff --quiet HEAD -- .mcp.json 2>/dev/null; then
        echo "Reverting .mcp.json to HEAD version..."
        git checkout HEAD -- .mcp.json
    fi
    
    echo "✅ Forbidden files cleaned up"
}

# Get current branch name
current_branch() {
    git branch --show-current 2>/dev/null || git rev-parse --abbrev-ref HEAD
}

# Check if branch exists (local or remote)
branch_exists() {
    local branch="$1"
    
    # Check local
    if git show-ref --verify --quiet "refs/heads/$branch"; then
        return 0
    fi
    
    # Check remote
    if git ls-remote --heads origin "$branch" | grep -q "$branch"; then
        return 0
    fi
    
    return 1
}

# Find branch with multiple strategies (returns the full ref if found)
find_branch_ref() {
    local branch="$1"
    
    # Method 1: Check if it exists locally
    if git show-ref --verify --quiet "refs/heads/$branch"; then
        echo "$branch"
        return 0
    fi
    
    # Method 2: Check if it exists on remote
    if git ls-remote --heads origin "$branch" | grep -q "$branch"; then
        echo "origin/$branch"
        return 0
    fi
    
    # Method 3: Check if it's already fetched but not tracked
    if git show-ref --quiet "refs/remotes/origin/$branch"; then
        echo "origin/$branch"
        return 0
    fi
    
    # Method 4: Try case-insensitive search on remote
    local found_branch=$(git ls-remote --heads origin | grep -i "/$branch$" | awk '{print $2}' | sed 's|refs/heads/||' | head -1)
    if [ -n "$found_branch" ]; then
        echo "origin/$found_branch"
        return 0
    fi
    
    # Not found
    return 1
}

# Safe branch checkout with stash handling
safe_checkout() {
    local branch="$1"
    local create_from="${2:-origin/$PROTECTED_BRANCH}"
    
    # Stash any uncommitted changes
    if [ -n "$(git status --porcelain)" ]; then
        echo "Stashing uncommitted changes..."
        git stash push -m "Auto-stash before checkout to $branch"
    fi
    
    # Checkout or create branch
    if branch_exists "$branch"; then
        git checkout "$branch"
    else
        echo "Creating new branch $branch from $create_from"
        git checkout -b "$branch" "$create_from"
    fi
}

# Merge branch with conflict detection and CLAUDE.md preservation
safe_merge() {
    local branch="$1"
    local strategy="${2:-}"
    
    echo "Merging $branch..."
    
    # Save CLAUDE.md if it exists
    local claude_backup=""
    if [ -f "CLAUDE.md" ]; then
        claude_backup=$(mktemp)
        cp CLAUDE.md "$claude_backup"
    fi
    
    # Save .mcp/config.json if it exists
    local mcp_backup=""
    if [ -f ".mcp/config.json" ]; then
        mcp_backup=$(mktemp)
        cp .mcp/config.json "$mcp_backup"
    fi
    
    # Save .mcp.json if it exists
    local mcp_json_backup=""
    if [ -f ".mcp.json" ]; then
        mcp_json_backup=$(mktemp)
        cp .mcp.json "$mcp_json_backup"
    fi
    
    # Perform merge
    if [ -n "$strategy" ]; then
        git merge "$branch" --strategy="$strategy" --no-edit
    else
        git merge "$branch" --no-edit
    fi
    
    local merge_result=$?
    
    # Restore CLAUDE.md and .mcp files regardless of merge result
    if [ -n "$claude_backup" ] && [ -f "$claude_backup" ]; then
        cp "$claude_backup" CLAUDE.md
        rm -f "$claude_backup"
        echo "✅ Preserved agent-specific CLAUDE.md"
    fi
    
    if [ -n "$mcp_backup" ] && [ -f "$mcp_backup" ]; then
        cp "$mcp_backup" .mcp/config.json
        rm -f "$mcp_backup"
        echo "✅ Preserved agent-specific .mcp/config.json"
    fi
    
    if [ -n "$mcp_json_backup" ] && [ -f "$mcp_json_backup" ]; then
        cp "$mcp_json_backup" .mcp.json
        rm -f "$mcp_json_backup"
        echo "✅ Preserved agent-specific .mcp.json"
    fi
    
    # Check for conflicts
    if [ $merge_result -ne 0 ] || [ -n "$(git status --porcelain | grep '^UU')" ]; then
        echo "⚠️  Merge conflicts detected!"
        echo "Conflicted files:"
        git status --porcelain | grep '^UU' | awk '{print "  " $2}'
        return 1
    fi
    
    return 0
}

# Push with automatic upstream setup
safe_push() {
    local branch="${1:-$(current_branch)}"
    local force="${2:-}"
    
    if [ "$force" = "--force" ]; then
        git push --set-upstream origin "$branch" --force
    else
        git push --set-upstream origin "$branch"
    fi
}

# Delete local and remote branch
delete_branch() {
    local branch="$1"
    
    if [ -z "$branch" ] || [ "$branch" = "$PROTECTED_BRANCH" ]; then
        echo "❌ ERROR: Cannot delete protected branch"
        return 1
    fi
    
    # Delete local branch if exists
    if git show-ref --verify --quiet "refs/heads/$branch"; then
        echo "Deleting local branch $branch..."
        git branch -D "$branch" 2>/dev/null || true
    fi
    
    # Delete remote branch if exists
    if git ls-remote --heads origin "$branch" | grep -q "$branch"; then
        echo "Deleting remote branch $branch..."
        git push origin --delete "$branch" 2>/dev/null || true
    fi
}

# Show help
git_utils_help() {
    cat << EOF
Git Safety Utilities

Functions:
  check_forbidden_files    - Check for forbidden files in staging
  safe_add [paths]        - Add files excluding forbidden ones
  safe_commit "message"   - Commit with forbidden file check
  ai_commit [type] "msg"  - Commit with AI attribution
  cleanup_forbidden       - Remove/revert forbidden files
  current_branch          - Get current branch name
  branch_exists <branch>  - Check if branch exists
  safe_checkout <branch>  - Checkout with stash handling
  safe_merge <branch>     - Merge with conflict detection
  safe_push [branch]      - Push with upstream setup
  delete_branch <branch>  - Delete local and remote branch

Environment Variables:
  FORBIDDEN_FILES_PATTERN - Regex for forbidden files
  PROTECTED_BRANCH        - Protected branch name (default: main)

Example:
  source .claude/lib/git-utils.sh
  safe_add .
  check_forbidden_files && safe_commit "feat: add new feature"
EOF
}

# If sourced with --help, show help
if [[ "${1:-}" == "--help" ]]; then
    git_utils_help
fi