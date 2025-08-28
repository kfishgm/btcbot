# Test Docker Sequential Workflow - Commands

Run these commands in order to test the Docker sequential orchestrator with a dummy "Hello World" prompt:

## Prerequisites
- Docker Desktop must be installed and running
- You must be logged into Claude (`claude --help` to check)

## Commands to Run (in order)

### 1. Setup the sequential worktree (if not already done)
```bash
.claude/sequential/commands/setup-sequential
```
This creates the worktree at `../btcbot-seq` and builds the Docker image.

### 2. Start the test tmux session
```bash
.claude/sequential/commands/setup-tmux-docker-test
```
This will:
- Start a tmux session called `btcbot-seq-test`
- Launch Claude in a Docker container with a dummy prompt
- Claude will respond with "Hello World from Docker container!"

### 3. Attach to see the result
```bash
tmux attach-session -t btcbot-seq-test
```

### 4. What you should see:
- Left pane: Claude running in Docker responding to the Hello World prompt
- Right pane: Simple monitor showing container is running

### 5. To exit and cleanup:
```bash
# Detach from tmux (while attached)
Ctrl+b d

# Kill the session
tmux kill-session -t btcbot-seq-test

# Stop any running containers
docker stop btcbot-orchestrator-test 2>/dev/null
docker rm btcbot-orchestrator-test 2>/dev/null
```

## What This Tests

1. **Docker Image Build**: Verifies the Docker image builds correctly with Claude installed
2. **Container Launch**: Tests that the container starts with proper volume mounts
3. **Authentication**: Confirms Claude can use the mounted auth from host
4. **Basic Operation**: Claude responds to a simple prompt
5. **Tmux Integration**: Shows how the orchestrator would run in tmux

## Differences from Production

The test version (`setup-tmux-docker-test`):
- Uses a dummy "Hello World" prompt instead of real task assignment
- Has a simplified monitor (just checks if container is running)
- Uses different session/container names (with `-test` suffix)
- Doesn't include dev server or other services

## Troubleshooting

### Docker not running
```bash
# macOS
open -a Docker

# Wait 10-20 seconds for Docker to start
docker version
```

### Image build fails
```bash
# Rebuild the image manually
docker build -t btcbot-orchestrator .claude/sequential/docker/
```

### Authentication issues
```bash
# Ensure you're logged into Claude on the host
claude --help
# If not logged in, it will prompt for authentication
```

### Container won't start
```bash
# Check for port conflicts
lsof -i :3001

# Check Docker logs
docker logs btcbot-orchestrator-test

# List all containers
docker ps -a
```