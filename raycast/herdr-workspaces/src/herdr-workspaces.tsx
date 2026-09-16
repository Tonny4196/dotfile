import {
  Action,
  ActionPanel,
  closeMainWindow,
  Color,
  Icon,
  Keyboard,
  List,
  openExtensionPreferences,
  showHUD,
  showToast,
  Toast,
} from "@raycast/api";
import { showFailureToast, usePromise } from "@raycast/utils";
import { HerdrError, HerdrNotFoundError, loadWorkspaceSummaries, WorkspaceSummary } from "./lib/herdr";
import { openWorkspaceInGhostty, startHerdrServerInGhostty } from "./lib/open-workspace";

function isServerNotRunning(error: unknown): boolean {
  return error instanceof HerdrError && error.code === "server_not_running";
}

export default function Command() {
  const { data, isLoading, error, revalidate } = usePromise(loadWorkspaceSummaries, [], {
    onError: (error) => {
      showFailureToast(error, {
        title: "Failed to load Herdr workspaces",
        primaryAction:
          error instanceof HerdrNotFoundError
            ? { title: "Open Extension Preferences", onAction: () => openExtensionPreferences() }
            : isServerNotRunning(error)
              ? { title: "Start Herdr in Ghostty", onAction: () => startHerdr(revalidate) }
              : undefined,
      });
    },
  });

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search Herdr workspaces...">
      {error && !isLoading ? (
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="Failed to load Herdr workspaces"
          description={error.message}
          actions={
            <ActionPanel>
              {isServerNotRunning(error) && (
                <Action title="Start Herdr in Ghostty" icon={Icon.Terminal} onAction={() => startHerdr(revalidate)} />
              )}
              <Action title="Retry" icon={Icon.ArrowClockwise} onAction={revalidate} />
              <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
            </ActionPanel>
          }
        />
      ) : (
        <List.EmptyView icon={Icon.Terminal} title="No Herdr workspaces" />
      )}
      {data?.map((summary) => (
        <WorkspaceItem key={summary.workspace.workspace_id} summary={summary} onRefresh={revalidate} />
      ))}
    </List>
  );
}

function WorkspaceItem({ summary, onRefresh }: { summary: WorkspaceSummary; onRefresh: () => void }) {
  const { workspace, primaryTitle, panes, agents, workingCount, cwd } = summary;
  const otherPaneCount = panes.length - 1;

  const accessories: List.Item.Accessory[] = [];
  if (otherPaneCount > 0) {
    accessories.push({
      text: `+${otherPaneCount}`,
      tooltip: panes.map((pane) => `${pane.working ? "⚡" : "○"} ${pane.title || "(untitled)"}`).join("\n"),
    });
  }
  for (const agent of agents) {
    accessories.push({ text: `${agent.name}×${agent.count}` });
  }
  if (workingCount > 0) {
    accessories.push({
      icon: { source: Icon.Bolt, tintColor: Color.Yellow },
      text: String(workingCount),
      tooltip: `${workingCount} working`,
    });
  }
  if (cwd) {
    accessories.push({ icon: Icon.Folder, text: abbreviateDirectory(cwd), tooltip: cwd });
  }
  if (workspace.focused) {
    accessories.push({ tag: { value: "Current", color: Color.Green } });
  }

  const titles = panes.map((pane) => pane.title).filter(Boolean);
  const keywords = [
    workspace.label,
    workspace.workspace_id,
    String(workspace.number),
    ...(cwd ? [cwd] : []),
    ...titles,
    // Split titles so that a word in the middle of a title can also be matched by prefix.
    ...titles.flatMap((title) => title.split(/\s+/)),
  ];

  return (
    <List.Item
      id={workspace.workspace_id}
      icon={statusIcon(workspace.agent_status, workingCount)}
      title={primaryTitle}
      subtitle={workspace.label}
      keywords={[...new Set(keywords)]}
      accessories={accessories}
      actions={
        <ActionPanel>
          <Action title="Switch to Workspace" icon={Icon.Terminal} onAction={() => switchTo(summary)} />
          <Action
            title="Refresh"
            icon={Icon.ArrowClockwise}
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={onRefresh}
          />
          <Action.CopyToClipboard
            title="Copy Workspace ID"
            content={workspace.workspace_id}
            shortcut={Keyboard.Shortcut.Common.Copy}
          />
        </ActionPanel>
      }
    />
  );
}

async function switchTo(summary: WorkspaceSummary) {
  const toast = await showToast({ style: Toast.Style.Animated, title: "Switching workspace..." });
  let launchingGhostty = false;
  try {
    await openWorkspaceInGhostty(summary.workspace.workspace_id, () => {
      launchingGhostty = true;
      toast.title = "Starting Herdr in Ghostty...";
    });
    await toast.hide();
    await closeMainWindow({ clearRootSearch: true });
  } catch (error) {
    await toast.hide();
    // Once Ghostty has been brought up, the Raycast window is hidden and a toast would go unseen.
    if (launchingGhostty) {
      await showHUD(`Failed to switch workspace: ${error instanceof Error ? error.message : String(error)}`);
    } else {
      await showFailureToast(error, { title: "Failed to switch workspace" });
    }
  }
}

async function startHerdr(onStarted: () => void) {
  const toast = await showToast({ style: Toast.Style.Animated, title: "Starting Herdr in Ghostty..." });
  try {
    await startHerdrServerInGhostty();
    await toast.hide();
    onStarted();
  } catch (error) {
    await toast.hide();
    await showHUD(`Failed to start Herdr: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function statusIcon(agentStatus: string | undefined, workingCount: number) {
  if (agentStatus === "working" || workingCount > 0) {
    return { source: Icon.CircleFilled, tintColor: Color.Yellow };
  }
  if (!agentStatus || agentStatus === "idle") {
    return { source: Icon.Circle, tintColor: Color.SecondaryText };
  }
  return { source: Icon.CircleFilled, tintColor: Color.Blue };
}

// "~/workspace/elanblnac/社長の金庫番" -> "~/workspace/…/社長の金庫番"
function abbreviateDirectory(path: string): string {
  const segments = path.split("/");
  return segments.length > 3 ? [segments[0], segments[1], "…", segments[segments.length - 1]].join("/") : path;
}
