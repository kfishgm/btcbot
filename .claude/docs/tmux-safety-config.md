# TMux Safety Configuration

To prevent tmux sessions and panes from closing unexpectedly when processes exit, add these settings to your `~/.tmux.conf`:

```bash
# Keep panes open when the command exits
set -g remain-on-exit on

# Or set it for specific windows/panes:
# set-window-option -g remain-on-exit on

# Alternative: Set default command to shell to prevent pane closure
# set -g default-command "${SHELL}"
```

## Per-Session Configuration

You can also set this for just the btcbot session:

```bash
# In the setup script or manually:
tmux set-option -t btcbot-dev remain-on-exit on
```

## Why This Helps

When remain-on-exit is on:
- Panes stay open even if the process inside exits
- You'll see "[exited]" or similar message
- You can respawn the shell with `tmux respawn-pane`

This prevents accidental session loss when:
- Claude crashes or exits
- Scripts send multiple Ctrl+C to a shell
- Processes terminate unexpectedly