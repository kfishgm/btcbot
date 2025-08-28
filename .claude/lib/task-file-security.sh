#!/bin/bash
# Task file security utilities
# Ensures TASK files are never committed and always cleaned up

# Function to clean all TASK files from a directory
clean_task_files() {
    local dir="${1:-.}"
    local count=$(find "$dir" -name "TASK-*.md" -type f 2>/dev/null | wc -l)
    
    if [ $count -gt 0 ]; then
        echo "Removing $count TASK file(s) from $dir"
        find "$dir" -name "TASK-*.md" -type f -exec rm -f {} \;
        return 0
    else
        return 1
    fi
}

# Function to check if any TASK files exist in git history
check_task_files_in_git() {
    local branch="${1:-HEAD}"
    local found=0
    
    # Check if any TASK files are tracked
    if git ls-tree -r "$branch" --name-only | grep -q "TASK-.*\.md"; then
        echo "WARNING: TASK files found in git history on branch $branch:"
        git ls-tree -r "$branch" --name-only | grep "TASK-.*\.md"
        found=1
    fi
    
    # Check staging area
    if git ls-files --cached | grep -q "TASK-.*\.md"; then
        echo "WARNING: TASK files found in staging area:"
        git ls-files --cached | grep "TASK-.*\.md"
        found=1
    fi
    
    return $found
}

# Function to add TASK files to .gitignore if not already there
ensure_task_files_ignored() {
    local gitignore="${1:-.gitignore}"
    
    if ! grep -q "^TASK-\*\.md" "$gitignore" 2>/dev/null; then
        echo "Adding TASK-*.md to .gitignore"
        echo -e "\n# Task files should never be committed\nTASK-*.md" >> "$gitignore"
        return 0
    else
        return 1
    fi
}

# Function to set up git hooks to prevent TASK file commits
setup_task_file_hooks() {
    local git_dir="${1:-.git}"
    local hook_file="$git_dir/hooks/pre-commit"
    
    # Create hooks directory if it doesn't exist
    mkdir -p "$git_dir/hooks"
    
    # Create or update pre-commit hook
    cat > "$hook_file" << 'EOF'
#!/bin/bash
# Pre-commit hook to prevent TASK file commits

# Check for TASK files in the commit
if git diff --cached --name-only | grep -q "TASK-.*\.md"; then
    echo "ERROR: Attempting to commit TASK files!"
    echo "TASK files should never be committed."
    echo
    echo "Files detected:"
    git diff --cached --name-only | grep "TASK-.*\.md"
    echo
    echo "To fix this, unstage the files:"
    echo "  git reset HEAD TASK-*.md"
    exit 1
fi
EOF
    
    chmod +x "$hook_file"
    echo "Git pre-commit hook installed to prevent TASK file commits"
}

# Show help if sourced with --help
if [[ "${1:-}" == "--help" ]]; then
    cat << EOF
Task File Security Utilities

Functions:
  clean_task_files [dir]        - Remove all TASK-*.md files
  check_task_files_in_git [branch] - Check for TASK files in git
  ensure_task_files_ignored [.gitignore] - Add to .gitignore
  setup_task_file_hooks [.git]  - Install pre-commit hook

Usage:
  source task-file-security.sh
  clean_task_files .
  check_task_files_in_git main
EOF
fi