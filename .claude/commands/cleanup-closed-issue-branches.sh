#!/bin/bash
# Clean up branches for all closed GitHub issues

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Cleaning up branches for closed issues ===${NC}"
echo

# Get all closed issues with the 'task' label
echo "Fetching closed issues..."
closed_issues=$(gh issue list --state closed --label task --limit 200 --json number,title | jq -r '.[] | "\(.number):\(.title)"')

if [ -z "$closed_issues" ]; then
  echo "No closed issues found with 'task' label"
  exit 0
fi

# Fetch all remote branches
echo "Fetching all remote branches..."
git fetch --all --prune --quiet

# Process each closed issue
total_deleted=0
while IFS=: read -r issue_num issue_title; do
  echo -e "\n${YELLOW}Issue #$issue_num: $issue_title${NC}"
  
  # Extract task ID from title if it exists
  task_id=$(echo "$issue_title" | grep -oE '^[A-Z]+-[0-9]+' || echo "")
  task_id_lower=$(echo "$task_id" | tr '[:upper:]' '[:lower:]')
  
  branches_found=false
  
  # Find branches related to this issue number
  echo "  Looking for branches with issue #$issue_num..."
  
  # Pattern 1: Agent branches (e.g., 123-architect, 123-test, 123-implementation)
  agent_branches=$(git branch -r | grep -E "origin/${issue_num}-(architect|test|implementation|supervisor)" | sed 's/origin\///' || true)
  
  # Pattern 2: Complete branches (e.g., feature/123-complete)
  complete_branches=$(git branch -r | grep -E "origin/feature/${issue_num}-complete" | sed 's/origin\///' || true)
  
  # Pattern 3: Legacy branches with task IDs (will be phased out)
  legacy_branches=""
  if [ -n "$task_id_lower" ]; then
    legacy_branches=$(git branch -r | grep -E "origin/${task_id_lower}-(architect|test|implementation|supervisor)" | sed 's/origin\///' || true)
  fi
  
  # Combine all patterns
  matching_branches=$(echo -e "$agent_branches\n$complete_branches\n$legacy_branches" | sort -u | grep -v '^$')
  
  if [ -n "$matching_branches" ]; then
    branches_found=true
    echo "  Found branches to delete:"
    echo "$matching_branches" | while read branch; do
      if [ -n "$branch" ]; then
        echo "    - $branch"
      fi
    done
    
    # Delete the branches
    echo "$matching_branches" | while read branch; do
      if [ -n "$branch" ]; then
        echo -e "    ${RED}Deleting${NC} origin/$branch..."
        git push origin --delete "$branch" 2>/dev/null || echo "      (already deleted or protected)"
        ((total_deleted++)) || true
      fi
    done
  else
    echo "  No branches found for this issue"
  fi
done <<< "$closed_issues"

echo -e "\n${GREEN}=== Cleanup Summary ===${NC}"
echo "Processed $(echo "$closed_issues" | wc -l) closed issues"
echo "Deleted branches for closed issues"
echo
echo "To see remaining branches: git branch -r"
echo "To clean up local references: git remote prune origin"