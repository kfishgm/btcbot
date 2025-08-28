#!/bin/bash
# TypeScript error analysis utilities
# Analyzes and categorizes TypeScript errors for parallel fixing

# Function to extract errors by file (excludes .gitignored files but includes new untracked files)
extract_errors_by_file() {
    local error_output="$1"
    local output_dir="${2:-.}"
    
    # Create directory for error reports
    mkdir -p "$output_dir/errors-by-file"
    
    # Parse TypeScript errors and group by file
    local current_file=""
    local error_count=0
    
    while IFS= read -r line; do
        # Check if this is a file error line (format: file.ts(line,col): error TS####: message)
        if echo "$line" | grep -qE "^[^:]+\.(ts|tsx)\([0-9]+,[0-9]+\): error TS[0-9]+:"; then
            current_file=$(echo "$line" | cut -d'(' -f1)
            
            # Check if file should be processed:
            # 1. Skip if in node_modules, dist, build, .next
            if echo "$current_file" | grep -qE "/(node_modules|dist|build|\.next)/"; then
                current_file=""
                continue
            fi
            
            # 2. Skip if file would be ignored by git (uses .gitignore rules)
            # git check-ignore returns 0 if file is ignored
            if git check-ignore "$current_file" >/dev/null 2>&1; then
                current_file=""
                continue
            fi
            
            # 3. Process if file exists (whether tracked or untracked)
            if [ -f "$current_file" ]; then
                echo "$line" >> "$output_dir/errors-by-file/$(basename "$current_file").errors"
                ((error_count++))
            else
                current_file=""
            fi
        elif [ -n "$current_file" ] && [ -n "$line" ]; then
            # Continuation of previous error (only if we're tracking this file)
            echo "$line" >> "$output_dir/errors-by-file/$(basename "$current_file").errors"
        fi
    done < "$error_output"
    
    echo "$error_count"
}

# Function to categorize errors by type
categorize_errors() {
    local error_file="$1"
    
    local any_count=$(grep -c "TS7006: Parameter .* implicitly has an 'any' type" "$error_file" 2>/dev/null || echo 0)
    any_count=$((any_count + $(grep -c "TS7031: Binding element .* implicitly has an 'any' type" "$error_file" 2>/dev/null || echo 0)))
    any_count=$((any_count + $(grep -c "has an 'any' type" "$error_file" 2>/dev/null || echo 0)))
    
    local missing_type_count=$(grep -c "TS2339: Property .* does not exist on type" "$error_file" 2>/dev/null || echo 0)
    local undefined_count=$(grep -c "TS2304: Cannot find name" "$error_file" 2>/dev/null || echo 0)
    local import_count=$(grep -c "TS2305: Module .* has no exported member" "$error_file" 2>/dev/null || echo 0)
    
    echo "any_types=$any_count"
    echo "missing_properties=$missing_type_count"
    echo "undefined_names=$undefined_count"
    echo "import_errors=$import_count"
    echo "total=$(wc -l < "$error_file" | tr -d ' ')"
}

# Function to generate fix strategy
generate_fix_strategy() {
    local error_file="$1"
    local source_file="$2"
    
    # Count error types
    local any_count=0
    local missing_type_count=0
    local undefined_count=0
    local import_count=0
    local total=0
    
    if [ -f "$error_file" ]; then
        # Count any type errors
        if grep -q "TS7006: Parameter .* implicitly has an 'any' type" "$error_file"; then
            any_count=$(grep -c "TS7006: Parameter .* implicitly has an 'any' type" "$error_file")
        fi
        
        if grep -q "TS7031: Binding element .* implicitly has an 'any' type" "$error_file"; then
            any_count=$((any_count + $(grep -c "TS7031: Binding element .* implicitly has an 'any' type" "$error_file")))
        fi
        
        if grep -q "has an 'any' type" "$error_file"; then
            any_count=$((any_count + $(grep -c "has an 'any' type" "$error_file")))
        fi
        
        # Count other error types
        if grep -q "TS2339: Property .* does not exist on type" "$error_file"; then
            missing_type_count=$(grep -c "TS2339: Property .* does not exist on type" "$error_file")
        fi
        
        if grep -q "TS2304: Cannot find name" "$error_file"; then
            undefined_count=$(grep -c "TS2304: Cannot find name" "$error_file")
        fi
        
        if grep -q "TS2305: Module .* has no exported member" "$error_file"; then
            import_count=$(grep -c "TS2305: Module .* has no exported member" "$error_file")
        fi
        
        total=$(wc -l < "$error_file" | tr -d ' ')
    fi
    
    # Build fix strategy array
    local strategies=""
    [ "$import_count" -gt 0 ] && strategies="${strategies}\"Fix import statements first\","
    [ "$undefined_count" -gt 0 ] && strategies="${strategies}\"Define missing types/interfaces\","
    [ "$any_count" -gt 0 ] && strategies="${strategies}\"Replace any types with proper types\","
    [ "$missing_type_count" -gt 0 ] && strategies="${strategies}\"Add missing properties to types\","
    strategies="${strategies}\"Run typecheck on this file to verify all errors are fixed\""
    
    cat << EOF
{
  "file": "$source_file",
  "error_summary": {
    "any_types": $any_count,
    "missing_properties": $missing_type_count,
    "undefined_names": $undefined_count,
    "import_errors": $import_count,
    "total_errors": $total
  },
  "fix_strategy": [$strategies],
  "priority": $([ "$any_count" -gt 10 ] && echo "1" || echo "2")
}
EOF
}

# Function to create batches for parallel processing
create_parallel_batches() {
    local error_dir="$1"
    local max_agents="${2:-5}"
    local output_dir="${3:-.}"
    
    # Get all error files sorted by error count (descending)
    local files_by_errors=$(
        for f in "$error_dir"/*.errors; do
            [ -f "$f" ] || continue
            echo "$(wc -l < "$f" | tr -d ' ') $f"
        done | sort -rn
    )
    
    # Distribute files among agents using round-robin for load balancing
    local agent_num=1
    while IFS=' ' read -r count file; do
        [ -z "$file" ] && continue
        
        mkdir -p "$output_dir/agent-$agent_num"
        cp "$file" "$output_dir/agent-$agent_num/"
        
        # Round-robin distribution
        agent_num=$((agent_num % max_agents + 1))
    done <<< "$files_by_errors"
}

# Show help if sourced with --help
if [[ "${1:-}" == "--help" ]]; then
    cat << EOF
TypeScript Error Analyzer Utilities

Functions:
  extract_errors_by_file <error_output> [output_dir] - Group errors by file
  categorize_errors <error_file> - Categorize error types
  generate_fix_strategy <error_file> <source_file> - Create fix strategy
  create_parallel_batches <error_dir> [max_agents] [output_dir] - Distribute work

Usage:
  source typescript-error-analyzer.sh
  extract_errors_by_file typecheck-output.txt ./analysis
  create_parallel_batches ./analysis/errors-by-file 5 ./batches
EOF
fi