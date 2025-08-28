#!/usr/bin/env node
/**
 * PostToolUse hook for Edit/Write/MultiEdit operations
 * Automatically formats files with Prettier after editing
 */

import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';

try {
  // Read input from stdin
  const input = JSON.parse(fs.readFileSync(0, 'utf-8'));
  const { tool_name, tool_input, tool_output } = input;
  
  // Only process Edit, Write, and MultiEdit operations
  if (!['Edit', 'Write', 'MultiEdit'].includes(tool_name)) {
    process.exit(0);
  }
  
  // Get the file path
  let filePath = tool_input.file_path;
  
  if (!filePath) {
    process.exit(0);
  }
  
  // Check if file has a supported extension for Prettier
  const supportedExtensions = [
    '.js', '.jsx', '.ts', '.tsx',
    '.json', '.css', '.scss', '.less',
    '.html', '.vue', '.angular',
    '.md', '.mdx', '.yml', '.yaml'
  ];
  
  const ext = path.extname(filePath).toLowerCase();
  if (!supportedExtensions.includes(ext)) {
    process.exit(0);
  }
  
  // Skip if file doesn't exist (might be a failed operation)
  if (!fs.existsSync(filePath)) {
    process.exit(0);
  }
  
  // Check if prettier is available
  try {
    execSync('which prettier', { stdio: 'ignore' });
  } catch {
    // Try with npx
    try {
      execSync('which npx', { stdio: 'ignore' });
    } catch {
      console.log('⚠️  Prettier not found, skipping formatting');
      process.exit(0);
    }
  }
  
  // Format the file with Prettier
  try {
    // Try to use local prettier first (respects project config)
    const prettierCmd = fs.existsSync('node_modules/.bin/prettier') 
      ? 'node_modules/.bin/prettier'
      : 'npx prettier';
    
    // Check if file needs formatting
    const checkCmd = `${prettierCmd} --check "${filePath}" 2>/dev/null`;
    try {
      execSync(checkCmd, { stdio: 'ignore' });
      // File is already formatted
      process.exit(0);
    } catch {
      // File needs formatting
    }
    
    // Format the file
    console.log(`🎨 Formatting ${path.basename(filePath)} with Prettier...`);
    const formatCmd = `${prettierCmd} --write "${filePath}" 2>&1`;
    const output = execSync(formatCmd, { encoding: 'utf-8' });
    
    // Check if formatting was successful
    if (output.includes('error') || output.includes('Error')) {
      console.error('⚠️  Prettier formatting failed:', output);
    } else {
      console.log(`✅ Formatted ${path.basename(filePath)}`);
    }
  } catch (error) {
    // Don't fail the operation, just warn
    console.log(`⚠️  Could not format ${path.basename(filePath)}: ${error.message}`);
  }
  
  process.exit(0);
} catch (error) {
  // Log error but don't block the operation
  console.error('Hook error:', error.message);
  process.exit(0);
}