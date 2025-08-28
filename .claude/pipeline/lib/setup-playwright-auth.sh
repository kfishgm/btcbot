#!/bin/bash
# Setup Playwright authentication state for pipeline agents

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

echo "Setting up Playwright authentication state..."

# Ensure the auth directory exists
mkdir -p "$PROJECT_ROOT/playwright/.auth"

# Check if auth file already exists in main branch
if [ -f "$PROJECT_ROOT/../playwright/.auth/user.json" ]; then
    echo "Found existing auth file, copying to worktree..."
    cp "$PROJECT_ROOT/../playwright/.auth/user.json" "$PROJECT_ROOT/playwright/.auth/user.json"
else
    echo "No existing auth file found, creating new one..."
    
    # Start dev server in background
    cd "$PROJECT_ROOT"
    pnpm dev > /tmp/playwright-setup-dev.log 2>&1 &
    DEV_PID=$!
    
    # Wait for server to be ready
    echo "Waiting for dev server..."
    for i in {1..30}; do
        if curl -s http://localhost:3000 > /dev/null 2>&1; then
            break
        fi
        sleep 1
    done
    
    # Run the setup project to create auth state
    echo "Running authentication setup..."
    pnpm exec playwright test --project=setup --reporter=list || {
        kill $DEV_PID 2>/dev/null || true
        echo "Failed to run auth setup"
        exit 1
    }
    
    # Stop dev server
    kill $DEV_PID 2>/dev/null || true
    
    # Copy auth file to shared location if it was created successfully
    if [ -f "$PROJECT_ROOT/playwright/.auth/user.json" ]; then
        mkdir -p "$PROJECT_ROOT/../playwright/.auth"
        cp "$PROJECT_ROOT/playwright/.auth/user.json" "$PROJECT_ROOT/../playwright/.auth/user.json"
        echo "Auth state saved to shared location"
    fi
fi

echo "Playwright auth setup complete"