#!/bin/bash
# Status line for btcbot showing directory and git branch

# Read JSON input from stdin
input=$(cat)

# Extract values using jq
CURRENT_DIR=$(echo "$input" | jq -r '.workspace.current_dir')

# Get just the directory name
DIR_NAME=$(basename "$CURRENT_DIR")

# Get git branch if in a git repo
GIT_BRANCH=""
if [ -d "$CURRENT_DIR/.git" ] || git -C "$CURRENT_DIR" rev-parse --git-dir > /dev/null 2>&1; then
    BRANCH=$(git -C "$CURRENT_DIR" branch --show-current 2>/dev/null)
    if [ -n "$BRANCH" ]; then
        # Use different color/emoji for different branch types
        if [[ "$BRANCH" == *-sequential ]]; then
            GIT_BRANCH=" | 🔄 $BRANCH"
        elif [[ "$BRANCH" == "main" ]] || [[ "$BRANCH" == "master" ]]; then
            GIT_BRANCH=" | 🌳 $BRANCH"
        else
            GIT_BRANCH=" | 🌿 $BRANCH"
        fi
    fi
fi

# Color codes
BLUE='\033[1;34m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Build status line with colors
echo -e "${BLUE}📁 $DIR_NAME${NC}${GREEN}$GIT_BRANCH${NC}"