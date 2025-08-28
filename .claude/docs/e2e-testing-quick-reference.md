# E2E Testing Quick Reference for Agents

## Running E2E Tests

```bash
# Run all e2e tests (ALWAYS USE THIS BEFORE MARKING COMPLETE)
.claude/lib/run-e2e-tests

# Run specific test file
.claude/lib/run-e2e-tests e2e/auth-flow.spec.ts

# Debug failing test
.claude/lib/debug-e2e-test e2e/auth-flow.spec.ts
```

## When to Write E2E Tests

| Agent | Write E2E Tests For |
|-------|-------------------|
| **Architect** | - Auth flows<br>- Payment workflows<br>- Critical user journeys<br>- Security features |
| **Test** | - Multi-page workflows<br>- API integrations<br>- Error scenarios<br>- Mobile responsiveness |
| **Implementation** | - Fix ALL failing tests<br>- Update selectors if needed<br>- NEVER skip/delete tests |

## Test Data

E2E tests have pre-created test bots:
- **Active Bot**: `123e4567-e89b-12d3-a456-426614174000`
- **Stopped Bot**: `223e4567-e89b-12d3-a456-426614174001`
- **Error Bot**: `323e4567-e89b-12d3-a456-426614174002`
- **Edit Bot**: `423e4567-e89b-12d3-a456-426614174003`

```typescript
import { TEST_BOT_IDS } from '../helpers/bot-test-data';

// Use predictable test data
await page.goto(`/dashboard/bots/${TEST_BOT_IDS.ACTIVE_BOT}`);
```

## Key Patterns

### Test WITH Authentication (Default)
```typescript
test('dashboard test', async ({ page }) => {
  await page.goto('/dashboard');
  // User already logged in
});
```

### Test WITHOUT Authentication
```typescript
test.describe('Login Tests', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  
  test('shows login form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('#email')).toBeVisible();
  });
});
```

### Mobile-Aware Tests
```typescript
test('responsive nav', async ({ page, viewport }) => {
  if (viewport?.width < 768) {
    // Mobile checks
    await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  } else {
    // Desktop checks
    await expect(page.locator('nav')).toBeVisible();
  }
});
```

### Handle Dynamic Content
```typescript
// Either bots exist OR empty state shows
const hasBots = await page.locator('.bot-card').count() > 0;
const isEmpty = await page.getByText(/no bots/i).isVisible().catch(() => false);
expect(hasBots || isEmpty).toBeTruthy();
```

## Selector Priority

1. **getByRole**: `page.getByRole('button', { name: 'Submit' })`
2. **getByLabel**: `page.getByLabel('Email')`
3. **getByText**: `page.getByText('Welcome')`
4. **getByTestId**: `page.getByTestId('submit-btn')`
5. **locator** (last resort): `page.locator('#submit')`

## Common Commands

```typescript
// Navigation
await page.goto('/dashboard');
await expect(page).toHaveURL('/dashboard');

// Form filling
await page.getByLabel('Email').fill('test@example.com');
await page.getByRole('button', { name: 'Submit' }).click();

// Waiting
await page.waitForLoadState('networkidle');
await expect(page.getByText('Success')).toBeVisible();

// API mocking
await page.route('/api/bots', route => {
  route.fulfill({ status: 200, body: JSON.stringify([]) });
});
```

## Pre-Flight Checklist

Before running `complete-task`:
- [ ] Run `.claude/lib/run-e2e-tests` - ALL must pass
- [ ] No `.skip()` or `.only()` in tests
- [ ] No hardcoded waits (`page.waitForTimeout`)
- [ ] Tests work on mobile viewports
- [ ] Error scenarios handled gracefully

## Debugging Failed Tests

1. **Read the error** - Often tells you exactly what's wrong
2. **Check selectors** - UI might have changed
3. **Verify auth state** - Some tests need auth, some don't
4. **Look for race conditions** - Add proper waits
5. **Check API calls** - Network errors can cause failures

## Quick Fixes

| Problem | Solution |
|---------|----------|
| "Element not found" | Update selector to match current UI |
| "Timeout exceeded" | Add `waitForLoadState` or element wait |
| "Expected X got Y" | Make assertion more flexible |
| "401 Unauthorized" | Check if test needs auth setup |
| "Network error" | Ensure Supabase is running |

## Remember

- E2E tests run in parallel - make them independent
- Always headless in CI - no `headed: true`
- Tests auto-start dev server - don't run manually
- Auth persists across tests - design accordingly
- Mobile viewports included - handle responsiveness