#!/bin/bash
# Monitor token usage for project

PROJECT_NAME="$(basename $(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd))"
echo "🔍 $PROJECT_NAME Token Usage Monitor"
echo "===================================="
echo ""

# Simulated token tracking (in real implementation, this would connect to Claude API)
TOTAL_TOKENS=100000
USED_TOKENS=$(( RANDOM % 80000 + 10000 ))
PERCENTAGE=$(( USED_TOKENS * 100 / TOTAL_TOKENS ))

echo "Total Token Limit: $TOTAL_TOKENS"
echo "Tokens Used: $USED_TOKENS"
echo "Usage: $PERCENTAGE%"
echo ""

# Progress bar
echo -n "["
for i in {1..50}; do
  if [ $i -le $(( PERCENTAGE / 2 )) ]; then
    echo -n "="
  else
    echo -n " "
  fi
done
echo "] $PERCENTAGE%"
echo ""

# Warning thresholds
if [ $PERCENTAGE -ge 80 ]; then
  echo "⚠️  WARNING: Token usage above 80%!"
  echo "Consider optimizing your queries or increasing limits."
elif [ $PERCENTAGE -ge 60 ]; then
  echo "📊 Token usage is moderate."
else
  echo "✅ Token usage is healthy."
fi

echo ""
echo "Tips for reducing token usage:"
echo "- Use specific, focused queries"
echo "- Batch related tasks together"
echo "- Clear context when switching features"
echo "- Use the Task agent for searches"