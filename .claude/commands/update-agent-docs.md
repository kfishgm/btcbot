---
allowed-tools: Bash(bash:*), Read, Write
description: Update agent CLAUDE.md files with latest templates
---

# Update Agent Documentation

Update all agent CLAUDE.md files with the latest templates and project instructions.

## What it does

This command:
1. Copies the base CLAUDE.md from the main project to each agent worktree
2. Appends agent-specific instructions from templates
3. Replaces template variables with actual project values

## Usage

```bash
.claude/commands/update-agent-docs
```

## Template Variables

The following variables are replaced in templates:
- `{{PROJECT_NAME}}` - The project name (e.g., "btcbot")
- `{{PROJECT_ROOT}}` - The main project directory path
- `{{WORKTREE_PATH}}` - The specific agent's worktree path
- `{{ComponentPrefix}}` - PascalCase version of project name for components

## Templates Used

- **ARCHITECT**: `.claude/templates/CLAUDE-ARCHITECT.md.template`
- **TESTER**: `.claude/templates/CLAUDE-TESTER.md.template`
- **IMPLEMENTER**: `.claude/templates/CLAUDE-IMPLEMENTER.md.template`
- **SUPERVISOR**: `.claude/templates/CLAUDE-SUPERVISOR.md.template`

## When to Use

Run this command when:
- You've updated the main CLAUDE.md file
- You've modified agent template files
- After running setup-agents to ensure agents have latest instructions
- When agents need updated coordination protocols

## Notes

- Only updates agents whose worktrees exist
- Agents need to re-read their CLAUDE.md files after update
- The command is project-agnostic and works with any project structure