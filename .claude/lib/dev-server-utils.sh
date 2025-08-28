#!/bin/bash
# Dev server management utilities for agent worktrees
# Each agent manages their own dev server on a specific port

# Get project information
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
PROJECT_NAME=$(basename "$PROJECT_ROOT")
PROJECT_NAME_LOWER=$(echo "$PROJECT_NAME" | tr '[:upper:]' '[:lower:]')

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Port assignments by worktree
get_dev_server_port() {
    local worktree_path="${1:-$(pwd)}"
    local worktree_name=$(basename "$worktree_path")
    
    # Check for worktree suffix patterns first (most specific)
    if [[ "$worktree_name" == *-arch ]] || [[ "$worktree_name" == *-architect ]]; then
        echo "3001"  # Architect
    elif [[ "$worktree_name" == *-test ]] || [[ "$worktree_name" == *-tester ]]; then
        echo "3002"  # Test
    elif [[ "$worktree_name" == *-impl ]] || [[ "$worktree_name" == *-implementation ]] || [[ "$worktree_name" == *-implementer ]]; then
        echo "3003"  # Implementation
    elif [[ "$worktree_name" == *-supervisor ]]; then
        echo "3004"  # Supervisor
    else
        # Main project or default
        echo "3000"
    fi
}

# Kill dev server for specific worktree
kill_worktree_dev_server() {
    local worktree_path="${1:-$(pwd)}"
    local port=$(get_dev_server_port "$worktree_path")
    
    echo -e "${YELLOW}Stopping dev server on port $port for $worktree_path...${NC}"
    
    # Kill by port first (most accurate)
    if command -v lsof >/dev/null 2>&1; then
        local pids=$(lsof -ti:$port 2>/dev/null)
        if [ -n "$pids" ]; then
            echo "$pids" | xargs kill -TERM 2>/dev/null || true
            sleep 2
            # Force kill if still running
            echo "$pids" | xargs kill -9 2>/dev/null || true
            echo -e "${GREEN}✓ Killed dev server on port $port${NC}"
        fi
    fi
    
    # Also kill by worktree path pattern (cleanup any stragglers)
    if command -v pkill >/dev/null 2>&1; then
        pkill -f "$worktree_path.*next dev" 2>/dev/null || true
        pkill -f "$worktree_path.*pnpm dev" 2>/dev/null || true
        pkill -f "PORT=$port.*pnpm dev" 2>/dev/null || true
    fi
    
    # Verify port is free
    sleep 1
    if command -v lsof >/dev/null 2>&1; then
        if ! lsof -ti:$port >/dev/null 2>&1; then
            echo -e "${GREEN}✓ Port $port is now free${NC}"
            return 0
        else
            echo -e "${RED}⚠️  Warning: Port $port may still be in use${NC}"
            return 1
        fi
    fi
}

# Start dev server for specific worktree
start_worktree_dev_server() {
    local worktree_path="${1:-$(pwd)}"
    local port=$(get_dev_server_port "$worktree_path")
    local worktree_name=$(basename "$worktree_path")
    
    # Kill any existing server on this port first
    kill_worktree_dev_server "$worktree_path"
    
    echo -e "${CYAN}Starting dev server for $worktree_name on port $port...${NC}"
    
    # Start dev server in background with proper detachment (no cd in main shell)
    (
        cd "$worktree_path"
        export PORT="$port"
        export NEXT_PUBLIC_SITE_URL="http://localhost:$port"
        export NEXT_PUBLIC_APP_URL="http://localhost:$port"
        nohup pnpm dev > "$worktree_path/.dev-server.log" 2>&1 &
        echo $! > "$worktree_path/.dev-server.pid"
    ) &
    
    # Brief pause to let server start initializing
    sleep 2
    
    # Get the PID
    local pid=$(cat "$worktree_path/.dev-server.pid" 2>/dev/null)
    
    # Check if process started
    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
        echo -e "${RED}✗ Failed to start dev server${NC}"
        return 1
    fi
    
    echo -e "${YELLOW}Dev server starting on port $port (PID: $pid)...${NC}"
    echo -e "${BLUE}Logs: $worktree_path/.dev-server.log${NC}"
    
    # Quick check with timeout (non-blocking, max 3 seconds)
    local max_attempts=3
    local attempt=0
    
    while [ $attempt -lt $max_attempts ]; do
        if timeout 1 curl -s "http://localhost:$port" > /dev/null 2>&1; then
            echo -e "${GREEN}✓ Dev server responding on port $port${NC}"
            return 0
        fi
        sleep 1
        attempt=$((attempt + 1))
    done
    
    # Server is starting but not yet responding - that's OK
    echo -e "${YELLOW}Dev server started (PID: $pid) on port $port${NC}"
    echo -e "${YELLOW}Server initializing... Check status with: .claude/lib/check-dev-server${NC}"
    return 0  # Return success since process is running
}

# Restart dev server for specific worktree
restart_worktree_dev_server() {
    local worktree_path="${1:-$(pwd)}"
    
    echo -e "${CYAN}Restarting dev server for $(basename "$worktree_path")...${NC}"
    kill_worktree_dev_server "$worktree_path"
    sleep 2
    start_worktree_dev_server "$worktree_path"
}

# Check dev server status for worktree
check_worktree_dev_server() {
    local worktree_path="${1:-$(pwd)}"
    local port=$(get_dev_server_port "$worktree_path")
    local worktree_name=$(basename "$worktree_path")
    
    echo -e "${CYAN}Checking dev server for $worktree_name (port $port)...${NC}"
    
    # Check if port is in use
    if command -v lsof >/dev/null 2>&1; then
        local pid=$(lsof -ti:$port 2>/dev/null | head -1)
        if [ -n "$pid" ]; then
            echo -e "${GREEN}✓ Dev server is running on port $port (PID: $pid)${NC}"
            
            # Check if it's actually responding
            if curl -s "http://localhost:$port" > /dev/null 2>&1; then
                echo -e "${GREEN}✓ Server is responding at http://localhost:$port${NC}"
            else
                echo -e "${YELLOW}⚠️  Server on port $port is not responding to HTTP requests${NC}"
            fi
        else
            echo -e "${YELLOW}✗ No dev server running on port $port${NC}"
        fi
    else
        # Fallback: try to connect
        if curl -s "http://localhost:$port" > /dev/null 2>&1; then
            echo -e "${GREEN}✓ Dev server is responding on port $port${NC}"
        else
            echo -e "${YELLOW}✗ Dev server is not responding on port $port${NC}"
        fi
    fi
    
    # Check for PID file
    if [ -f "$worktree_path/.dev-server.pid" ]; then
        local saved_pid=$(cat "$worktree_path/.dev-server.pid")
        if kill -0 "$saved_pid" 2>/dev/null; then
            echo -e "${BLUE}ℹ️  Saved PID $saved_pid is still running${NC}"
        else
            echo -e "${YELLOW}⚠️  Saved PID $saved_pid is not running (stale PID file)${NC}"
            rm -f "$worktree_path/.dev-server.pid"
        fi
    fi
}

# Kill all agent dev servers (but not main)
kill_all_agent_dev_servers() {
    echo -e "${YELLOW}Stopping all agent dev servers...${NC}"
    
    # Kill specific ports
    for port in 3001 3002 3003 3004; do
        if command -v lsof >/dev/null 2>&1; then
            local pids=$(lsof -ti:$port 2>/dev/null)
            if [ -n "$pids" ]; then
                echo -e "${YELLOW}Killing processes on port $port${NC}"
                echo "$pids" | xargs kill -TERM 2>/dev/null || true
            fi
        fi
    done
    
    # Clean up PID files
    for suffix in arch test impl supervisor; do
        local worktree="$(dirname "$PROJECT_ROOT")/${PROJECT_NAME_LOWER}-${suffix}"
        if [ -f "$worktree/.dev-server.pid" ]; then
            rm -f "$worktree/.dev-server.pid"
        fi
    done
    
    echo -e "${GREEN}✓ All agent dev servers stopped${NC}"
}

# Export functions for use in other scripts
export -f get_dev_server_port
export -f kill_worktree_dev_server
export -f start_worktree_dev_server
export -f restart_worktree_dev_server
export -f check_worktree_dev_server
export -f kill_all_agent_dev_servers

# CLI interface
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    case "${1:-help}" in
        start)
            start_worktree_dev_server "${2:-$(pwd)}"
            ;;
        stop|kill)
            kill_worktree_dev_server "${2:-$(pwd)}"
            ;;
        restart)
            restart_worktree_dev_server "${2:-$(pwd)}"
            ;;
        status|check)
            check_worktree_dev_server "${2:-$(pwd)}"
            ;;
        port)
            get_dev_server_port "${2:-$(pwd)}"
            ;;
        kill-all)
            kill_all_agent_dev_servers
            ;;
        *)
            echo "Dev Server Management Utilities"
            echo "Usage: $0 [command] [worktree-path]"
            echo ""
            echo "Commands:"
            echo "  start [path]    - Start dev server for worktree"
            echo "  stop [path]     - Stop dev server for worktree"
            echo "  restart [path]  - Restart dev server for worktree"
            echo "  status [path]   - Check dev server status"
            echo "  port [path]     - Get assigned port for worktree"
            echo "  kill-all        - Stop all agent dev servers"
            echo ""
            echo "Port assignments:"
            echo "  3000 - Main project"
            echo "  3001 - Architect worktree"
            echo "  3002 - Test worktree"
            echo "  3003 - Implementation worktree"
            echo "  3004 - Supervisor worktree"
            ;;
    esac
fi