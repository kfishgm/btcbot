#!/bin/bash
# Project-agnostic process management utilities
# Source this file: source .claude/lib/process-utils.sh

# Configuration with sensible defaults
export TIMEOUT_TEST="${TIMEOUT_TEST:-300s}"
export TIMEOUT_BUILD="${TIMEOUT_BUILD:-600s}"
export TIMEOUT_LINT="${TIMEOUT_LINT:-120s}"
export TIMEOUT_TYPECHECK="${TIMEOUT_TYPECHECK:-300s}"
export JEST_OPTS="${JEST_OPTS:---maxWorkers=2 --forceExit --detectOpenHandles}"
export WORKTREE_PATH="${WORKTREE_PATH:-$(pwd)}"

# Run tests with automatic cleanup and concise output
run_tests() {
    local path="${1:-.}"
    local extra_opts="${2:-}"
    
    echo "Testing $path..."
    
    # Run once, capture output
    # Note: no -- needed, jest accepts options directly
    local output=$(timeout "$TIMEOUT_TEST" pnpm test "$path" $JEST_OPTS $extra_opts --silent 2>&1)
    local result=$?
    
    # Always cleanup
    if command -v pkill >/dev/null 2>&1; then
        pkill -f "$WORKTREE_PATH.*jest" 2>/dev/null || true
    else
        ps aux | grep -E "$WORKTREE_PATH.*jest" | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true
    fi
    
    # Show only relevant output
    if [ $result -eq 0 ]; then
        echo "✓ Tests passed"
        echo "$output" | grep -E "Test Suites:|Tests:|Time:" | tail -3
    else
        echo "✗ Tests failed"
        # Show failures but limit output
        echo "$output" | grep -E "FAIL|●|Error:|Expected|Received|Test Suites:" | head -40
    fi
    
    return $result
}

# Run coverage tests with concise output
run_coverage() {
    echo "Running test coverage..."
    
    # Capture output
    # Note: no -- needed, jest accepts options directly
    local output=$(timeout "$TIMEOUT_TEST" pnpm test:coverage $JEST_OPTS 2>&1)
    local result=$?
    
    pkill -f "$WORKTREE_PATH.*jest" 2>/dev/null || true
    
    if [ $result -eq 0 ]; then
        echo "✓ Coverage complete"
        # Show coverage summary
        echo "$output" | grep -E "All files|Coverage|Test Suites:" | tail -10
    else
        echo "✗ Coverage failed"
        echo "$output" | grep -E "FAIL|Error:" | head -20
    fi
    
    return $result
}

# Run linting with cleanup and concise output
run_lint() {
    local fix="${1:---fix}"
    
    echo "Linting..."
    
    # Capture output
    local output=$(timeout "$TIMEOUT_LINT" pnpm lint $fix 2>&1)
    local result=$?
    
    if command -v pkill >/dev/null 2>&1; then
        pkill -f "$WORKTREE_PATH.*eslint" 2>/dev/null || true
    fi
    
    if [ $result -eq 0 ]; then
        echo "✓ Lint passed"
    else
        echo "✗ Lint failed"
        # Show only error summary
        echo "$output" | grep -E "error|warning" | tail -20
        echo "$output" | grep -E "[0-9]+ error|[0-9]+ warning" | tail -1
    fi
    
    return $result
}

# Run typecheck with cleanup and concise output
run_typecheck() {
    echo "Type checking..."
    
    # Capture output
    local output=$(timeout "$TIMEOUT_TYPECHECK" pnpm typecheck 2>&1)
    local result=$?
    
    if command -v pkill >/dev/null 2>&1; then
        pkill -f "$WORKTREE_PATH.*tsc" 2>/dev/null || true
    fi
    
    if [ $result -eq 0 ]; then
        echo "✓ Types OK"
    else
        echo "✗ Type errors"
        # Show only errors, not full context
        echo "$output" | grep -E "error TS|\.tsx?:" | head -20
        echo "$output" | grep "Found [0-9]* error" | tail -1
    fi
    
    return $result
}

# Run build with cleanup and concise output
run_build() {
    echo "Building..."
    
    # Run build with minimal output
    if timeout "$TIMEOUT_BUILD" pnpm build:clean >/dev/null 2>&1; then
        echo "✓ Build successful"
        result=0
    else
        echo "✗ Build failed"
        # Re-run to show error
        timeout "$TIMEOUT_BUILD" pnpm build:clean 2>&1 | grep -E "Error:|ERROR|Failed|failed" | head -20
        result=1
    fi
    
    if command -v pkill >/dev/null 2>&1; then
        pkill -f "$WORKTREE_PATH.*node" 2>/dev/null || true
        pkill -f "$WORKTREE_PATH.*next" 2>/dev/null || true
    fi
    return $result
}

# Run all quality checks
run_quality_checks() {
    local failed=0
    
    echo "=== Running Quality Checks ==="
    echo "Path: ${WORKTREE_PATH:-$(pwd)}"
    echo ""
    
    # Clean up any existing processes before starting
    cleanup_all
    
    # Lint
    if ! run_lint; then
        echo "❌ Lint failed"
        failed=$((failed + 1))
    else
        echo "✅ Lint passed"
    fi
    
    # Typecheck - no exceptions, even for supervisor
    if ! run_typecheck; then
        echo "❌ Typecheck failed"
        failed=$((failed + 1))
    else
        echo "✅ Typecheck passed"
    fi
    
    # Build
    if ! run_build; then
        echo "❌ Build failed"
        failed=$((failed + 1))
    else
        echo "✅ Build passed"
    fi
    
    # Tests - full suite for everyone including supervisor
    if ! run_tests; then
        echo "❌ Tests failed"
        failed=$((failed + 1))
    else
        echo "✅ Tests passed"
    fi
    
    # Clean up all processes after quality checks
    echo ""
    echo "Cleaning up after quality checks..."
    cleanup_all
    
    echo "=== Quality Check Summary ==="
    if [ $failed -eq 0 ]; then
        echo "✅ All quality checks passed!"
        return 0
    else
        echo "❌ $failed quality checks failed"
        echo ""
        echo "STOP: You CANNOT proceed until ALL checks pass."
        echo "This includes fixing issues from other tasks/branches."
        echo "The codebase must be deployable before merging to main."
        echo ""
        echo "Fix ALL issues and run again."
        return 1
    fi
}

# Clean up all processes from current worktree
cleanup_all() {
    local path="${1:-$WORKTREE_PATH}"
    
    echo "Cleaning up all processes from $path..."
    
    # Try to find pkill in common locations
    local PKILL_CMD=""
    if command -v pkill >/dev/null 2>&1; then
        PKILL_CMD="pkill"
    elif [ -x "/usr/bin/pkill" ]; then
        PKILL_CMD="/usr/bin/pkill"
    elif [ -x "/bin/pkill" ]; then
        PKILL_CMD="/bin/pkill"
    fi
    
    if [ -n "$PKILL_CMD" ]; then
        # Kill test and build processes, but NOT dev servers
        $PKILL_CMD -f "$path.*jest" 2>/dev/null || true
        $PKILL_CMD -f "$path.*tsc" 2>/dev/null || true
        $PKILL_CMD -f "$path.*eslint" 2>/dev/null || true
        # Don't kill node or next processes - those might be dev servers
        # Dev servers should be managed separately with dev-server-utils.sh
    else
        echo "⚠️  pkill not available, trying alternative cleanup..."
        # Try using kill with ps (exclude dev servers)
        ps aux | grep -E "$path.*(jest|tsc|eslint)" | grep -v grep | grep -v "pnpm dev" | grep -v "next dev" | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true
    fi
    
    # Brief pause to ensure cleanup
    if command -v sleep >/dev/null 2>&1; then
        sleep 2
    fi
    
    # Verify cleanup
    if command -v pgrep >/dev/null 2>&1; then
        local jest_count=$(pgrep -fc "$path.*jest" 2>/dev/null || echo 0)
        local tsc_count=$(pgrep -fc "$path.*tsc" 2>/dev/null || echo 0)
        local node_count=$(pgrep -fc "$path.*node" 2>/dev/null || echo 0)
        
        if [ $jest_count -eq 0 ] && [ $tsc_count -eq 0 ] && [ $node_count -eq 0 ]; then
            echo "✅ All processes cleaned up successfully"
        else
            echo "⚠️ Warning: Some processes may still be running"
            echo "  Jest: $jest_count, TSC: $tsc_count, Node: $node_count"
        fi
    else
        # Just report success if we can't verify
        echo "✅ Cleanup completed (unable to verify)"
    fi
}

# Pre-cleanup before heavy operations
pre_cleanup() {
    echo "Pre-cleaning any existing processes..."
    cleanup_all
}

# Show help
process_utils_help() {
    cat << EOF
Process Management Utilities

Functions:
  run_tests [path] [opts]  - Run tests with cleanup
  run_coverage            - Run test coverage
  run_lint [--fix]        - Run linter
  run_typecheck           - Run TypeScript check
  run_build               - Run build
  run_quality_checks      - Run all quality checks
  cleanup_all [path]      - Clean up all processes
  pre_cleanup             - Pre-clean before operations

Environment Variables:
  TIMEOUT_TEST            - Test timeout (default: 300s)
  TIMEOUT_BUILD           - Build timeout (default: 600s)
  TIMEOUT_LINT            - Lint timeout (default: 120s)
  TIMEOUT_TYPECHECK       - Typecheck timeout (default: 300s)
  JEST_OPTS               - Jest options (default: --maxWorkers=2 --forceExit)
  WORKTREE_PATH           - Working directory (default: pwd)

Example:
  source .claude/lib/process-utils.sh
  pre_cleanup
  run_quality_checks
EOF
}

# If sourced with --help, show help
if [[ "${1:-}" == "--help" ]]; then
    process_utils_help
fi