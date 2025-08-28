# Pipeline Cleanup Summary

## Moved to `old-system/` directory:

### Libraries
- agent-interface.sh - Old agent communication system
- task-scheduler.js - JSON state-based scheduler
- state-healer.js - State recovery system
- state-recovery.js - Git branch scanner
- recovery.sh - Auto-recovery system
- health-check.sh - Health monitoring
- branch-manager.sh - Branch operations
- project-adapter.sh - Project integration
- quality-gate.sh - Quality checks
- robust-state.sh - State management
- state-utils.sh - State utilities

### Commands
- monitor - Old monitoring system
- init, status, mode - Old pipeline commands
- pilot, rollout, simulate - Rollout system
- populate-tasks - Task population

### Configuration
- pipeline.yaml - Old config file
- tasks/*.yaml - Task definitions
- test-tasks/*.yaml - Test tasks

### State
- pipeline-state.json - Old state file
- recovery-state.json - Recovery state

## Kept Active:

### New GitHub System
- lib/github-task-scheduler.js
- lib/github-agent-interface.sh  
- commands/github-monitor
- commands/migrate-to-github
- commands/task

### Documentation
- README.md (updated)
- README-GITHUB.md (new)
- docs/* (kept for reference)

## Notes

The old system is preserved in `old-system/` directory in case you need to reference it or rollback. The new GitHub Issues-based system is much simpler:

- No state.json to sync
- No complex recovery needed
- GitHub Issues is the single source of truth
- Simple checkbox-based progress tracking

To completely remove the old system:
```bash
rm -rf .claude/pipeline/old-system
```