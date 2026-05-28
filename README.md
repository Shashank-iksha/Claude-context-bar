# Claude Context Bar

VS Code extension that shows the current Claude Code model and token context usage in the status bar — model name, a color-coded progress bar, and `used / max` token count, refreshed every 5 seconds.


<img width="593" height="158" alt="image" src="https://github.com/user-attachments/assets/d96ec70f-d040-4964-b29a-ba2abb64e06f" />

<img width="1508" height="915" alt="image" src="https://github.com/user-attachments/assets/1a16aa33-e60f-4d22-b0ec-c7a06948b121" />

## Install

```bash
npm install
npm run compile
npx vsce package
code --install-extension claude-context-bar-*.vsix --force
```

Or in VS Code: `Cmd+Shift+P` → **Extensions: Install from VSIX...**

## Develop

```bash
npm run watch     # rebuild on save
```

Press `F5` in VS Code to launch an Extension Development Host with the current source.

## Settings

Search "Claude Context Bar" in VS Code settings:

| Setting | Default | Purpose |
|---|---|---|
| `claudeContextBar.modelColor` | `textLink.foreground` | Model name color (hex like `#4FC3F7` or ThemeColor id) |
| `claudeContextBar.warningThreshold` | `50` | % where the bar turns warning color |
| `claudeContextBar.dangerThreshold` | `80` | % where the bar turns danger color |
| `claudeContextBar.normalColor` | `statusBar.debuggingForeground` | Color below the warning threshold |
| `claudeContextBar.warningColor` | `statusBarItem.warningForeground` | Color at/above the warning threshold |
| `claudeContextBar.dangerColor` | `statusBarItem.errorBackground` | Color at/above the danger threshold |

## How it works

The extension polls `~/.claude/projects/*/*.jsonl`, picks the most recently modified transcript, and sums `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` from the latest Claude API response entry. Default context window is 200,000 tokens.
