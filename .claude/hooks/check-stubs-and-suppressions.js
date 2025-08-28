#!/usr/bin/env node
/**
 * Checks for stub implementations and suppressions in the codebase
 * Called by complete-task BEFORE running quality checks
 * This saves time by catching stubs and suppressions early
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Get project root from environment or current directory
const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Patterns that indicate stub implementations
const stubPatterns = [
  {
    pattern: /return\s+\[\s*\](?:\s+as\s+\w+)?[;\s]*$/gm,
    description: 'Empty array return',
    requiresContext: true  // Need to check if this is legitimate
  },
  {
    pattern: /return\s+\{\s*\}(?:\s+as\s+\w+)?[;\s]*$/gm,
    description: 'Empty object return',
    requiresContext: true
  },
  {
    pattern: /throw\s+new\s+Error\s*\(\s*['"`]not\s+implemented/gi,
    description: 'Not implemented error',
    requiresContext: false  // Always a stub
  },
  {
    pattern: /\/\/\s*TODO:\s*implement/gi,
    description: 'TODO implement comment',
    requiresContext: false
  },
  {
    pattern: /console\.\w+\s*\(\s*['"`]stub/gi,
    description: 'Stub console log',
    requiresContext: false
  },
  {
    pattern: /export\s+(?:async\s+)?function\s+\w+\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{[\s\n]*\}/g,
    description: 'Empty function body',
    requiresContext: true
  },
  {
    pattern: /=>\s*\{\s*\}(?:\s*[,;)])/g,
    description: 'Empty arrow function',
    requiresContext: true
  }
];

// Suppression patterns to check for
const suppressionPatterns = [
  {
    pattern: /@ts-ignore/gi,
    description: '@ts-ignore comment'
  },
  {
    pattern: /@ts-nocheck/gi,
    description: '@ts-nocheck comment'
  },
  {
    pattern: /@ts-expect-error/gi,
    description: '@ts-expect-error comment'
  },
  {
    pattern: /eslint-disable(?:-next-line|-line)?/gi,
    description: 'eslint-disable comment'
  }
];

// Patterns for 'any' type usage
const anyTypePatterns = [
  {
    pattern: /:\s*any\b/g,
    description: ': any type annotation'
  },
  {
    pattern: /<any>/g,
    description: '<any> type assertion'
  },
  {
    pattern: /\bas\s+any\b/g,
    description: 'as any type assertion'
  },
  {
    pattern: /\bany\[\]/g,
    description: 'any[] array type'
  },
  {
    pattern: /\bArray<any>/g,
    description: 'Array<any> type'
  },
  {
    pattern: /\bPromise<any>/g,
    description: 'Promise<any> type'
  },
  {
    pattern: /\bRecord<[^,]+,\s*any>/g,
    description: 'Record with any value type'
  }
];

function checkFile(filePath, relativePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const violations = [];
  
  // Skip test files for stub and any checks
  const isTestFile = relativePath.includes('.test.') || 
                     relativePath.includes('.spec.') || 
                     relativePath.includes('__tests__/') ||
                     relativePath.includes('__mocks__/') ||
                     relativePath.includes('/test/') ||
                     relativePath.includes('/tests/');
  
  // Check for stub patterns (SKIP for test files - they need stubs for mocking)
  if (!isTestFile) {
    for (const stub of stubPatterns) {
      const matches = content.match(stub.pattern);
      if (matches) {
        // For patterns that require context, do additional checks
        if (stub.requiresContext) {
          // Skip empty arrays/objects that are legitimate defaults
          if (stub.description === 'Empty array return' || stub.description === 'Empty object return') {
            // Check if it's a default value, initial state, or legitimate empty return
            const legitimateUses = matches.filter(match => {
              const lineIndex = content.indexOf(match);
              const lineStart = content.lastIndexOf('\n', lineIndex) + 1;
              const lineEnd = content.indexOf('\n', lineIndex);
              const line = content.substring(lineStart, lineEnd);
              
              // Get surrounding context (5 lines before and after)
              const contextStart = Math.max(0, content.lastIndexOf('\n', lineStart - 200));
              const contextEnd = Math.min(content.length, content.indexOf('\n', lineEnd + 200));
              const context = content.substring(contextStart, contextEnd).toLowerCase();
              
              // Legitimate patterns for empty arrays/objects
              const legitimatePatterns = [
                // Default parameters or initial state
                line.includes('=') || line.includes('useState') || line.includes('default'),
                // Database/API responses when no data found
                context.includes('data ||') || context.includes('data ??'),
                context.includes('|| []') || context.includes('?? []'),
                context.includes('|| {}') || context.includes('?? {}'),
                // Conditional returns based on data checks
                context.includes('if (!data') || context.includes('if (data.length === 0'),
                context.includes('data?.length') || context.includes('results?.length'),
                // Error handling returns
                context.includes('if (error)') || context.includes('catch'),
                // Query/fetch operations
                context.includes('supabase') || context.includes('fetch') || context.includes('query'),
                context.includes('select') || context.includes('from('),
                // Filter/map/reduce operations that can legitimately return empty
                context.includes('.filter(') || context.includes('.map('),
                // Explicit "no results" handling
                context.includes('no results') || context.includes('not found') || context.includes('empty')
              ];
              
              // If any legitimate pattern is found, this is likely NOT a stub
              const isLegitimate = legitimatePatterns.some(pattern => pattern === true);
              
              // Return true only if this looks like a stub (no legitimate patterns found)
              return !isLegitimate;
            });
            
            if (legitimateUses.length > 0) {
              violations.push({
                file: relativePath,
                type: 'stub',
                description: stub.description,
                count: legitimateUses.length
              });
            }
          } else {
            violations.push({
              file: relativePath,
              type: 'stub',
              description: stub.description,
              count: matches.length
            });
          }
        } else {
          violations.push({
            file: relativePath,
            type: 'stub',
            description: stub.description,
            count: matches.length
          });
        }
      }
    }
  }
  
  // Check for suppression comments (SKIP for test files - they need suppressions for edge cases)
  if (!isTestFile) {
    for (const suppression of suppressionPatterns) {
      const matches = content.match(suppression.pattern);
      if (matches) {
        violations.push({
          file: relativePath,
          type: 'suppression',
          description: suppression.description,
          count: matches.length
        });
      }
    }
  }
  
  // Check for 'any' types (skip test files - they can use any for mocks)
  if (!isTestFile) {
    // Remove comments and strings before checking for 'any'
    let cleanContent = content
      .replace(/\/\*[\s\S]*?\*\//g, '')   // Remove block comments
      .replace(/\/\/.*$/gm, '')            // Remove line comments
      .replace(/'[^']*'/g, '""')           // Remove single-quoted strings
      .replace(/"[^"]*"/g, '""')           // Remove double-quoted strings
      .replace(/`[^`]*`/g, '""');          // Remove template strings
    
    for (const anyPattern of anyTypePatterns) {
      const matches = cleanContent.match(anyPattern.pattern);
      if (matches) {
        violations.push({
          file: relativePath,
          type: 'any',
          description: anyPattern.description,
          count: matches.length
        });
      }
    }
  }
  
  return violations;
}

function scanDirectory(dir, baseDir = dir) {
  let allViolations = [];
  
  try {
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const relativePath = path.relative(baseDir, fullPath);
      
      // Skip common directories
      if (item === 'node_modules' || item === '.git' || item === 'dist' || 
          item === 'build' || item === '.next' || item === 'coverage') {
        continue;
      }
      
      // Skip .claude directory (infrastructure files)
      if (item === '.claude' || relativePath.startsWith('.claude/')) {
        continue;
      }
      
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        // Recursively scan subdirectories
        allViolations = allViolations.concat(scanDirectory(fullPath, baseDir));
      } else if (stat.isFile()) {
        // Check TypeScript/JavaScript files
        if (/\.(ts|tsx|js|jsx)$/.test(item)) {
          const violations = checkFile(fullPath, relativePath);
          allViolations = allViolations.concat(violations);
        }
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dir}:`, error.message);
  }
  
  return allViolations;
}

// Main execution
console.log('Checking for stubs, suppressions, and any types...\n');

const violations = scanDirectory(projectRoot);

if (violations.length === 0) {
  console.log('✅ No stubs, suppressions, or any types detected!');
  process.exit(0);
} else {
  console.error('❌ Code quality violations detected!\n');
  
  // Group violations by type
  const stubs = violations.filter(v => v.type === 'stub');
  const suppressions = violations.filter(v => v.type === 'suppression');
  const anyTypes = violations.filter(v => v.type === 'any');
  
  // Report stub implementations
  if (stubs.length > 0) {
    console.error('📦 STUB IMPLEMENTATIONS FOUND:');
    console.error('─'.repeat(50));
    console.error('⚠️  IMPLEMENTER: FULLY IMPLEMENT TO REMOVE STUB');
    console.error('─'.repeat(50));
    const stubsByFile = {};
    stubs.forEach(v => {
      if (!stubsByFile[v.file]) stubsByFile[v.file] = [];
      stubsByFile[v.file].push(`  - ${v.description} (${v.count}x)`);
    });
    
    for (const [file, descriptions] of Object.entries(stubsByFile)) {
      console.error(`\n${file}:`);
      descriptions.forEach(d => console.error(d));
      console.error('  → IMPLEMENTER: FULLY IMPLEMENT TO REMOVE STUB');
    }
    console.error('');
  }
  
  // Report suppressions
  if (suppressions.length > 0) {
    console.error('🚫 SUPPRESSION COMMENTS FOUND:');
    console.error('─'.repeat(50));
    const suppressionsByFile = {};
    suppressions.forEach(v => {
      if (!suppressionsByFile[v.file]) suppressionsByFile[v.file] = [];
      suppressionsByFile[v.file].push(`  - ${v.description} (${v.count}x)`);
    });
    
    for (const [file, descriptions] of Object.entries(suppressionsByFile)) {
      console.error(`\n${file}:`);
      descriptions.forEach(d => console.error(d));
    }
    console.error('');
  }
  
  // Report any types
  if (anyTypes.length > 0) {
    console.error('⚠️  ANY TYPES FOUND:');
    console.error('─'.repeat(50));
    const anyByFile = {};
    anyTypes.forEach(v => {
      if (!anyByFile[v.file]) anyByFile[v.file] = [];
      anyByFile[v.file].push(`  - ${v.description} (${v.count}x)`);
    });
    
    for (const [file, descriptions] of Object.entries(anyByFile)) {
      console.error(`\n${file}:`);
      descriptions.forEach(d => console.error(d));
    }
    console.error('');
  }
  
  console.error('─'.repeat(50));
  console.error('\n📝 REQUIRED FIXES:\n');
  
  if (stubs.length > 0) {
    console.error('• Replace stub implementations with real code');
  }
  if (suppressions.length > 0) {
    console.error('• Remove @ts-ignore/@ts-nocheck/eslint-disable');
    console.error('  Fix the underlying issues instead');
  }
  if (anyTypes.length > 0) {
    console.error('• Replace "any" with proper types');
    console.error('  Use "unknown" + type guards or define interfaces');
  }
  
  console.error('\nThe code must be production-ready before merging!');
  
  process.exit(1);
}