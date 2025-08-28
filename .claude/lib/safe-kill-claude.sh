#!/bin/bash
# Safe Claude kill function that prevents tmux session/pane termination

safe_kill_claude() {
    local session_name="$1"
    local pane_num="$2"
    local agent="$3"
    
    # Check current process in pane
    local pane_cmd=$(tmux display-message -t "$session_name:1.$pane_num" -p '#{pane_current_command}' 2>/dev/null || echo "bash")
    local pane_pid=$(tmux display-message -t "$session_name:1.$pane_num" -p '#{pane_pid}' 2>/dev/null)
    
    # Check if claude is running as a child process
    local claude_running=false
    if [ -n "$pane_pid" ] && ps -ef | grep "^[[:space:]]*[0-9][0-9]*[[:space:]][[:space:]]*$pane_pid" | grep -q "claude"; then
        claude_running=true
    fi
    
    if [ "$pane_cmd" = "node" ] || [ "$claude_running" = true ]; then
        # Claude is running - safe to send triple Ctrl+C
        echo "Killing Claude process for $agent..."
        tmux send-keys -t "$session_name:1.$pane_num" C-c
        sleep 0.5
        tmux send-keys -t "$session_name:1.$pane_num" C-c
        sleep 0.5
        tmux send-keys -t "$session_name:1.$pane_num" C-c
        sleep 2
    elif [ "$pane_cmd" = "bash" ] || [ "$pane_cmd" = "zsh" ] || [ "$pane_cmd" = "sh" ]; then
        # Already at shell prompt - just clear any partial command
        echo "Clearing shell prompt for $agent..."
        tmux send-keys -t "$session_name:1.$pane_num" C-c
        sleep 0.5
    else
        # Unknown process - send single interrupt
        echo "Interrupting unknown process '$pane_cmd' for $agent..."
        tmux send-keys -t "$session_name:1.$pane_num" C-c
        sleep 1
    fi
}

# If sourced with arguments, run the function
if [ $# -eq 3 ]; then
    safe_kill_claude "$1" "$2" "$3"
fi