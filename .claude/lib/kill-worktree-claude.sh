#!/bin/bash
# Kill Claude process for a specific worktree

kill_worktree_claude() {
    local worktree_path="$1"
    local agent="${2:-unknown}"
    
    if [ -z "$worktree_path" ]; then
        echo "Error: Worktree path required"
        return 1
    fi
    
    # Get absolute path
    worktree_path=$(cd "$worktree_path" 2>/dev/null && pwd || echo "$worktree_path")
    
    # Find claude processes running in this worktree
    # First check for claude processes with the worktree path
    local pids=$(pgrep -f "claude.*$worktree_path" 2>/dev/null)
    
    # Also check for node processes with the worktree path (for older claude versions)
    if [ -z "$pids" ]; then
        pids=$(pgrep -f "node.*$worktree_path" 2>/dev/null)
    fi
    
    if [ -z "$pids" ]; then
        # Also check for processes where cwd is the worktree
        # On macOS, we need to use lsof to check working directory
        if command -v lsof >/dev/null 2>&1; then
            pids=$(lsof -d cwd 2>/dev/null | grep "$worktree_path" | grep -E "(claude|node)" | awk '{print $2}' | sort -u)
        fi
    fi
    
    if [ -z "$pids" ]; then
        echo "No Claude process found for $agent in $worktree_path"
        return 0
    fi
    
    echo "Killing Claude process(es) for $agent: $pids"
    for pid in $pids; do
        # Send SIGTERM first (graceful shutdown)
        kill -TERM "$pid" 2>/dev/null
    done
    
    # Wait a moment for graceful shutdown
    sleep 2
    
    # Check if any processes still exist
    for pid in $pids; do
        if kill -0 "$pid" 2>/dev/null; then
            echo "Force killing stubborn process: $pid"
            kill -KILL "$pid" 2>/dev/null
        fi
    done
    
    echo "Claude process killed for $agent"
    return 0
}

# If sourced with arguments, run the function
if [ $# -ge 1 ]; then
    kill_worktree_claude "$@"
fi