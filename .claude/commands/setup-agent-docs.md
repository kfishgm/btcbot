Set up the multi-agent workflow by creating git worktrees and configuring role-specific documentation:

```bash
./claude/commands/setup-agent-docs
```

This command will:

1. **Create Git Worktrees** (if they don't exist):
   - `{{PROJECT_NAME}}-arch` for Architecture Agent
   - `{{PROJECT_NAME}}-test` for Test Agent  
   - `{{PROJECT_NAME}}-impl` for Implementation Agent

2. **Generate Role-Specific Documentation**:
   - Creates CLAUDE-{ROLE}.md from templates
   - Combines with base CLAUDE.md for each worktree
   - Replaces all placeholders with project values

3. **Enable Parallel Development**:
   - Each agent works in isolated branch
   - No merge conflicts between agents
   - Clear separation of concerns

After running this command, each agent will have:
- Their own worktree directory
- Combined CLAUDE.md with role-specific instructions
- Separate git branch for their work

Next step: Run `./claude/commands/setup-tmux` to start development!
