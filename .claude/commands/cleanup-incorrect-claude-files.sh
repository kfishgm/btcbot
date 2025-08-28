#!/bin/bash
# Clean up incorrect CLAUDE-*.md files from all branches

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}=== Cleaning up incorrect CLAUDE-*.md files ===${NC}"
echo "These files should not exist - agents should only have CLAUDE.md"
echo

# Fetch latest
git fetch --all --quiet

# Files to remove
BAD_FILES="CLAUDE-IMPLEMENTER.md CLAUDE-TESTER.md CLAUDE-ARCHITECT.md CLAUDE-SUPERVISOR.md"

# Get all branches with these files
branches_to_clean=()
echo "Scanning branches..."
for branch in $(git branch -r | grep -v HEAD | sed 's/origin///' | sed 's/^[[:space:]]*//'); do
  for file in $BAD_FILES; do
    if git ls-tree -r origin/$branch --name-only 2>/dev/null | grep -q "^$file$"; then
      branches_to_clean+=("$branch")
      break
    fi
  done
done

# Remove duplicates
branches_to_clean=($(echo "${branches_to_clean[@]}" | tr ' ' '\n' | sort -u))

if [ ${#branches_to_clean[@]} -eq 0 ]; then
  echo -e "${GREEN}✓ No branches found with incorrect CLAUDE-*.md files${NC}"
  exit 0
fi

echo -e "\nFound ${#branches_to_clean[@]} branches to clean:"
printf '%s\n' "${branches_to_clean[@]}" | sed 's/^/  - /'

# Clean each branch
echo -e "\n${YELLOW}Cleaning branches...${NC}"
for branch in "${branches_to_clean[@]}"; do
  echo -e "\n${YELLOW}Processing: $branch${NC}"
  
  # Create temp directory for cleanup
  temp_dir="/tmp/btcbot-claude-cleanup-$$"
  rm -rf "$temp_dir"
  
  # Clone the specific branch
  git clone --single-branch --branch "$branch" git@github.com:kfishgm/btcbot.git "$temp_dir" 2>/dev/null
  
  if [ $? -eq 0 ]; then
    cd "$temp_dir"
    
    # Remove the incorrect files
    removed_files=""
    for file in $BAD_FILES; do
      if [ -f "$file" ]; then
        git rm "$file"
        removed_files="$removed_files $file"
        echo "  Removed: $file"
      fi
    done
    
    # Commit if there were changes
    if [ -n "$(git status --porcelain)" ]; then
      git commit -m "chore: remove incorrect CLAUDE-*.md files

These role-specific files should not be committed. Agents should only have CLAUDE.md
which contains the base instructions plus their role-specific template appended.

Removed:$removed_files

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"
      
      git push origin "$branch"
      echo -e "  ${GREEN}✓ Cleaned and pushed${NC}"
    else
      echo -e "  ${GREEN}✓ Already clean${NC}"
    fi
    
    cd - > /dev/null
    rm -rf "$temp_dir"
  else
    echo -e "  ${RED}✗ Failed to clone branch${NC}"
  fi
done

echo -e "\n${GREEN}=== Cleanup complete ===${NC}"
echo "Removed incorrect CLAUDE-*.md files from all branches."
echo "Going forward, only CLAUDE.md should exist in worktrees (not committed)."