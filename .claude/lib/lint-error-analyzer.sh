#!/bin/bash
# Lint error analyzer utilities for parallel fixing (JSON format)
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Extract lint errors from JSON output
extract_lint_errors_by_file() {
    local lint_json="$1"
    local output_dir="$2"
    
    mkdir -p "$output_dir"
    
    # Check if we have valid JSON
    if ! jq empty "$lint_json" 2>/dev/null; then
        echo "0"
        return
    fi
    
    # Count total issues first
    local total_count=$(jq '[.[] | .errorCount + .warningCount] | add' "$lint_json" 2>/dev/null || echo "0")
    
    # Process each file in the JSON output
    jq -c '.[]' "$lint_json" 2>/dev/null | while IFS= read -r file_info; do
        local file_path=$(echo "$file_info" | jq -r '.filePath')
        local messages=$(echo "$file_info" | jq -r '.messages')
        
        if [ "$file_path" != "null" ] && [ "$messages" != "[]" ]; then
            local base_name=$(basename "$file_path")
            local error_file="$output_dir/${base_name}.lint"
            
            # Add file path as first line
            echo "$file_path" > "$error_file"
            
            # Write each message to the error file
            echo "$file_info" | jq -r '.messages[] | "\(.line):\(.column) \(.severity) \(.ruleId // "unknown"): \(.message)"' >> "$error_file"
        fi
    done
    
    # Return total issues count
    echo "$total_count"
}

# Analyze lint errors for a file
analyze_lint_errors() {
    local error_file="$1"
    local source_file="$2"
    
    # Initialize counters
    local total_errors=0
    local unused_vars=0
    local missing_deps=0
    local no_undef=0
    local import_errors=0
    local formatting_errors=0
    local react_errors=0
    local typescript_errors=0
    local any_errors=0
    
    # Count errors directly without subshell issues
    total_errors=$(tail -n +2 "$error_file" 2>/dev/null | wc -l | tr -d ' ')
    unused_vars=$(tail -n +2 "$error_file" 2>/dev/null | grep -c "no-unused-vars" || true)
    missing_deps=$(tail -n +2 "$error_file" 2>/dev/null | grep -c "exhaustive-deps" || true)
    no_undef=$(tail -n +2 "$error_file" 2>/dev/null | grep -c "no-undef" || true)
    import_errors=$(tail -n +2 "$error_file" 2>/dev/null | grep -c "import/" || true)
    formatting_errors=$(tail -n +2 "$error_file" 2>/dev/null | grep -cE "(indent|quotes|semi|comma|space)" || true)
    react_errors=$(tail -n +2 "$error_file" 2>/dev/null | grep -c "react/" || true)
    typescript_errors=$(tail -n +2 "$error_file" 2>/dev/null | grep -c "@typescript-eslint/" || true)
    any_errors=$(tail -n +2 "$error_file" 2>/dev/null | grep -c "no-explicit-any" || true)
    
    # Ensure numeric values
    : ${unused_vars:=0}
    : ${missing_deps:=0}
    : ${no_undef:=0}
    : ${import_errors:=0}
    : ${formatting_errors:=0}
    : ${react_errors:=0}
    : ${typescript_errors:=0}
    : ${any_errors:=0}
    
    # Output JSON analysis
    cat << EOF
{
    "file": "$source_file",
    "error_summary": {
        "total_errors": $total_errors,
        "unused_vars": $unused_vars,
        "missing_deps": $missing_deps,
        "no_undef": $no_undef,
        "import_errors": $import_errors,
        "formatting_errors": $formatting_errors,
        "react_errors": $react_errors,
        "typescript_errors": $typescript_errors,
        "any_errors": $any_errors
    }
}
EOF
}

# Generate fix strategy for lint errors
generate_lint_fix_strategy() {
    local error_file="$1"
    local source_file="$2"
    
    # Get error analysis
    local analysis=$(analyze_lint_errors "$error_file" "$source_file")
    
    # Extract counts
    local formatting_errors=$(echo "$analysis" | jq -r '.error_summary.formatting_errors')
    local no_undef=$(echo "$analysis" | jq -r '.error_summary.no_undef')
    local import_errors=$(echo "$analysis" | jq -r '.error_summary.import_errors')
    local total_errors=$(echo "$analysis" | jq -r '.error_summary.total_errors')
    
    # Add strategy to analysis
    echo "$analysis" | jq -c --arg fmt "$formatting_errors" --arg undef "$no_undef" --arg imp "$import_errors" --arg total "$total_errors" '
    . + {
        "fix_strategy": {
            "auto_fixable": ($fmt | tonumber > 0),
            "priority": (
                if ($undef | tonumber > 0) then "high"
                elif ($imp | tonumber > 0) then "high"
                elif .error_summary.unused_vars > 0 then "medium"
                elif .error_summary.missing_deps > 0 then "medium"
                else "low"
                end
            ),
            "estimated_complexity": (
                if ($total | tonumber > 20) then "high"
                elif ($total | tonumber > 10) then "medium"
                else "low"
                end
            )
        }
    }'
}

# Create parallel batches for lint fixing
create_lint_parallel_batches() {
    local errors_dir="$1"
    local max_agents="$2"
    local output_dir="$3"
    
    mkdir -p "$output_dir"
    
    # Get all error files sorted by error count (descending)
    local temp_list=$(mktemp)
    
    for error_file in "$errors_dir"/*.lint; do
        [ -f "$error_file" ] || continue
        # Count lines excluding the first line (file path)
        local count=$(tail -n +2 "$error_file" | wc -l)
        echo "$count $error_file"
    done | sort -rn > "$temp_list"
    
    # Initialize agent directories
    for i in $(seq 1 "$max_agents"); do
        mkdir -p "$output_dir/agent-$i"
        echo "0" > "$output_dir/agent-$i/.workload"
    done
    
    # Distribute files using round-robin with load balancing
    while IFS=' ' read -r count error_file; do
        [ -f "$error_file" ] || continue
        
        # Find agent with least workload
        local min_agent=1
        local min_workload=999999
        
        for i in $(seq 1 "$max_agents"); do
            local workload=$(cat "$output_dir/agent-$i/.workload")
            if [ "$workload" -lt "$min_workload" ]; then
                min_workload="$workload"
                min_agent="$i"
            fi
        done
        
        # Assign file to agent with least work
        cp "$error_file" "$output_dir/agent-$min_agent/"
        
        # Update workload
        local new_workload=$((min_workload + count))
        echo "$new_workload" > "$output_dir/agent-$min_agent/.workload"
        
    done < "$temp_list"
    
    rm -f "$temp_list"
    
    # Clean up workload files
    find "$output_dir" -name ".workload" -delete
}

# Export functions for use in other scripts
export -f extract_lint_errors_by_file
export -f analyze_lint_errors
export -f generate_lint_fix_strategy
export -f create_lint_parallel_batches