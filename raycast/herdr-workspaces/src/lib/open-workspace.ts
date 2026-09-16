import { getPreferenceValues, showHUD } from "@raycast/api";
import { setTimeout as sleep } from "node:timers/promises";
import {
  findHerdrTerminal,
  focusTerminal,
  hasHerdrClientInGhostty,
  openGhosttyWindow,
  placeFrontGhosttyWindow,
  WindowPlacement,
} from "./ghostty";
import { focusWorkspace, listWorkspaces, resolveHerdrPath } from "./herdr";

const ATTACH_TIMEOUT_MS = 15000;
const SERVER_START_TIMEOUT_MS = 15000;

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return true;
    await sleep(250);
  }
  return false;
}

function shellQuote(value: string): string {
  return /^[\w./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

// Opens a new Ghostty window whose shell runs `herdr` (attaching to the server, or starting it if needed).
async function openHerdrWindow(): Promise<void> {
  await openGhosttyWindow(shellQuote(await resolveHerdrPath()));

  const { windowPlacement = "left" } = getPreferenceValues<{ windowPlacement?: WindowPlacement | "default" }>();
  if (windowPlacement === "default") return;
  try {
    await placeFrontGhosttyWindow(windowPlacement);
  } catch {
    // Placement is cosmetic; keep going and point at the usual cause (missing Accessibility permission).
    await showHUD("Couldn't resize the Ghostty window. Allow Raycast in Privacy & Security › Accessibility.");
  }
}

// Used when the herdr server isn't running: start it in Ghostty and wait until the API answers.
export async function startHerdrServerInGhostty(): Promise<void> {
  await openHerdrWindow();
  if (!(await waitUntil(async () => (await listWorkspaces(), true), SERVER_START_TIMEOUT_MS))) {
    throw new Error("herdr server did not start in time.");
  }
}

/**
 * Focuses the workspace and shows it in Ghostty, opening a window running herdr when none is visible.
 * `onGhosttyLaunching` is called right before a new Ghostty window is opened (Raycast loses focus after that).
 */
export async function openWorkspaceInGhostty(workspaceId: string, onGhosttyLaunching?: () => void): Promise<void> {
  await focusWorkspace(workspaceId);
  const labels = (await listWorkspaces()).map((workspace) => workspace.label);

  // A closed window keeps its herdr client alive for Ghostty's undo timeout, so a running client alone
  // doesn't mean a window is showing it; require a visible terminal with herdr's title too.
  const existing = (await hasHerdrClientInGhostty()) ? await findHerdrTerminal(labels) : undefined;
  if (existing) {
    await focusTerminal(existing);
    return;
  }

  onGhosttyLaunching?.();
  await openHerdrWindow();
  if (!(await waitUntil(async () => (await findHerdrTerminal(labels)) !== undefined, ATTACH_TIMEOUT_MS))) {
    throw new Error("herdr did not start in the new Ghostty window in time.");
  }
  // Re-apply in case the newly attached client came up on a different workspace.
  await focusWorkspace(workspaceId);
}
