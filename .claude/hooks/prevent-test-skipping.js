#!/usr/bin/env node
/**
 * PreToolUse hook for Edit|Write|MultiEdit operations
 * Prevents adding .skip or .only to test files, but allows removing them
 */

import fs from 'fs';

try {
  // Read input from stdin
  const input = JSON.parse(fs.readFileSync(0, 'utf-8'));
  const { tool_name, tool_input } = input;
  
  // Only check Edit and MultiEdit operations (not Write for new files)
  if (tool_name !== 'Edit' && tool_name !== 'MultiEdit') {
    process.exit(0);
  }
  
  const filePath = tool_input.file_path || '';
  
  // Only check test files
  if (!filePath.match(/\.(test|spec)\.(ts|tsx|js|jsx)$/)) {
    process.exit(0);
  }
  
  // Check edits for adding .skip or .only
  let edits = [];
  if (tool_name === 'Edit') {
    edits = [{ old: tool_input.old_string, new: tool_input.new_string }];
  } else if (tool_name === 'MultiEdit') {
    edits = tool_input.edits.map(e => ({ old: e.oldText || e.old_string, new: e.newText || e.new_string }));
  }
  
  for (const edit of edits) {
    const oldText = edit.old || '';
    const newText = edit.new || '';
    
    // Count .skip and .only in old vs new text
    const oldSkipCount = (oldText.match(/\.(skip|only)\(/g) || []).length;
    const newSkipCount = (newText.match(/\.(skip|only)\(/g) || []).length;
    
    // Also check for xdescribe, xit, fdescribe, fit
    const oldXCount = (oldText.match(/\b(xdescribe|xit|fdescribe|fit)\(/g) || []).length;
    const newXCount = (newText.match(/\b(xdescribe|xit|fdescribe|fit)\(/g) || []).length;
    
    // If adding .skip/.only (count increased), block it
    if (newSkipCount > oldSkipCount || newXCount > oldXCount) {
      console.error('❌ Adding .skip or .only to tests is forbidden');
      console.error('You must fix failing tests, not skip them.');
      console.error('If a test is invalid, delete it with justification.');
      console.error('');
      console.error('Detected patterns:');
      if (newSkipCount > oldSkipCount) {
        console.error('  - .skip() or .only() added');
      }
      if (newXCount > oldXCount) {
        console.error('  - xdescribe/xit/fdescribe/fit added');
      }
      process.exit(2);
    }
    
    // If removing .skip/.only (count decreased), that's good!
    if (newSkipCount < oldSkipCount || newXCount < oldXCount) {
      console.log('✅ Removing .skip/.only from tests - good!');
    }
  }
  
  process.exit(0);
} catch (error) {
  // On error, allow the operation
  process.exit(0);
}