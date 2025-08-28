#!/bin/bash
# Simple process cleanup script that works in any environment

cleanup_project_processes() {
    echo "Cleaning up btcbot processes..."
    
    # Use absolute paths for commands
    local PKILL="/usr/bin/pkill"
    local PS="/bin/ps"
    local GREP="/usr/bin/grep"
    local AWK="/usr/bin/awk"
    local KILL="/bin/kill"
    
    # Kill test/build processes only (not dev servers or tmux)
    for pattern in "jest" "tsc" "eslint"; do
        echo "  Cleaning $pattern processes..."
        # More targeted approach - only kill node processes running these tools
        $PS aux 2>/dev/null | $GREP "node.*$pattern" | $GREP -v grep | $AWK '{print $2}' | while read pid; do
            $KILL -9 $pid 2>/dev/null || true
        done
    done
    
    # Note: Dev servers (next, pnpm dev) should be managed with dev-server-utils.sh
    
    # Kill by project path - but exclude tmux and essential processes
    for project in "btcbot" "btcbot"; do
        echo "  Cleaning $project test/build processes..."
        # Only kill node processes in project path, not tmux or shell sessions
        if [ -x "$PKILL" ]; then
            # Kill node processes but exclude tmux, bash, sh, zsh
            $PS aux 2>/dev/null | $GREP "/Users/kfish/projects/$project" | \
                $GREP -E "(node|jest|tsc|eslint)" | \
                $GREP -v "tmux" | \
                $GREP -v grep | \
                $AWK '{print $2}' | while read pid; do
                    $KILL -9 $pid 2>/dev/null || true
                done
        fi
    done
    
    echo "✅ Cleanup complete"
}

# Run if executed directly
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    cleanup_project_processes
fi