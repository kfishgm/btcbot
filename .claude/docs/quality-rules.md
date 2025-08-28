# btcbot Code Quality Rules

This document outlines the ESLint and TypeScript rules that all code must follow. Agents should review these rules BEFORE writing or modifying code to avoid quality gate failures.

## Configuration Sources
- **TypeScript**: `tsconfig.json` with `strict: true` and additional strict checks
- **ESLint**: `eslint.config.mjs` extending Next.js rules with custom overrides

## Critical ESLint Rules

### 1. No Explicit Any (`@typescript-eslint/no-explicit-any`)
**Rule**: Never use `any` type. Always specify proper types.

❌ **Bad:**
```typescript
const data: any = fetchData();
const handler = (param: any) => { ... };
```

✅ **Good:**
```typescript
interface UserData {
  id: string;
  name: string;
}
const data: UserData = fetchData();
const handler = (param: string | number) => { ... };
```

### 2. No Unused Variables (`@typescript-eslint/no-unused-vars`)
**Rule**: Unused variables must be prefixed with underscore or removed.

❌ **Bad:**
```typescript
import { SomeType } from './types'; // Never used
const result = calculate(); // Never used
```

✅ **Good:**
```typescript
const _unusedButRequired = getValue(); // Prefixed with _
// Or simply remove the unused variable
```

### 3. No @ts-nocheck (`@typescript-eslint/ban-ts-comment`)
**Rule**: Never use `@ts-nocheck`, `@ts-ignore`, or `@ts-expect-error` without proper justification.

❌ **Bad:**
```typescript
// @ts-nocheck
// @ts-ignore
```

✅ **Good:**
```typescript
// Fix the actual TypeScript error instead
```

### 4. No require() imports (`@typescript-eslint/no-require-imports`)
**Rule**: Use ES6 imports instead of require().
**Note**: This rule is disabled for `.js` files but enforced for TypeScript files.

❌ **Bad:**
```typescript
const fs = require('fs');
const { join } = require('path');
```

✅ **Good:**
```typescript
import fs from 'fs';
import { join } from 'path';
```

### 5. No Unused Expressions (`@typescript-eslint/no-unused-expressions`)
**Rule**: Expressions that don't affect state or control flow are not allowed.

❌ **Bad:**
```typescript
user.isActive;  // Expression has no effect
condition ? doA() : doB();  // Using ternary for side effects
```

✅ **Good:**
```typescript
if (user.isActive) { ... }  // Use the value
if (condition) { doA(); } else { doB(); }  // Use if-else for control flow
```

## Additional ESLint Rules from Next.js

### No Empty Object Type (`@typescript-eslint/no-empty-object-type`)
**Rule**: Don't use empty object types `{}`.

❌ **Bad:**
```typescript
type EmptyObj = {};
interface Empty {}
```

✅ **Good:**
```typescript
type Config = { apiUrl: string };
interface Settings { theme: string }
// Or use Record<string, never> for truly empty objects
```

### No Namespace (`@typescript-eslint/no-namespace`)
**Rule**: Use ES6 modules instead of namespaces.

❌ **Bad:**
```typescript
namespace Utils {
  export function helper() {}
}
```

✅ **Good:**
```typescript
// utils.ts
export function helper() {}
```

## TypeScript Strict Mode Rules (from tsconfig.json)

The project has `"strict": true` plus additional strict checks:

### 1. Strict Null Checks (`strictNullChecks: true`)
**Rule**: Handle null/undefined values explicitly.

❌ **Bad:**
```typescript
const user = getUser();
console.log(user.name); // user might be null
```

✅ **Good:**
```typescript
const user = getUser();
if (user) {
  console.log(user.name);
}
// Or use optional chaining
console.log(user?.name);
```

### 2. No Implicit Any
**Rule**: All function parameters must have explicit types.

❌ **Bad:**
```typescript
function process(data) { // implicit any
  return data.value;
}
```

✅ **Good:**
```typescript
function process(data: { value: string }): string {
  return data.value;
}
```

### 3. Strict Property Initialization
**Rule**: Class properties must be initialized or marked as optional.

❌ **Bad:**
```typescript
class Service {
  private client: DatabaseClient; // Not initialized
}
```

✅ **Good:**
```typescript
class Service {
  private client: DatabaseClient;
  
  constructor(client: DatabaseClient) {
    this.client = client;
  }
}
// Or
class Service {
  private client?: DatabaseClient; // Optional
}
```

### 4. No Unused Locals (`noUnusedLocals: true`)
**Rule**: Local variables must be used.

❌ **Bad:**
```typescript
function process() {
  const unused = 5; // Never used
  return 10;
}
```

✅ **Good:**
```typescript
function process() {
  const value = 5;
  return value * 2;
}
```

### 5. No Unused Parameters (`noUnusedParameters: true`)
**Rule**: Function parameters must be used or prefixed with underscore.

❌ **Bad:**
```typescript
function handler(req, res, next) { // 'next' is unused
  return res.send('ok');
}
```

✅ **Good:**
```typescript
function handler(req, res, _next) { // Prefixed with _
  return res.send('ok');
}
```

### 6. No Implicit Returns (`noImplicitReturns: true`)
**Rule**: All code paths must return a value if function has return type.

❌ **Bad:**
```typescript
function getValue(condition: boolean): number {
  if (condition) {
    return 42;
  }
  // Missing return for else case
}
```

✅ **Good:**
```typescript
function getValue(condition: boolean): number {
  if (condition) {
    return 42;
  }
  return 0; // Explicit return
}
```

### 7. No Unchecked Indexed Access (`noUncheckedIndexedAccess: true`)
**Rule**: Array/object access may return undefined.

❌ **Bad:**
```typescript
const arr = [1, 2, 3];
const value: number = arr[10]; // Could be undefined
```

✅ **Good:**
```typescript
const arr = [1, 2, 3];
const value = arr[10]; // Type is number | undefined
if (value !== undefined) {
  // Now it's number
}
```

### 8. No Property Access From Index Signature (`noPropertyAccessFromIndexSignature: true`)
**Rule**: Use bracket notation for index signatures.

❌ **Bad:**
```typescript
const obj: { [key: string]: string } = {};
const value = obj.someKey; // Property access not allowed
```

✅ **Good:**
```typescript
const obj: { [key: string]: string } = {};
const value = obj['someKey']; // Bracket notation
```

## Common Patterns to Follow

### 1. Type Assertions for Mocks
When writing tests with mocked functions:

```typescript
// Use proper type assertions for mocks
const mockFn = jest.fn() as jest.MockedFunction<(param: string) => Promise<Result>>;

// For complex mocks
const mockClient = {
  query: jest.fn().mockResolvedValue({ rows: [] })
} as unknown as DatabaseClient;
```

### 2. Handling Dynamic Properties
When accessing properties dynamically:

```typescript
// Use proper type guards or assertions
if ('name' in obj && typeof obj.name === 'string') {
  console.log(obj.name);
}

// Or use type predicates
function hasName(obj: unknown): obj is { name: string } {
  return typeof obj === 'object' && obj !== null && 'name' in obj;
}
```

### 3. Array Index Access
When accessing array elements:

```typescript
const items = ['a', 'b', 'c'];
const first = items[0]; // Type: string | undefined

// Handle the undefined case
if (first !== undefined) {
  console.log(first.toUpperCase());
}
```

## Project-Specific Rules

### 1. Import Paths
- Use absolute imports for cross-module imports: `@/features/...`
- Use relative imports within the same module: `./components/...`

### 2. Naming Conventions
- Components: PascalCase (e.g., `UserProfile`)
- Hooks: camelCase starting with 'use' (e.g., `useUserData`)
- Services: camelCase ending with 'Service' (e.g., `authService`)
- Types/Interfaces: PascalCase (e.g., `UserData`)

### 3. File Organization
- One component per file
- Test files adjacent to implementation
- Types in separate `.types.ts` files for shared types

## Quick Checklist Before Writing Code

### ESLint Rules
1. ✅ No `any` types - use proper interfaces or union types
2. ✅ All variables are used or prefixed with `_`
3. ✅ No `@ts-nocheck`, `@ts-ignore`, or `@ts-expect-error`
4. ✅ ES6 imports only (no `require()` in TypeScript files)
5. ✅ No unused expressions
6. ✅ No empty object types `{}`
7. ✅ No namespaces - use ES6 modules

### TypeScript Compiler Rules
8. ✅ Handle null/undefined cases (`strictNullChecks`)
9. ✅ Explicit types for all function parameters (`noImplicitAny`)
10. ✅ Initialize all class properties (`strictPropertyInitialization`)
11. ✅ Use all local variables or remove them (`noUnusedLocals`)
12. ✅ Use all parameters or prefix with `_` (`noUnusedParameters`)
13. ✅ All code paths return value (`noImplicitReturns`)
14. ✅ Handle array access that might be undefined (`noUncheckedIndexedAccess`)
15. ✅ Use bracket notation for index signatures (`noPropertyAccessFromIndexSignature`)

### Code Style
16. ✅ Proper type assertions for test mocks
17. ✅ Follow naming conventions
18. ✅ Use correct import paths

## Running Quality Checks

Before marking any task complete, run:

```bash
# Check for TypeScript errors (excludes test files)
pnpm typecheck

# Check for ESLint errors
pnpm lint

# Fix auto-fixable ESLint issues
pnpm lint --fix
```

**Note**: Test files (`__tests__/**`) are excluded from TypeScript checking to reduce token usage and development friction. This saves ~77% of type errors while maintaining strict typing for production code.

## Common Solutions

### Converting `any` to proper types:

1. **For API responses**: Define interfaces
```typescript
interface ApiResponse<T> {
  data: T;
  error: string | null;
}
```

2. **For event handlers**: Use specific event types
```typescript
const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => { ... }
```

3. **For unknown shapes**: Use `unknown` and type guards
```typescript
function processData(data: unknown): string {
  if (typeof data === 'string') return data;
  if (typeof data === 'number') return data.toString();
  throw new Error('Invalid data type');
}
```

### Handling unused imports:

1. Remove if truly unused
2. Prefix with `_` if needed for side effects
3. Use type-only imports when applicable:
```typescript
import type { UserType } from './types';
```

## Remember

- **Prevention is better than fixing**: Review these rules before writing code
- **Type safety first**: Never compromise type safety for convenience
- **Ask for clarification**: If unsure about the correct type, investigate the codebase
- **Test your changes**: Ensure both tests pass AND quality checks pass