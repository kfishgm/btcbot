# Complete-Task Potential Failure Points Analysis

## 1. Task Detection Failures
- **Missing TASK file**: Fixed with branch name fallback
- **Wrong branch naming**: If branch doesn't follow pattern `{number}-{role}`
- **Multiple TASK files**: Would pick first one found

## 2. Branch Detection Issues
- **Missing branches**: When labels say "done" but branches don't exist
  - Mitigation: Removes incorrect labels and adds comment
- **Branch not pushed**: If agent completed work but didn't push
  - Mitigation: `push_agent_branches()` tries to push from worktrees
- **Wrong branch names**: If agents used non-standard naming
  - Mitigation: Tries to extract from issue body first

## 3. Merge Conflicts
- **Auth conflicts**: Like we saw with lib/auth/server.ts
- **No conflict resolution**: Script will fail on merge conflicts
- **Missing implementation branch**: Falls back to test branch

## 4. Quality Gate Failures
- **Lint errors**: Must be fixed manually
- **TypeScript errors**: Must be fixed manually
- **Test failures**: Must be fixed manually
- **Build failures**: Must be fixed manually
- **Timeout on build**: 300s timeout might be too short for large builds

## 5. Migration Deployment
- **Missing env vars**: SUPABASE_PROJECT_ID, SUPABASE_DB_URL
- **Network issues**: Could fail deployment
- **Migration conflicts**: If migrations already applied

## 6. PR Creation/Merge Issues
- **PR already exists**: `gh pr create` would fail
- **Branch protection rules**: Might prevent auto-merge
- **No merge permissions**: Falls back to non-admin merge
- **PR title too long**: GitHub has title length limits

## 7. Cleanup Issues
- **Can't delete branches**: If protected or has unmerged changes
- **Process cleanup failures**: Non-critical but leaves processes running

## 8. Environment Issues
- **Missing .env files**: Could cause test/build failures
- **Wrong working directory**: Must be in implementation worktree
- **Git state issues**: Uncommitted changes would block operations

## Recommendations

1. **Add conflict resolution**:
   ```bash
   if ! git merge "origin/$impl_branch" --no-edit; then
       echo "Merge conflict detected. Please resolve manually."
       git status
       return 1
   fi
   ```

2. **Check for existing PR**:
   ```bash
   existing_pr=$(gh pr list --head "$complete_branch" --json number -q '.[0].number')
   if [ -n "$existing_pr" ]; then
       echo "PR #$existing_pr already exists"
       gh pr merge "$existing_pr" --merge
       return 0
   fi
   ```

3. **Add build timeout configuration**:
   ```bash
   BUILD_TIMEOUT="${BUILD_TIMEOUT:-300}"
   if ! timeout "${BUILD_TIMEOUT}s" pnpm build:clean; then
   ```

4. **Better error messages for env issues**:
   ```bash
   if [ -z "$SUPABASE_PROJECT_ID" ]; then
       echo "Warning: SUPABASE_PROJECT_ID not set"
       echo "Migrations will be skipped"
   fi
   ```

5. **Pre-flight checks**:
   ```bash
   # Check for uncommitted changes
   if ! git diff --quiet || ! git diff --cached --quiet; then
       echo "Error: Uncommitted changes detected"
       git status --short
       return 1
   fi
   ```