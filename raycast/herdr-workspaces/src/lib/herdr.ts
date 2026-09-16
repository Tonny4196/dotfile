import { getPreferenceValues } from "@raycast/api";
import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Raycast launches extensions with a minimal PATH (no Homebrew), so herdr has to be located explicitly.
const CANDIDATE_PATHS = [
  "/opt/homebrew/bin/herdr",
  "/usr/local/bin/herdr",
  join(homedir(), ".local/bin/herdr"),
  join(homedir(), ".cargo/bin/herdr"),
];

export interface Workspace {
  workspace_id: string;
  label: string;
  number: number;
  focused: boolean;
  agent_status?: string;
  pane_count?: number;
  tab_count?: number;
  active_tab_id?: string;
}

export interface Pane {
  pane_id: string;
  workspace_id: string;
  tab_id?: string;
  agent?: string | null;
  agent_status?: string | null;
  cwd?: string | null;
  foreground_cwd?: string | null;
  focused?: boolean;
  terminal_title_stripped?: string | null;
}

export interface PaneSummary {
  id: string;
  title: string;
  agent?: string;
  working: boolean;
}

export interface WorkspaceSummary {
  workspace: Workspace;
  primaryTitle: string;
  panes: PaneSummary[];
  agents: { name: string; count: number }[];
  workingCount: number;
  cwd?: string;
}

export class HerdrNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HerdrNotFoundError";
  }
}

export class HerdrError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "HerdrError";
  }
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findWithLoginShell(): Promise<string | undefined> {
  const shell = process.env.SHELL || "/bin/zsh";
  try {
    const { stdout } = await execFileAsync(shell, ["-lic", "command -v herdr"], { timeout: 3000 });
    // Interactive shell startup may print extra output, so only trust an absolute path line.
    const path = stdout
      .split("\n")
      .map((line) => line.trim())
      .reverse()
      .find((line) => line.startsWith("/"));
    return path && isExecutable(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

let cachedPath: { preference: string; path: string } | undefined;

export async function resolveHerdrPath(): Promise<string> {
  const preference = (getPreferenceValues<{ herdrPath?: string }>().herdrPath ?? "").trim();
  if (cachedPath?.preference === preference) {
    return cachedPath.path;
  }

  let path: string | undefined;
  if (preference) {
    const expanded = preference.replace(/^~(?=\/|$)/, homedir());
    if (!isExecutable(expanded)) {
      throw new HerdrNotFoundError(`Herdr Path "${preference}" is not an executable file.`);
    }
    path = expanded;
  } else {
    path = CANDIDATE_PATHS.find(isExecutable) ?? (await findWithLoginShell());
  }

  if (!path) {
    throw new HerdrNotFoundError("herdr was not found. Set Herdr Path in the extension preferences.");
  }
  cachedPath = { preference, path };
  return path;
}

function parseHerdrError(output: string): HerdrError | undefined {
  try {
    const json = JSON.parse(output) as { error?: { code?: string; message?: string } };
    if (json.error?.message) {
      return new HerdrError(json.error.message, json.error.code);
    }
  } catch {
    // not JSON
  }
  return undefined;
}

async function runHerdr<T>(args: string[]): Promise<T> {
  const herdr = await resolveHerdrPath();
  const env = {
    ...process.env,
    PATH: [dirname(herdr), "/opt/homebrew/bin", "/usr/local/bin", process.env.PATH].filter(Boolean).join(":"),
  };

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(herdr, args, { env, timeout: 5000 }));
  } catch (error) {
    const { stdout = "", stderr = "" } = error as { stdout?: string; stderr?: string };
    throw (
      parseHerdrError(stderr.trim()) ??
      parseHerdrError(stdout.trim()) ??
      new HerdrError(stderr.trim() || (error as Error).message)
    );
  }

  const json = JSON.parse(stdout) as { result?: T; error?: { code?: string; message?: string } };
  if (json.error) {
    throw new HerdrError(json.error.message ?? "Unknown herdr error", json.error.code);
  }
  return json.result as T;
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const result = await runHerdr<{ workspaces: Workspace[] }>(["workspace", "list"]);
  return result.workspaces ?? [];
}

export async function listPanes(): Promise<Pane[]> {
  const result = await runHerdr<{ panes: Pane[] }>(["pane", "list"]);
  return result.panes ?? [];
}

export async function focusWorkspace(workspaceId: string): Promise<void> {
  await runHerdr(["workspace", "focus", workspaceId]);
}

export function shortenPath(path: string): string {
  const home = homedir();
  if (path === home) return "~";
  return path.startsWith(home + "/") ? "~" + path.slice(home.length) : path;
}

// Codex appends " | <cwd basename>" to its terminal title; drop it so only the task remains.
function cleanTitle(pane: Pane): string {
  let title = (pane.terminal_title_stripped ?? "").trim();
  const cwd = pane.foreground_cwd || pane.cwd;
  if (cwd) {
    const suffix = ` | ${basename(cwd)}`;
    if (title.endsWith(suffix)) {
      title = title.slice(0, -suffix.length).trim();
    }
  }
  return title;
}

function summarize(workspace: Workspace, panes: Pane[]): WorkspaceSummary {
  const summaries: PaneSummary[] = panes.map((pane) => ({
    id: pane.pane_id,
    title: cleanTitle(pane),
    agent: pane.agent ?? undefined,
    working: pane.agent_status === "working",
  }));

  const titled = summaries.filter((pane) => pane.title);
  const primary = titled.find((pane) => pane.working) ?? titled[0];
  const primaryPane = panes.find((pane) => pane.pane_id === primary?.id) ?? panes[0];
  const cwd = primaryPane?.foreground_cwd || primaryPane?.cwd;

  const agentCounts = new Map<string, number>();
  for (const pane of summaries) {
    if (pane.agent) agentCounts.set(pane.agent, (agentCounts.get(pane.agent) ?? 0) + 1);
  }

  return {
    workspace,
    primaryTitle: primary?.title || workspace.label,
    panes: summaries,
    agents: [...agentCounts].map(([name, count]) => ({ name, count })),
    workingCount: summaries.filter((pane) => pane.working).length,
    cwd: cwd ? shortenPath(cwd) : undefined,
  };
}

export async function loadWorkspaceSummaries(): Promise<WorkspaceSummary[]> {
  const [workspaces, panes] = await Promise.all([listWorkspaces(), listPanes()]);
  return workspaces.map((workspace) =>
    summarize(
      workspace,
      panes.filter((pane) => pane.workspace_id === workspace.workspace_id),
    ),
  );
}
