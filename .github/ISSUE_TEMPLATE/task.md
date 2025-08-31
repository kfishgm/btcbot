---
name: Development Task
about: Create a new development task for the pipeline
title: 'TASK-XXX: '
labels: task
assignees: ''
---

## Task Description

<!-- Provide a clear description of what needs to be done -->

## Progress Tracking

Progress is tracked via labels:

- `sequential-wip` - Task is being worked on by primary developer
- Task is automatically closed when PR is merged

## Branches

<!-- Branches will be listed here as work progresses -->

_No branches yet_

## Dependencies

<!-- List any tasks that must be completed before this one -->

- None

## Acceptance Criteria

<!-- Define what constitutes successful completion -->

- [ ] Criteria 1
- [ ] Criteria 2
- [ ] Criteria 3

## 🔴 MANDATORY REQUIREMENTS - DIRECT ORDER 🔴

**TDD REQUIREMENTS - TESTS MUST BE WRITTEN FIRST**

- [ ] **Write tests BEFORE implementation** (Use test-writer consultant)
- [ ] **Commit failing tests first** (Red phase of Red-Green-Refactor)
- [ ] **Implementation follows to make tests pass** (Green phase)
- [ ] **Tests define the specification** (Not the other way around)

**ALL TESTS MUST PASS - NO EXCEPTIONS**

- [ ] **100% of unit tests pass** (NOT 99%, ALL OF THEM)
- [ ] **100% of E2E tests pass** (EVERY SINGLE ONE)
- [ ] **0 TypeScript errors** (Run: pnpm typecheck)
- [ ] **0 ESLint errors** (Run: pnpm lint)
- [ ] **Full production-ready implementation** (NO stubs, mocks, or TODOs)

**FORBIDDEN:**

- Skipping tests because "not related to task"
- Skipping tests because "complex" or "time-consuming"
- Saying tests "don't affect core functionality"
- Partial implementations to "save time"

**Size, complexity, and time are IRRELEVANT. Make ALL tests pass.**

## Technical Notes

<!-- Any technical considerations or constraints -->

## Primary Developer Instructions

The primary developer owns the ENTIRE implementation:

- Design the solution architecture
- Write comprehensive tests FIRST (TDD)
- Implement full production-ready functionality
- **ENSURE ALL TESTS PASS (100% - NO EXCEPTIONS)**
- **Fix ALL TypeScript and ESLint errors**
- **Complete FULL production implementation**
- **NO skipping tests for ANY reason**
- Get code review before completion
- Use consultants for expertise when needed
