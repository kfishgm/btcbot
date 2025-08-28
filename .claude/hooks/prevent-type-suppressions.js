#!/usr/bin/env node
/**
 * PreToolUse hook for Edit/Write/MultiEdit operations
 * Prevents adding TypeScript/ESLint suppression comments and 'any' types
 */

import fs from 'fs'
import { execSync } from 'child_process'
import path from 'path'

// Suppression patterns to block
const SUPPRESSION_PATTERNS = [
  // TypeScript suppressions
  /@ts-ignore/gi,
  /@ts-nocheck/gi,
  /@ts-expect-error/gi,

  // ESLint suppressions
  /eslint-disable(?:-next-line|-line)?/gi,
  /eslint-disable-next-line/gi,
  /eslint-disable-line/gi,

  // Any type usage (but allow 'unknown') - with proper word boundaries
  /:\s*any\b/g, // : any (word boundary after)
  /<any>/g, // <any>
  /\bas\s+any\b/g, // as any (word boundaries)
  /\bany\[\]/g, // any[] (word boundary before)
  /\bArray<any>/g, // Array<any>
  /\bPromise<any>/g, // Promise<any>
  /\bRecord<[^,]+,\s*any>/g, // Record<string, any>
]

// More sophisticated any type detection
function hasAnyType(text) {
  // Check for various forms of 'any' type usage
  const anyPatterns = [
    /:\s*any\b/, // : any (word boundary after any)
    /<any>/, // <any>
    /\bas\s+any\b/, // as any
    /\bany\[\]/, // any[] (word boundary before any)
    /\bArray<any>/, // Array<any>
    /\bPromise<any>/, // Promise<any>
    /\bRecord<[^,]+,\s*any>/, // Record<string, any>
    /\([^)]*:\s*any\b[^)]*\)/, // (param: any) - fixed with word boundary
    /\blet\s+\w+:\s*any\b/, // let x: any
    /\bconst\s+\w+:\s*any\b/, // const x: any
    /\bvar\s+\w+:\s*any\b/, // var x: any
    /:\s*\([^)]*\)\s*=>\s*any\b/, // : (...) => any
    /\bFunction\b/, // Function type (with word boundaries)
    /\bObject\b(?!\.\w)/, // Object type (with word boundaries)
  ]

  // Exception: Allow 'any' in comments and strings
  // Remove comments and strings before checking
  let cleanText = text
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
    .replace(/\/\/.*$/gm, '') // Remove line comments
    .replace(/'[^']*'/g, '""') // Remove single-quoted strings
    .replace(/"[^"]*"/g, '""') // Remove double-quoted strings
    .replace(/`[^`]*`/g, '""') // Remove template strings

  return anyPatterns.some((pattern) => pattern.test(cleanText))
}

function checkForSuppressions(text, filename = '') {
  const violations = []

  // Only check code files (.ts, .tsx, .js, .jsx)
  const isCodeFile = /\.(ts|tsx|js|jsx)$/.test(filename)
  if (!isCodeFile) {
    return violations // Skip non-code files
  }

  // Check for suppression comments
  for (const pattern of SUPPRESSION_PATTERNS) {
    const matches = text.match(pattern)
    if (matches) {
      violations.push({
        type: 'suppression',
        pattern: pattern.source,
        count: matches.length,
        examples: matches.slice(0, 3),
      })
    }
  }

  // Check for 'any' type usage (skip test files - they can use any for mocks)
  const isTestFile = filename.includes('.test.') || filename.includes('.spec.')
  if (!isTestFile && hasAnyType(text)) {
    violations.push({
      type: 'any',
      message: 'Use of "any" type detected',
    })
  }

  return violations
}

try {
  // Read input from stdin
  const input = JSON.parse(fs.readFileSync(0, 'utf-8'))
  const { tool_name, tool_input } = input

  // Only check Edit, Write, and MultiEdit operations
  if (!['Edit', 'Write', 'MultiEdit'].includes(tool_name)) {
    process.exit(0)
  }

  // Check based on tool type
  if (tool_name === 'Edit') {
    const { file_path, old_string, new_string } = tool_input

    // Allow REMOVING suppressions and any types
    const oldViolations = checkForSuppressions(old_string || '', file_path)
    const newViolations = checkForSuppressions(new_string, file_path)

    // Count suppressions and any types in old vs new
    const oldSuppressionCount = oldViolations.filter(
      (v) => v.type === 'suppression'
    ).length
    const newSuppressionCount = newViolations.filter(
      (v) => v.type === 'suppression'
    ).length
    const oldAnyCount = oldViolations.filter((v) => v.type === 'any').length
    const newAnyCount = newViolations.filter((v) => v.type === 'any').length

    // If removing suppressions or any types, allow it
    if (
      newSuppressionCount < oldSuppressionCount ||
      newAnyCount < oldAnyCount
    ) {
      console.log('✅ Good: Removing suppressions/any types')
      process.exit(0)
    }

    // If adding new suppressions or any types, block it
    if (
      newSuppressionCount > oldSuppressionCount ||
      newAnyCount > oldAnyCount
    ) {
      console.error('❌ Code quality violations detected!')
      console.error('')

      if (newSuppressionCount > oldSuppressionCount) {
        const newSuppressions = newViolations.filter(
          (v) => v.type === 'suppression'
        )
        for (const violation of newSuppressions) {
          console.error(
            `⚠️  Suppression comment added: ${violation.examples.join(', ')}`
          )
        }
      }

      if (newAnyCount > oldAnyCount) {
        console.error('⚠️  "any" type usage added')
      }

      console.error('')
      console.error('📝 REQUIRED: Fix the root cause instead of suppressing!')
      console.error('')
      console.error('Better alternatives:')
      console.error('  • Instead of @ts-ignore → Fix the type issue')
      console.error('  • Instead of eslint-disable → Fix the lint issue')
      console.error('  • Instead of "any" → Use "unknown" + type guards')
      console.error('  • Instead of "any" → Define proper interfaces')
      console.error('  • Instead of "Object" → Use Record<string, unknown>')
      console.error('  • Instead of "Function" → Use specific function type')
      console.error('')
      console.error('Example fixes:')
      console.error('  // Bad:  const data: any = response;')
      console.error('  // Good: const data: unknown = response;')
      console.error('  //       if (isUserData(data)) { ... }')
      console.error('')
      console.error('  // Bad:  // @ts-ignore')
      console.error('  //       obj.someProperty;')
      console.error('  // Good: if ("someProperty" in obj) {')
      console.error('  //         obj.someProperty;')
      console.error('  //       }')

      process.exit(2)
    }
  } else if (tool_name === 'Write') {
    const { file_path, content } = tool_input

    // Skip test files for 'any' checking
    const violations = checkForSuppressions(content, file_path)

    if (violations.length > 0) {
      console.error('❌ Code quality violations in new file!')
      console.error('')

      for (const violation of violations) {
        if (violation.type === 'suppression') {
          console.error(
            `⚠️  Suppression comment found: ${violation.examples.join(', ')}`
          )
        } else if (violation.type === 'any') {
          console.error('⚠️  "any" type usage detected')
        }
      }

      console.error('')
      console.error('New files must follow quality standards from the start.')
      console.error(
        'Use proper types and fix issues instead of suppressing them.'
      )

      process.exit(2)
    }
  } else if (tool_name === 'MultiEdit') {
    const { file_path, edits } = tool_input

    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i]
      const oldText = edit.old_string || edit.old_text || ''
      const newText = edit.new_string || edit.new_text || ''

      // Allow REMOVING suppressions and any types
      const oldViolations = checkForSuppressions(oldText, file_path)
      const newViolations = checkForSuppressions(newText, file_path)

      const oldSuppressionCount = oldViolations.filter(
        (v) => v.type === 'suppression'
      ).length
      const newSuppressionCount = newViolations.filter(
        (v) => v.type === 'suppression'
      ).length
      const oldAnyCount = oldViolations.filter((v) => v.type === 'any').length
      const newAnyCount = newViolations.filter((v) => v.type === 'any').length

      // If removing, that's good
      if (
        newSuppressionCount < oldSuppressionCount ||
        newAnyCount < oldAnyCount
      ) {
        continue // Allow this edit
      }

      // If adding new violations, block it
      if (
        newSuppressionCount > oldSuppressionCount ||
        newAnyCount > oldAnyCount
      ) {
        console.error(`❌ Code quality violations in edit #${i + 1}!`)
        console.error('')

        if (newSuppressionCount > oldSuppressionCount) {
          const newSuppressions = newViolations.filter(
            (v) => v.type === 'suppression'
          )
          for (const violation of newSuppressions) {
            console.error(
              `⚠️  Suppression comment added: ${violation.examples.join(', ')}`
            )
          }
        }

        if (newAnyCount > oldAnyCount) {
          console.error('⚠️  "any" type usage added')
        }

        console.error('')
        console.error(
          'Fix the root cause instead of suppressing or using "any"!'
        )

        process.exit(2)
      }
    }
  }

  // All checks passed
  process.exit(0)
} catch (error) {
  // Log error but don't block the operation
  console.error('Hook error:', error.message)
  process.exit(0)
}
