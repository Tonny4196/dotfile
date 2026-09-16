import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GHOSTTY_BUNDLE_ID = "com.mitchellh.ghostty";
const GHOSTTY_EXECUTABLE = "/Ghostty.app/Contents/MacOS/ghostty";

// An app launched through AppleScript inherits the caller's environment. If HERDR_* variables leak into Ghostty,
// every shell in it looks like a herdr pane and `herdr` refuses to start ("nested herdr is disabled"), so drop them.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("HERDR_")));

async function runOsascript(osaArgs: string[], timeout: number): Promise<string> {
  const { stdout } = await execFileAsync("/usr/bin/osascript", osaArgs, { env: cleanEnv, timeout });
  return stdout.trim();
}

function runAppleScript(script: string, args: string[] = [], timeout = 5000): Promise<string> {
  return runOsascript(["-e", script, ...args], timeout);
}

function runJavaScript(script: string, args: string[] = [], timeout = 5000): Promise<string> {
  return runOsascript(["-l", "JavaScript", "-e", script, ...args], timeout);
}

// Opens a new Ghostty window whose shell runs `shellCommand` right away, launching Ghostty if needed.
// When Ghostty is launched here, the blank windows it creates on startup are closed so only the new window remains.
const OPEN_WINDOW_SCRIPT = `
on run argv
  set shellCommand to item 1 of argv
  set wasRunning to application id "${GHOSTTY_BUNDLE_ID}" is running
  tell application id "${GHOSTTY_BUNDLE_ID}"
    set startupWindowIds to {}
    if not wasRunning then
      repeat 100 times
        if (count of windows) > 0 then exit repeat
        delay 0.1
      end repeat
      set startupWindowIds to id of every window
    end if
    set cfg to new surface configuration
    set initial input of cfg to shellCommand & return
    new window with configuration cfg
    repeat with windowId in startupWindowIds
      repeat with w in windows
        if (id of w) is (contents of windowId) then
          close window w
          exit repeat
        end if
      end repeat
    end repeat
    activate
  end tell
end run`;

export async function openGhosttyWindow(shellCommand: string): Promise<void> {
  await runAppleScript(OPEN_WINDOW_SCRIPT, [shellCommand], 20000);
}

// Lists terminals in visible windows as "<id>\t<title>" lines. Windows closed but kept alive for undo are not included.
// The separator is defined outside the tell block: inside it, `tab` resolves to Ghostty's tab class.
const LIST_TERMINALS_SCRIPT = `
if not (application id "${GHOSTTY_BUNDLE_ID}" is running) then return ""
set separator to character id 9
set output to ""
tell application id "${GHOSTTY_BUNDLE_ID}"
  repeat with i from 1 to count of windows
    set terminalIds to id of every terminal of window i
    set terminalNames to name of every terminal of window i
    repeat with j from 1 to count of terminalIds
      set output to output & (item j of terminalIds) & separator & (item j of terminalNames) & linefeed
    end repeat
  end repeat
end tell
return output`;

const FOCUS_TERMINAL_SCRIPT = `
on run argv
  tell application id "${GHOSTTY_BUNDLE_ID}"
    focus terminal id (item 1 of argv)
    activate
  end tell
end run`;

/**
 * Returns the id of a terminal in a visible Ghostty window that is running herdr. herdr titles its terminal
 * "<host>: <focused workspace label>", so titles are matched against the known workspace labels.
 */
export async function findHerdrTerminal(workspaceLabels: string[]): Promise<string | undefined> {
  const output = await runAppleScript(LIST_TERMINALS_SCRIPT);
  const terminal = output
    .split("\n")
    .map((line) => line.split("\t"))
    .find(([, title = ""]) => {
      const match = title.match(/^[^\s:]+: (.+)$/);
      return match !== null && workspaceLabels.includes(match[1]);
    });
  return terminal?.[0];
}

// Brings the terminal's window to the front and activates Ghostty.
export async function focusTerminal(terminalId: string): Promise<void> {
  await runAppleScript(FOCUS_TERMINAL_SCRIPT, [terminalId]);
}

export type WindowPlacement = "left" | "right" | "full";

// Moves Ghostty's front window to the left/right half or the whole visible area (menu bar and Dock excluded)
// of the screen it is on. Uses System Events, so Raycast needs the Accessibility permission.
const PLACE_WINDOW_SCRIPT = `
ObjC.import("AppKit");
function run(argv) {
  const placement = argv[0];
  const ghostty = Application("System Events").processes.whose({ bundleIdentifier: "${GHOSTTY_BUNDLE_ID}" })[0];
  for (let i = 0; i < 20 && ghostty.windows.length === 0; i++) delay(0.1);
  const window = ghostty.windows[0];
  const [x, y] = window.position();
  const [width, height] = window.size();

  // NSScreen frames have a bottom-left origin on the primary screen; System Events uses a top-left origin.
  const screens = $.NSScreen.screens.js;
  const primaryHeight = screens[0].frame.size.height;
  const toTopLeft = (r) => ({ x: r.origin.x, y: primaryHeight - r.origin.y - r.size.height, width: r.size.width, height: r.size.height });
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const screen = screens
    .map((s) => ({ frame: toTopLeft(s.frame), visible: toTopLeft(s.visibleFrame) }))
    .find(({ frame: f }) => centerX >= f.x && centerX < f.x + f.width && centerY >= f.y && centerY < f.y + f.height);
  const visible = screen ? screen.visible : toTopLeft(screens[0].visibleFrame);

  const half = Math.floor(visible.width / 2);
  const left = placement === "right" ? visible.x + visible.width - half : visible.x;
  const newWidth = placement === "full" ? visible.width : half;
  window.position = [left, visible.y];
  window.size = [newWidth, visible.height];
  window.position = [left, visible.y];
}`;

export async function placeFrontGhosttyWindow(placement: WindowPlacement): Promise<void> {
  await runJavaScript(PLACE_WINDOW_SCRIPT, [placement]);
}

// herdr has no API for attached clients, so look for an attach process (`herdr`, `herdr --session x`,
// `herdr session attach x`) whose ancestor is the Ghostty app.
export async function hasHerdrClientInGhostty(): Promise<boolean> {
  const { stdout } = await execFileAsync("/bin/ps", ["-axo", "pid=,ppid=,args="]);
  const processes = new Map<number, { ppid: number; args: string }>();
  for (const line of stdout.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (match) processes.set(Number(match[1]), { ppid: Number(match[2]), args: match[3] });
  }

  for (const { ppid, args } of processes.values()) {
    const [command, ...rest] = args.split(/\s+/);
    if (basename(command) !== "herdr" || !isAttachArgs(rest)) continue;

    for (let pid = ppid, depth = 0; pid > 1 && depth < 20; depth++) {
      const parent = processes.get(pid);
      if (!parent) break;
      if (parent.args.includes(GHOSTTY_EXECUTABLE)) return true;
      pid = parent.ppid;
    }
  }
  return false;
}

function isAttachArgs(args: string[]): boolean {
  return args.length === 0 || args[0].startsWith("-") || (args[0] === "session" && args[1] === "attach");
}
