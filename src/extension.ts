import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const POLL_INTERVAL_MS = 5000;
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

interface TranscriptEntry {
  type?: string;
  isSidechain?: boolean;
  isApiErrorMessage?: boolean;
  message?: {
    usage?: {
      input_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    model?: string;
  };
}

interface SessionInfo {
  model: string;
  inputTokens: number;
  contextWindowSize: number;
}

function findMostRecentTranscript(): string | null {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return null;
  let latest: { file: string; mtime: number } | null = null;
  for (const project of fs.readdirSync(CLAUDE_PROJECTS_DIR)) {
    const projectDir = path.join(CLAUDE_PROJECTS_DIR, project);
    if (!fs.statSync(projectDir).isDirectory()) continue;
    for (const file of fs.readdirSync(projectDir)) {
      if (!file.endsWith('.jsonl')) continue;
      const full = path.join(projectDir, file);
      const mtime = fs.statSync(full).mtimeMs;
      if (!latest || mtime > latest.mtime) latest = { file: full, mtime };
    }
  }
  return latest?.file ?? null;
}

function parseTranscript(transcriptPath: string): SessionInfo | null {
  try {
    const lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n');
    let model = '';
    let inputTokens = 0;
    let contextWindowSize = 200000;

    for (const line of lines) {
      if (!line.trim()) continue;
      let entry: TranscriptEntry;
      try { entry = JSON.parse(line); } catch { continue; }

      if ((entry as any).context_window?.context_window_size) {
        contextWindowSize = (entry as any).context_window.context_window_size;
      }
      if (entry.isSidechain || entry.isApiErrorMessage || !entry.message?.usage) continue;

      const usage = entry.message.usage;
      const tokens =
        (usage.input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0);

      if (tokens > 0) {
        inputTokens = tokens;
        if (entry.message?.model) model = entry.message.model;
      }
    }

    return { model: model || 'Claude', inputTokens, contextWindowSize };
  } catch {
    return null;
  }
}

function friendlyModel(raw: string): string {
  // Strip trailing date suffix like "-20251001" so it doesn't get picked up as the version.
  const stripped = raw.replace(/-\d{6,}$/, '');
  // Version is the trailing "<major>-<minor>" (e.g. "4-7" → "4.7"), or a single trailing number.
  const m = stripped.match(/(\d+)-(\d+)$/) ?? stripped.match(/(\d+(?:\.\d+)?)$/);
  const version = m ? (m[2] ? `${m[1]}.${m[2]}` : m[1]) : '';
  if (/opus/i.test(raw)) return `Opus ${version}`.trim();
  if (/sonnet/i.test(raw)) return `Sonnet ${version}`.trim();
  if (/haiku/i.test(raw)) return `Haiku ${version}`.trim();
  return raw;
}

function buildBar(pct: number, width = 10): string {
  let bar = '';
  for (let i = 0; i < width; i++) {
    const progress = pct - i * 10;
    if (progress >= 8) bar += '█';
    else if (progress >= 3) bar += '▄';
    else bar += '░';
  }
  return bar;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

// Resolve a config string into a value usable by StatusBarItem.color.
// Hex codes (e.g. "#ff8800") are passed through; anything else is treated as a ThemeColor id.
function resolveColor(value: string | undefined): string | vscode.ThemeColor | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('#')) return trimmed;
  return new vscode.ThemeColor(trimmed);
}

interface ColorConfig {
  model: string | vscode.ThemeColor | undefined;
  normal: string | vscode.ThemeColor | undefined;
  warning: string | vscode.ThemeColor | undefined;
  danger: string | vscode.ThemeColor | undefined;
  warningThreshold: number;
  dangerThreshold: number;
}

function readConfig(): ColorConfig {
  const cfg = vscode.workspace.getConfiguration('claudeContextBar');
  return {
    model: resolveColor(cfg.get<string>('modelColor')),
    normal: resolveColor(cfg.get<string>('normalColor')),
    warning: resolveColor(cfg.get<string>('warningColor')),
    danger: resolveColor(cfg.get<string>('dangerColor')),
    warningThreshold: cfg.get<number>('warningThreshold') ?? 50,
    dangerThreshold: cfg.get<number>('dangerThreshold') ?? 80,
  };
}

function barColor(pct: number, cfg: ColorConfig): string | vscode.ThemeColor | undefined {
  if (pct >= cfg.dangerThreshold) return cfg.danger;
  if (pct >= cfg.warningThreshold) return cfg.warning;
  return cfg.normal;
}

export function activate(context: vscode.ExtensionContext) {
  // Three adjacent items: [model] [bar] [pct]
  // Higher priority = further right; we want model | bar | pct left-to-right
  const itemModel = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 103);
  const itemBar   = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 102);
  const itemPct   = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);

  itemModel.show();
  itemBar.show();
  itemPct.show();

  context.subscriptions.push(itemModel, itemBar, itemPct);

  function refresh() {
    const cfg = readConfig();
    const transcript = findMostRecentTranscript();
    if (!transcript) {
      itemModel.text = '$(hubot)  Claude';
      itemModel.color = undefined;
      itemBar.text = '  ──────────';
      itemPct.text = '  no session  ';
      return;
    }

    const info = parseTranscript(transcript);
    if (!info) {
      itemModel.text = '$(hubot)  Claude';
      itemBar.text = '';
      itemPct.text = '  ?  ';
      return;
    }

    const pct = Math.min(100, Math.round((info.inputTokens / info.contextWindowSize) * 100));
    const bar = buildBar(pct);
    const model = friendlyModel(info.model);
    const max = formatTokens(info.contextWindowSize);
    const used = formatTokens(info.inputTokens);
    const tooltip = new vscode.MarkdownString(
      `**Claude Code Context**\n\n` +
      `- Model: \`${info.model}\`\n` +
      `- Used: ${used} / ${max} tokens (${pct}%)\n` +
      `- Transcript: \`${path.basename(transcript)}\``
    );

    // Model label — always blue-ish (use a stable built-in color)
    itemModel.text = `$(hubot)   ${model}`;
    itemModel.color = cfg.model;
    itemModel.tooltip = tooltip;

    // Bar — color shifts green → yellow → red with usage
    itemBar.text = `   ${bar}  `;
    itemBar.color = barColor(pct, cfg);
    itemBar.tooltip = tooltip;

    // Percentage
    itemPct.text = `${pct}%  of  ${max}   `;
    itemPct.color = barColor(pct, cfg);
    itemPct.tooltip = tooltip;
  }

  refresh();
  const timer = setInterval(refresh, POLL_INTERVAL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

export function deactivate() {}
