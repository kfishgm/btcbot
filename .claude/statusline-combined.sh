#!/bin/bash
# Combined status line showing both custom info and ccusage

# Read JSON input from stdin
input=$(cat)

# Get custom statusline output
CUSTOM_STATUS=$(echo "$input" | $CLAUDE_PROJECT_DIR/.claude/statusline.sh)

# Get ccusage statusline output
CCUSAGE_STATUS=$(echo "$input" | npx -y ccusage statusline --visual-burn-rate emoji 2>/dev/null || echo "")

# Combine both outputs
if [ -n "$CCUSAGE_STATUS" ]; then
    echo -e "$CUSTOM_STATUS | $CCUSAGE_STATUS"
else
    echo -e "$CUSTOM_STATUS"
fi