#!/bin/bash
# Complete task utilities - focused functions for task completion workflow
set -e

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source git and issue utilities (these are still functions)
source "$SCRIPT_DIR/git-utils.sh"
source "$SCRIPT_DIR/issue-utils.sh"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Project detection
export PROJECT_NAME="${PROJECT_NAME:-$(basename $(pwd) | sed 's/-impl$//')}"
export PROJECT_NAME_LOWER=$(echo "$PROJECT_NAME" | tr '[:upper:]' '[:lower:]')

# Verify prerequisites
verify_prerequisites() {
    local task=$(get_current_task)
    
    if [ -z "$task" ]; then
        echo -e "${RED}❌ No current task found${NC}"
        return 1
    fi
    
    # Check issue state
    if is_issue_closed "$task"; then
        echo -e "${RED}❌ Issue #$task is already CLOSED${NC}"
        return 1
    fi
    
    # Check if implementation was already marked done (but issue still open)
    if has_label "$task" "implementation-done"; then
        echo -e "${YELLOW}⚠️  Warning: Task already has implementation-done label but issue is still OPEN${NC}"
        echo "This can happen if task-complete was used instead of complete-task."
        echo "Continuing to create PR with closing reference..."
        echo ""
    fi
    
    # For implementer, only check if test is done
    if ! has_label "$task" "test-done"; then
        echo -e "${RED}❌ Test agent has not completed${NC}"
        echo "Status:"
        has_label "$task" "architect-done" && echo "  ✓ Architect done" || echo "  ✗ Architect not done"
        has_label "$task" "test-done" && echo "  ✓ Test done" || echo "  ✗ Test not done"
        echo ""
        echo "You must wait for the test agent to complete before running complete-task."
        return 1
    fi
    
    # Get branch info and task details
    get_agent_branches "$task"
    local task_body=$(gh issue view "$task" --json body -q .body 2>/dev/null)
    local branches_missing=false
    local missing_agents=""
    
    # Check for missing branches vs done labels
    if has_label "$task" "architect-done" && [ "$arch_exists" != "true" ]; then
        branches_missing=true
        missing_agents="$missing_agents architect"
    fi
    
    if has_label "$task" "test-done" && [ "$test_exists" != "true" ]; then
        branches_missing=true
        missing_agents="$missing_agents test"
    fi
    
    # If branches are missing, sync with main
    if [ "$branches_missing" = "true" ]; then
        echo -e "${YELLOW}⚠️  Some agent branches missing, syncing with main...${NC}"
        git fetch origin main
        git merge origin/main --no-edit || {
            echo -e "${YELLOW}⚠️  Could not auto-merge main, may need manual resolution${NC}"
        }
    fi
    
    echo -e "${GREEN}✅ Prerequisites verified${NC}"
    return 0
}

# Sync environment files
sync_environment() {
    echo "Syncing environment files..."
    
    local main_project="../$PROJECT_NAME"
    
    # Copy from main if running from implementation worktree
    if [[ "$(pwd)" == *-impl ]]; then
        for env_file in .env.local .env.development.local .env.test.local; do
            if [ -f "$main_project/$env_file" ]; then
                cp "$main_project/$env_file" "./$env_file"
            fi
        done
    fi
    
    # Create test env if missing
    if [ ! -f .env.test.local ] && [ -f .env.local ]; then
        cp .env.local .env.test.local
    fi
    
    echo -e "${GREEN}✅ Environment synced${NC}"
}

# Get agent branch names
get_agent_branches() {
    local issue_number="${1:-$(get_current_task)}"
    
    # Use standard branch naming convention
    export arch_branch="$issue_number-architect"
    export test_branch="$issue_number-test"
    export impl_branch="$issue_number-implementation"
    
    # Check which branches exist
    export arch_exists=$(branch_exists "$arch_branch" && echo "true" || echo "false")
    export test_exists=$(branch_exists "$test_branch" && echo "true" || echo "false")
    export impl_exists=$(branch_exists "$impl_branch" && echo "true" || echo "false")
}

# Push agent branches
push_agent_branches() {
    local agents=("arch" "test" "impl")
    local issue_number=$(get_current_task)
    
    for agent in "${agents[@]}"; do
        local worktree="../${PROJECT_NAME_LOWER}-$agent"
        if [ -d "$worktree" ]; then
            local current=$(git -C "$worktree" branch --show-current 2>/dev/null)
            if [ -n "$current" ]; then
                git -C "$worktree" push -u origin HEAD >/dev/null 2>&1
            fi
        fi
    done
    
    git fetch origin --prune >/dev/null 2>&1
}

# Prepare implementer's branch for PR (simplified - no branch switching)
prepare_for_pr() {
    echo "Preparing implementer's branch for PR..."
    
    # Fetch latest from origin to ensure we're up to date
    echo "Fetching latest from origin..."
    git fetch origin --prune
    
    local issue_number=$(get_current_task)
    local current_branch=$(current_branch)
    
    # Verify we're on the implementation branch
    if [[ "$current_branch" != *"${issue_number}-implementation"* ]]; then
        echo -e "${RED}❌ Not on implementation branch${NC}"
        echo "Current branch: $current_branch"
        echo "Expected pattern: *${issue_number}-implementation*"
        echo ""
        echo "Please switch to your implementation branch and try again."
        return 1
    fi
    
    echo -e "${GREEN}✓ On implementation branch with all work${NC}"
    
    # Optional: merge latest main if there are new commits
    local main_ahead=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo "0")
    if [ "$main_ahead" -gt 0 ]; then
        echo "Main branch has $main_ahead new commits, merging..."
        if ! git merge origin/main --no-edit; then
            echo -e "${YELLOW}⚠️  Could not auto-merge main${NC}"
            echo "Please resolve conflicts manually and run complete-task again"
            return 1
        fi
        echo -e "${GREEN}✓ Merged latest main${NC}"
    fi
    
    echo -e "${GREEN}✅ Branch is ready for PR${NC}"
    return 0
}

# Run quality gate
run_quality_gate() {
    # Run the quality checks utility
    "$SCRIPT_DIR/run-quality-checks"
    local exit_code=$?
    
    if [ $exit_code -ne 0 ]; then
        echo ""
        echo -e "${RED}════════════════════════════════════════════${NC}"
        echo -e "${RED}❌ QUALITY GATE FAILED${NC}"
        echo -e "${RED}════════════════════════════════════════════${NC}"
        echo ""
        echo "You MUST fix ALL quality issues before merging to main."
        echo "This is a HARD requirement - no exceptions."
        echo ""
        echo -e "${YELLOW}Common fixes:${NC}"
        echo "  - For lint: pnpm lint --fix (then manually fix remaining)"
        echo "  - For types: Add proper types, fix imports"
        echo "  - For tests: Fix the implementation, not the test"
        echo "  - For build: Resolve import/export issues"
        echo ""
        echo -e "${RED}DO NOT PROCEED UNTIL ALL CHECKS PASS${NC}"
        return 1
    fi
    
    echo -e "${GREEN}✅ All quality checks passed${NC}"
    return 0
}

# Deploy migrations to remote Supabase
deploy_migrations() {
    echo "Checking for pending migrations..."
    
    # Check if there are any migration files
    if [ ! -d "supabase/migrations" ] || [ -z "$(ls -A supabase/migrations 2>/dev/null)" ]; then
        echo "No migrations found to deploy"
        return 0
    fi
    
    # Check if project is linked
    if ! pnpm supabase projects list 2>&1 | grep -q "LINKED"; then
        echo -e "${YELLOW}⚠️  No linked Supabase project found${NC}"
        echo "Migrations applied to local Supabase only"
        echo "To link remote project: pnpm supabase link --project-ref <project-id>"
        return 0
    fi
    
    echo "Deploying migrations to linked remote Supabase project..."
    
    # List pending migrations (for linked project)
    echo "Checking remote migration status:"
    if ! timeout 30s pnpm supabase migration list 2>&1; then
        echo -e "${YELLOW}⚠️  Could not list remote migrations${NC}"
        echo "Continuing without remote deployment"
        return 0
    fi
    
    # Deploy migrations to linked project (uses --linked by default)
    echo "Pushing migrations to production..."
    if ! timeout 120s pnpm supabase db push 2>&1; then
        echo -e "${RED}❌ Migration deployment failed${NC}"
        echo "Please deploy migrations manually before merging"
        return 1
    fi
    
    echo -e "${GREEN}✅ Migrations deployed to remote successfully${NC}"
    return 0
}

# Create and merge PR (simplified to use current branch)
create_and_merge_pr() {
    local task_id="$1"
    local pr_branch="${2:-$(current_branch)}"
    
    # Quality checks already passed in run_quality_gate, proceed with PR
    echo "Creating pull request..."
    
    # Push current branch
    safe_push "$pr_branch"
    
    # Get issue details
    local title=$(get_task_title "$task_id")
    # Extract issue number from beginning of task_id (e.g., "54-implementation" -> "54")
    # But task_id should just be the number from get_current_task
    local issue_num=$(echo "$task_id" | grep -oE '^[0-9]+')
    
    # Fallback: if no number extracted, use task_id as-is
    if [ -z "$issue_num" ]; then
        echo -e "${YELLOW}Warning: Could not extract issue number from '$task_id', using as-is${NC}"
        issue_num="$task_id"
    fi
    
    echo "Creating PR for issue #$issue_num: $title"
    
    # Create PR
    local pr_body="## Summary
Implements #$issue_num: $title

## Completed by
- ✅ Architect
- ✅ Tester  
- ✅ Implementer
- ✅ Supervisor (quality gate)

## Quality Checks
- ✅ Lint: Zero errors
- ✅ TypeScript: Zero errors
- ✅ Tests: 100% passing
- ✅ Build: Successful

Closes #$issue_num

🤖 Generated with [Claude Code](https://claude.ai/code)"

    # Check if PR already exists for this branch
    local current_branch=$(current_branch)
    local existing_pr=$(gh pr list --head "$current_branch" --json number -q '.[0].number' 2>/dev/null || echo "")
    
    if [ -n "$existing_pr" ]; then
        echo "PR already exists: #$existing_pr"
        local pr_number="$existing_pr"
    else
        # Create new PR
        echo "Creating new PR..."
        local pr_url=$(gh pr create --title "$task_id: $title" --body "$pr_body" --base main)
        
        # Extract PR number from URL
        local pr_number=$(echo "$pr_url" | grep -o '[0-9]*$')
        
        if [ -z "$pr_number" ]; then
            echo -e "${RED}❌ Failed to create PR or extract PR number${NC}"
            echo "PR URL output: $pr_url"
            return 1
        fi
        
        echo "Created PR #$pr_number"
    fi
    
    # Merge the PR (whether existing or newly created)
    echo "Merging PR #$pr_number..."
    if ! gh pr merge "$pr_number" --merge --admin 2>/dev/null; then
        if ! gh pr merge "$pr_number" --merge --disable-auto 2>/dev/null; then
            echo -e "${RED}❌ Failed to merge PR #$pr_number${NC}"
            echo "Please check GitHub for:"
            echo "  - Merge conflicts"
            echo "  - CI failures"
            echo "  - Branch protection rules"
            echo ""
            echo "Manual steps:"
            echo "  1. Go to: $(gh pr view $pr_number --json url -q .url)"
            echo "  2. Resolve any issues"
            echo "  3. Merge manually"
            echo "  4. Run: gh issue close $task_id"
            return 1
        fi
    fi
    
    echo -e "${GREEN}✅ PR #$pr_number created and merged${NC}"
}

# Clean up branches
cleanup_task_branches() {
    local task_id="$1"
    
    echo "Cleaning up branches..."
    
    # Get branch names
    get_agent_branches "$task_id"
    
    # Switch agents to default branches
    for agent in arch test impl; do
        local worktree="../${PROJECT_NAME_LOWER}-$agent"
        if [ -d "$worktree" ]; then
            git -C "$worktree" checkout main 2>/dev/null || git -C "$worktree" checkout master 2>/dev/null || true
        fi
    done
    
    # Delete remote branches
    if [ "$arch_exists" = "true" ]; then
        git push origin --delete "$arch_branch" 2>/dev/null || true
    fi
    if [ "$test_exists" = "true" ]; then
        git push origin --delete "$test_branch" 2>/dev/null || true
    fi
    if [ "$impl_exists" = "true" ]; then
        git push origin --delete "$impl_branch" 2>/dev/null || true
    fi
    
    echo -e "${GREEN}✅ Branches cleaned up${NC}"
}

# Orchestrate the complete task workflow (simplified - no branch switching)
complete_task_orchestrator() {
    local task_id=$(get_current_task)
    
    if [ -z "$task_id" ]; then
        echo -e "${RED}❌ No current task found${NC}"
        return 1
    fi
    
    echo "Working on task: #$task_id"
    
    # No need to save original branch - we stay on implementation branch
    
    # Create temporary backup of TASK file (it gets removed on success)
    local task_file_backup="/tmp/TASK-${task_id}.md.backup"
    if [ -f "TASK-${task_id}.md" ]; then
        cp "TASK-${task_id}.md" "$task_file_backup"
    fi
    
    # 1. Remove TASK file first (so we know task is being completed)
    # This prevents agents from thinking they still have work
    if [ -f "TASK-${task_id}.md" ]; then
        echo "Removing TASK file to indicate completion in progress..."
        rm -f "TASK-${task_id}.md"
    fi
    
    # 2. Commit any pending changes (excluding CLAUDE.md)
    # Filter out CLAUDE.md from git status since it's worktree-specific and should never be committed
    if [ -n "$(git status --porcelain | grep -v '^.. CLAUDE.md$')" ]; then
        echo "Committing pending changes..."
        # Check if we should add all files or be selective (excluding CLAUDE.md)
        if git diff --name-only | grep -v '^CLAUDE.md$' | grep -qE '\.(ts|tsx|js|jsx|json|md|css|scss|html)$'; then
            # Use safe add for code changes
            if ! safe_add; then
                echo -e "${YELLOW}Warning: Some files couldn't be added${NC}"
            fi
            safe_commit "implementation: save work for task completion" || {
                echo -e "${RED}Failed to commit changes${NC}"
                echo "Please commit manually and run complete-task again:"
                echo "  git add ."
                echo "  git commit -m 'implementation: complete task'"
                return 1
            }
            echo -e "${GREEN}✓ Changes committed${NC}"
        fi
    fi
    
    # 3. Run quality gate FIRST (before any destructive operations)
    echo ""
    echo "====================================="
    echo "QUALITY GATE - THIS IS NON-NEGOTIABLE"
    echo "====================================="
    if ! run_quality_gate; then
        echo ""
        echo "❌ CANNOT PROCEED - Quality gate failed"
        echo ""
        echo "You MUST fix ALL issues before continuing:"
        echo "1. Run the failing command to see details"
        echo "2. Fix every single error/warning/failure"
        echo "3. Re-run complete-task when everything passes"
        echo ""
        echo "This includes fixing issues you didn't create."
        echo "The main branch must remain deployable."
        # Restore TASK file if needed
        if [ -f "$task_file_backup" ] && [ ! -f "TASK-${task_id}.md" ]; then
            cp "$task_file_backup" "TASK-${task_id}.md"
        fi
        return 1
    fi
    
    # 4. Verify prerequisites
    if ! verify_prerequisites; then
        # Restore TASK file if needed
        if [ -f "$task_file_backup" ] && [ ! -f "TASK-${task_id}.md" ]; then
            cp "$task_file_backup" "TASK-${task_id}.md"
        fi
        return 1
    fi
    
    get_agent_branches "$task_id"
    
    # 5. Sync environment
    sync_environment
    
    # 6. Push agent work
    push_agent_branches
    
    # 7. Prepare branch for PR (verify we're on impl branch, optionally merge main)
    if ! prepare_for_pr; then
        # Restore TASK file if needed
        if [ -f "$task_file_backup" ] && [ ! -f "TASK-${task_id}.md" ]; then
            cp "$task_file_backup" "TASK-${task_id}.md"
        fi
        return 1
    fi
    
    # 8. Deploy migrations (if any)
    echo ""
    echo "====================================="
    echo "MIGRATION DEPLOYMENT CHECK"
    echo "====================================="
    if ! deploy_migrations; then
        echo ""
        echo "❌ CANNOT PROCEED - Migration deployment failed"
        echo ""
        echo "You MUST deploy migrations successfully before merging."
        echo "Check if project is linked: pnpm supabase projects list"
        # Restore TASK file if needed
        if [ -f "$task_file_backup" ] && [ ! -f "TASK-${task_id}.md" ]; then
            cp "$task_file_backup" "TASK-${task_id}.md"
        fi
        return 1
    fi
    
    # 9. Create and merge PR from current implementation branch
    create_and_merge_pr "$task_id" "$(current_branch)"
    
    # 10. Add implementation-done label after PR merge (if not already present)
    if ! has_label "$task_id" "implementation-done"; then
        echo "Adding implementation-done label..."
        gh issue edit "$task_id" --add-label "implementation-done" || {
            echo -e "${YELLOW}Warning: Could not add implementation-done label${NC}"
        }
    else
        echo "Implementation-done label already present"
    fi
    
    # 11. Ensure issue is closed (PR should have closed it, but make sure)
    local issue_state=$(gh issue view "$task_id" --json state -q .state 2>/dev/null)
    if [ "$issue_state" != "CLOSED" ]; then
        echo "Closing issue #$task_id..."
        gh issue close "$task_id" --comment "✅ Task completed and merged to main via PR" || {
            echo -e "${YELLOW}Warning: Could not close issue (might be locked or protected)${NC}"
        }
    else
        echo "Issue already closed by PR"
    fi
    
    # 12. Clean up branches and processes
    cleanup_task_branches "$task_id"
    "$SCRIPT_DIR/cleanup-processes.sh"
    
    # Clean up backup
    rm -f "$task_file_backup"
    
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✅ TASK COMPLETED SUCCESSFULLY!${NC}"
    echo -e "${GREEN}════════════════════════════════════════════${NC}"
    echo ""
    echo "Summary:"
    echo "  - Task: #$task_id"
    echo "  - Quality: All checks passed"
    echo "  - PR: Created and merged to main"
    echo "  - Issue: Closed"
    echo "  - Branches: Cleaned up"
    echo ""
    echo "The code is now live on the main branch!"
    
    return 0
}

# Print help
print_help() {
    cat << EOF
Complete Task - Implementation Agent Final Step

This command is the FINAL step for the implementation agent.
It enforces strict quality gates before merging to main.

Prerequisites:
  - Architect must be done (architect-done label)
  - Tester must be done (test-done label)
  - Issue must be open (not closed)

Quality Requirements (ALL must pass):
  - Zero lint errors/warnings
  - Zero TypeScript errors
  - 100% test success rate
  - Successful build
  - No skipped tests

What this command does:
  1. Runs comprehensive quality checks
  2. Deploys migrations (if configured)
  3. Creates a pull request
  4. Merges to main immediately
  5. Closes the issue
  6. Cleans up branches

If quality checks fail:
  - Fix ALL issues (even pre-existing ones)
  - Run complete-task again
  - The main branch must remain deployable

Usage:
  complete-task         Run the complete workflow
  complete-task --help  Show this help

EOF
}