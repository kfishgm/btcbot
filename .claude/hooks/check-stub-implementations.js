#!/usr/bin/env node
/**
 * Checks for stub implementations in the codebase
 * Called by complete-task BEFORE running quality checks
 * This saves time by catching stubs early
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
  },
  {
    pattern: /return\s+Promise\.resolve\s*\(\s*\[\s*\]\s*\)/g,
    description: 'Promise resolving to empty array',
    requiresContext: true
  },
  {
    pattern: /return\s+Promise\.resolve\s*\(\s*\{\s*\}\s*\)/g,
    description: 'Promise resolving to empty object',
    requiresContext: true
  }
];

// Get list of files to check
function getFilesToCheck() {
  try {
    // Use git ls-files for better performance and to respect .gitignore
    const files = execSync('git ls-files "*.ts" "*.tsx" "*.js" "*.jsx"', {
      cwd: projectRoot,
      encoding: 'utf-8'
    }).split('\n').filter(f => f);

    // Filter out test files and other non-source files
    return files.filter(file => {
      return !file.includes('node_modules/') &&
             !file.includes('.test.') &&
             !file.includes('.spec.') &&
             !file.includes('__tests__/') &&
             !file.includes('__mocks__/') &&
             !file.includes('e2e/') &&
             !file.includes('.next/') &&
             !file.includes('coverage/') &&
             !file.includes('.claude/') &&
             !file.endsWith('.d.ts');
    });
  } catch (error) {
    console.error('Error getting file list:', error.message);
    return [];
  }
}

// Check if a match is a legitimate empty return (requires context analysis)
function isLegitimateEmpty(content, match, lineNum) {
  const lines = content.split('\n');
  
  // Check previous lines for context (up to 5 lines back)
  for (let i = Math.max(0, lineNum - 5); i < lineNum; i++) {
    const line = lines[i] || '';
    
    // Type definitions and interfaces are not stubs
    if (/^\s*(type|interface|declare)\s+/.test(line)) {
      return true;
    }
    
    // Default or fallback cases might legitimately return empty
    if (/\b(default|fallback|reset|clear|empty)\b/i.test(line)) {
      return true;
    }
    
    // Error handling might legitimately return empty
    if (/\bcatch\s*\(/.test(line)) {
      return true;
    }
    
    // After error logging, empty returns are legitimate
    if (/console\.(error|warn)\s*\(/i.test(line)) {
      return true;
    }
    
    // After response.ok check, empty returns are legitimate  
    if (/if\s*\(\s*!.*response\.ok/i.test(line)) {
      return true;
    }
    
    // In error conditions
    if (/if\s*\(\s*(!|.*error|.*fail|.*invalid)/i.test(line)) {
      return true;
    }
  }
  
  // Check the actual line and next line
  const currentLine = lines[lineNum - 1] || '';
  const nextLine = lines[lineNum] || '';
  
  // Initial state or default values are legitimate
  if (/\b(initial|default|empty|clear)\w*\s*[:=]/i.test(currentLine)) {
    return true;
  }
  
  // Test utilities and mocks are allowed to have stubs
  if (/\b(mock|stub|fake|dummy)\w*/i.test(currentLine)) {
    return true;
  }
  
  // Comments indicating error handling or fallback
  if (/\/\/.*\b(error|fallback|default|empty|fail)/i.test(currentLine) || 
      /\/\/.*\b(error|fallback|default|empty|fail)/i.test(nextLine)) {
    return true;
  }
  
  // Inside try-catch blocks after error conditions
  const surroundingContext = lines.slice(Math.max(0, lineNum - 10), lineNum + 2).join('\n');
  if (/catch\s*\([^)]*\)\s*{[\s\S]*return\s+\[\s*\]/m.test(surroundingContext)) {
    return true;
  }
  
  return false;
}

// Main checking function
function checkForStubs() {
  const files = getFilesToCheck();
  const stubLocations = [];
  let stubsFound = false;

  files.forEach(file => {
    const filePath = path.join(projectRoot, file);
    
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      
      stubPatterns.forEach(({ pattern, description, requiresContext }) => {
        const matches = Array.from(content.matchAll(pattern));
        
        matches.forEach(match => {
          const matchText = match[0];
          const matchIndex = match.index;
          const lineNum = content.substring(0, matchIndex).split('\n').length;
          
          // If context checking is required, verify this isn't legitimate
          if (requiresContext) {
            if (isLegitimateEmpty(content, matchText, lineNum)) {
              return; // Skip this match, it's legitimate
            }
          }
          
          stubsFound = true;
          stubLocations.push({
            file: file,
            line: lineNum,
            match: matchText.trim().substring(0, 50), // Truncate long matches
            description: description
          });
        });
      });
    } catch (error) {
      console.error(`Error reading ${file}:`, error.message);
    }
  });

  return { stubsFound, stubLocations };
}

// Main execution
function main() {
  console.log('🔍 Checking for stub implementations...\n');
  
  const { stubsFound, stubLocations } = checkForStubs();
  
  if (stubsFound) {
    console.error('❌ Stub implementations detected!\n');
    console.error('The following files contain stub implementations that must be replaced with real functionality:\n');
    
    // Group by file for better readability
    const byFile = {};
    stubLocations.forEach(loc => {
      if (!byFile[loc.file]) {
        byFile[loc.file] = [];
      }
      byFile[loc.file].push(loc);
    });
    
    // Show up to 5 files with issues
    const files = Object.keys(byFile).slice(0, 5);
    files.forEach(file => {
      console.error(`📄 ${file}:`);
      byFile[file].slice(0, 3).forEach(loc => {
        console.error(`   Line ${loc.line}: ${loc.description} - "${loc.match}"`);
      });
      if (byFile[file].length > 3) {
        console.error(`   ... and ${byFile[file].length - 3} more in this file`);
      }
      console.error('');
    });
    
    if (Object.keys(byFile).length > 5) {
      console.error(`... and ${Object.keys(byFile).length - 5} more files with stubs\n`);
    }
    
    console.error('✅ To fix: Implement complete, production-ready functionality');
    console.error('❌ Do not: Use empty returns, TODO comments, or "not implemented" errors\n');
    
    process.exit(1);
  }
  
  console.log('✅ No stub implementations detected\n');
  process.exit(0);
}

// Run if called directly
main();