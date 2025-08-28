---
allowed-tools:
  - Read
  - Write
  - MultiEdit
description: Configure project name and environment settings
---

Configure the michi-template project. Arguments: $ARGUMENTS

Parse arguments:

- --project-name=NAME (or prompt user for project name)
- --skip-optional (skip VS Code extensions)
- --with-playwright (add Playwright MCP)
- --with-drawio (add Draw.io MCP)

## Step 1: Get Project Name

If no --project-name provided, ask: "What is your project name? (default: current directory name)"

## Step 2: Reinitialize Git Repository

1. Remove existing git directory: `rm -rf .git`
2. Initialize new repository: `git init`
3. Ask user: "What is your GitHub repository URL? (e.g., git@github.com:username/repo.git)"
4. Set remote: `git remote add origin <user_provided_url>`
5. Create initial commit: `git add -A && git commit -m "Initial commit from michi-template"`

## Step 3: Replace {{PROJECT_NAME}} Only

Use MultiEdit to replace {{PROJECT_NAME}} in these files:

1. CLAUDE.md
2. app/layout.tsx
3. supabase/config.toml
4. docs/templates/tasks.md
5. docs/templates/README.md
6. docs/templates/progress.md
7. docs/templates/PRD.md
8. docs/templates/dashboard.md
9. docs/configuration/supabase.md
10. docs/getting-started/troubleshooting.md
11. .mcp/config.json (ONLY {{PROJECT_NAME}}, not {{PROJECT_ROOT}})

Also replace {{PROJECT_DESCRIPTION}} in app/layout.tsx

IMPORTANT: Leave {{PROJECT_ROOT}} unchanged everywhere - it will be set by /setup-agents later.

## Step 4: Environment Setup

Create .env.local with:

```
NEXT_PUBLIC_SUPABASE_URL=<ask user>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ask user>
SUPABASE_SERVICE_ROLE_KEY=<ask user>
```

## Step 5: Update MCP Tokens

In .mcp/config.json, replace:

- YOUR_GITHUB_TOKEN → ask user for GitHub Personal Access Token
- YOUR_SUPABASE_URL → use value from step 4
- YOUR_SUPABASE_SERVICE_ROLE_KEY → use value from step 4
- YOUR_VERCEL_TOKEN → ask if using Vercel (optional)

## Step 6: Optional Tools

If not --skip-optional and VS Code is installed:

- Install recommended extensions

If --with-playwright:

- Add Playwright MCP to .mcp/config.json

If --with-drawio:

- Add Draw.io MCP to .mcp/config.json

## Step 7: Final Message

Show user next steps:

1. Run `/setup-prd` to create product requirements
2. Run `/setup-agents` to set up multi-agent workflow
3. Run `./claude/commands/setup-tmux` to start development
