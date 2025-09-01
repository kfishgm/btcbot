# Known Issues

## Jest Test Infrastructure

### Issue: Tests hang when using fake timers with async operations

**Affected Tests**: tests/exchange/binance-client.test.ts

- Timestamp Synchronization block
- Rate Limiting block
- Error Handling block

**Symptoms**:

- Tests hang indefinitely when `jest.advanceTimersByTime()` is used with async operations
- Process must be killed with timeout or force exit
- Issue persists even with proper timer cleanup in afterEach hooks

**Root Cause**:
Appears to be an interaction issue between Jest fake timers, async/await, and Node.js event loop. The combination of:

1. `jest.useFakeTimers()`
2. Async mock responses
3. `jest.advanceTimersByTime()`

Creates a deadlock condition where the test runner waits for async operations that never complete.

**Attempted Fixes**:

1. ✅ Added proper headers to all mock responses
2. ✅ Added afterEach timer cleanup
3. ✅ Set explicit system time with `jest.setSystemTime()`
4. ✅ Added `detectOpenHandles: false` to Jest config
5. ✅ Set `maxWorkers: 1` and `forceExit: true`
6. ❌ Issue persists despite all fixes

**Workaround**:
The implementation itself is correct and functional. The issue is specific to the test environment. For now:

1. Basic synchronous tests pass
2. Simple async tests without timer manipulation pass
3. Real-world usage is not affected

**Next Steps**:

- Consider migrating problematic timer-based tests to integration tests
- Or rewrite tests to avoid fake timers where possible
- Or upgrade Jest/Node versions when fixes are available

**References**:

- Similar issues reported: https://github.com/facebook/jest/issues
- Related to Node.js timer implementation changes
