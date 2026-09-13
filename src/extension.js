const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const { Client } = require("@xhayper/discord-rpc");
const {
  getIconKey,
  DEFAULT_ICON_KEY,
  UNKNOWN_FILE_ICON_KEY,
  IDLE_ICON_KEY,
  BASE_LOGO_KEY,
  HIDDEN_ICON_KEY,
} = require("./iconMap");
const {
  initGit,
  getCurrentBranch,
  getRemoteUrl,
  getActiveRepoRootName,
} = require("./gitBranch");
const { getFunnyDetails, getIdleQuip } = require("./funny");

const CONFIG_SECTION = "discordRpc";
const DEFAULT_CLIENT_ID = "1545142896284541028";
const SESSION_START_FILE_NAME = "discord-rpc-session-start.txt";
const MIN_VALID_MILLISECONDS_EPOCH = 1_000_000_000_000;
const SESSION_TIMESTAMP_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const LOCK_FILE_NAME = "discord-rpc-lock.json";
const LOCK_HEARTBEAT_MS = 5_000;
const LOCK_STALE_MS = 12_000;

const MIN_ACTIVITY_UPDATE_INTERVAL_MS = 5_000;

/** @type {Client | undefined} */
let rpcClient;
/** @type {vscode.StatusBarItem} */
let statusBarItem;
/** @type {vscode.OutputChannel} */
let logChannel;
let sessionStartTimestamp;
let idleTimer;
let updateDebounce;
let lastActivityPayload;
let lastActivitySentAt = 0;
let isIdle = false;
let manuallyDisconnected = false;
let reconnectTimer;
let reconnectAttempts = 0;
let instanceId;
let lockFilePath;
let lockHeartbeatTimer;
let isLeader = false;

let lastFileActivity;

const GITHUB_REPO_VISIBILITY_CACHE_TTL_MS = 30 * 60 * 1000;
let repoVisibilityCache = { url: undefined, isPublic: false, checkedAt: 0 };
let repoVisibilityCheckInFlight = false;

function parseGitHubOwnerRepo(repoUrl) {
  try {
    const { hostname, pathname } = new URL(repoUrl);
    if (hostname !== "github.com" && hostname !== "www.github.com") return null;
    const [, owner, repo] = pathname.split("/");
    if (!owner || !repo) return null;
    return { owner, repo: repo.replace(/\.git$/, "") };
  } catch (_) {
    return null;
  }
}

function fetchGitHubRepoIsPublic(owner, repo) {
  return new Promise((resolve) => {
    const req = https.get(
      {
        hostname: "api.github.com",
        path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        headers: { "User-Agent": "custom-discord-rpc-vscode-extension" },
        timeout: 8_000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(false);
          return;
        }
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(body);
            resolve(json.private === false);
          } catch (_) {
            resolve(false);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

function refreshGitHubRepoVisibility(repoUrl, owner, repo) {
  if (repoVisibilityCheckInFlight) return;
  repoVisibilityCheckInFlight = true;
  fetchGitHubRepoIsPublic(owner, repo)
    .then((isPublic) => {
      repoVisibilityCache = { url: repoUrl, isPublic, checkedAt: Date.now() };
    })
    .finally(() => {
      repoVisibilityCheckInFlight = false;
    });
}

function isGitHubRepoConfirmedPublic(repoUrl) {
  const ghInfo = parseGitHubOwnerRepo(repoUrl);
  if (!ghInfo) return true;

  const cacheIsFresh =
    repoVisibilityCache.url === repoUrl &&
    Date.now() - repoVisibilityCache.checkedAt <
      GITHUB_REPO_VISIBILITY_CACHE_TTL_MS;

  if (!cacheIsFresh) {
    refreshGitHubRepoVisibility(repoUrl, ghInfo.owner, ghInfo.repo);
  }

  return repoVisibilityCache.url === repoUrl && repoVisibilityCache.isPublic;
}

let globalStorageDir;

const MAX_RECONNECT_DELAY_MS = 60_000;
const BASE_RECONNECT_DELAY_MS = 2_000;

function config() {
  return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

function log(message) {
  logChannel?.appendLine(message);
}

function logError(contextLabel, err) {
  const message = `[${contextLabel}] ${err?.stack || err?.message || err}`;
  console.error(message);
  logChannel?.appendLine(message);
}

function isBenignInspectorNoise(err) {
  const message = err?.message || String(err);
  const stack = err?.stack || "";
  return (
    message.includes("Missing dataLength in event") ||
    stack.includes("node:inspector")
  );
}

process.on("unhandledRejection", (reason) => {
  if (isBenignInspectorNoise(reason)) return;
  logError("unhandledRejection", reason);
});
process.on("uncaughtException", (err) => {
  if (isBenignInspectorNoise(err)) return;
  logError("uncaughtException", err);
});

function parseSessionStartFile(content) {
  const values = {};
  content.split(/\r?\n/).forEach((line) => {
    const [key, ...valueParts] = line.split("=");
    if (!key || !valueParts.length) return;
    values[key.trim()] = valueParts.join("=").trim();
  });

  const timestamp = Number(values.timestamp || values.createdAtMilliseconds);
  const createdAtMilliseconds = Number(values.createdAtMilliseconds);
  const startSeconds = Number(values.startSeconds);

  return {
    vsCodeSessionId: values.vsCodeSessionId,
    timestamp,
    startSeconds,
    createdAtMilliseconds,
  };
}

function formatSessionStartFile() {
  return [
    `vsCodeSessionId=${vscode.env.sessionId}`,
    `timestamp=${sessionStartTimestamp}`,
    "",
  ].join("\n");
}

function syncSessionStartTimestamp() {
  const timestampFilePath = path.join(
    globalStorageDir,
    SESSION_START_FILE_NAME,
  );

  try {
    if (fs.existsSync(timestampFilePath)) {
      const stored = parseSessionStartFile(
        fs.readFileSync(timestampFilePath, "utf8"),
      );
      const ageMs = Date.now() - fs.statSync(timestampFilePath).mtimeMs;
      const timestamp = Number.isInteger(stored.timestamp)
        ? stored.timestamp
        : stored.createdAtMilliseconds;

      if (
        Number.isInteger(timestamp) &&
        timestamp >= MIN_VALID_MILLISECONDS_EPOCH &&
        ageMs < SESSION_TIMESTAMP_MAX_AGE_MS
      ) {
        sessionStartTimestamp = timestamp;
        return;
      }
    }
  } catch (err) {
    logError("read session timestamp file", err);
  }

  fs.mkdirSync(globalStorageDir, { recursive: true });
  sessionStartTimestamp = Date.now();
  fs.writeFileSync(timestampFilePath, formatSessionStartFile(), "utf8");
}

function readLock() {
  try {
    const raw = fs.readFileSync(lockFilePath, "utf8");
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.instanceId === "string" &&
      Number.isInteger(parsed?.updatedAt)
    ) {
      return parsed;
    }
  } catch (_) {}
  return null;
}

function writeLock() {
  fs.writeFileSync(
    lockFilePath,
    JSON.stringify({ instanceId, updatedAt: Date.now() }),
    "utf8",
  );
}

function updateLeadership() {
  try {
    const current = readLock();
    const isStale = !current || Date.now() - current.updatedAt > LOCK_STALE_MS;
    const ownedByUs = current?.instanceId === instanceId;

    if (ownedByUs || isStale) {
      writeLock();
      if (!isLeader) {
        isLeader = true;
        syncSessionStartTimestamp();
        connectRPC();
      }
    } else if (isLeader) {
      isLeader = false;
      disconnectRPC(false);
      setStatusBar(
        "$(circle-slash) Discord RPC (other window active)",
        "Another VS Code window is already updating Discord Rich Presence",
      );
    }
  } catch (err) {
    logError("updateLeadership", err);
  }
}

function releaseLockIfOwned() {
  try {
    const current = readLock();
    if (current?.instanceId === instanceId) {
      fs.unlinkSync(lockFilePath);
    }
  } catch (_) {}
}

function activate(context) {
  logChannel = vscode.window.createOutputChannel("Discord RPC");
  context.subscriptions.push(logChannel);
  log("Discord RPC extension activated");

  try {
    activateInner(context);
  } catch (err) {
    logError("activate", err);
    vscode.window.showErrorMessage(
      `Discord RPC failed to start: ${err?.message || err}. See the "Discord RPC" output channel for details.`,
    );
  }
}

function activateInner(context) {
  globalStorageDir = context.globalStorageUri.fsPath;
  syncSessionStartTimestamp();

  instanceId = crypto.randomUUID();
  lockFilePath = path.join(globalStorageDir, LOCK_FILE_NAME);

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBarItem.command = "discordRpc.manage";
  context.subscriptions.push(statusBarItem);
  setStatusBar("$(plug) Discord RPC", "Click to manage Discord Rich Presence");
  statusBarItem.show();

  context.subscriptions.push(
    vscode.commands.registerCommand("discordRpc.manage", showManageMenu),
    vscode.commands.registerCommand("discordRpc.toggleConnection", () => {
      if (rpcClient) {
        disconnectRPC(true);
      } else {
        isLeader = true;
        writeLock();
        syncSessionStartTimestamp();
        connectRPC(true);
      }
    }),
    vscode.commands.registerCommand("discordRpc.reconnect", () => {
      disconnectRPC(false);
      isLeader = true;
      writeLock();
      syncSessionStartTimestamp();
      connectRPC(true);
    }),
    vscode.commands.registerCommand("discordRpc.disconnect", () => {
      disconnectRPC(true);
    }),
    vscode.commands.registerCommand("discordRpc.openSettings", () => {
      openSettings();
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      resetIdleTimer();
      scheduleActivityUpdate();
    }),
    vscode.workspace.onDidChangeTextDocument(handleEditorActivity),
    vscode.window.onDidChangeTextEditorSelection(handleEditorActivity),
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        if (!isLeader) {
          isLeader = true;
          writeLock();
          syncSessionStartTimestamp();
          connectRPC();
        }
        resetIdleTimer();
        scheduleActivityUpdate();
      } else if (isLeader) {
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`${CONFIG_SECTION}.enabled`)) {
        disconnectRPC(false);
        connectRPC();
      } else if (e.affectsConfiguration(CONFIG_SECTION)) {
        log("Settings updated");
        scheduleActivityUpdate();
      }
    }),
  );

  updateLeadership();
  lockHeartbeatTimer = setInterval(updateLeadership, LOCK_HEARTBEAT_MS);
  context.subscriptions.push({
    dispose: () => clearInterval(lockHeartbeatTimer),
  });

  initGit().then((gitApi) => {
    if (gitApi) {
      context.subscriptions.push(
        gitApi.onDidOpenRepository((repo) => {
          context.subscriptions.push(
            repo.state.onDidChange(scheduleActivityUpdate),
          );
          scheduleActivityUpdate();
        }),
      );
      gitApi.repositories.forEach((repo) => {
        context.subscriptions.push(
          repo.state.onDidChange(scheduleActivityUpdate),
        );
      });
    }
  });
}

function cleanupClient() {
  if (!rpcClient) return;
  const client = rpcClient;
  rpcClient = undefined;
  lastActivityPayload = undefined;
  try {
    client.destroy();
  } catch (err) {
    logError("cleanupClient", err);
  }
}

function connectRPC(clearManualDisconnect = false) {
  if (clearManualDisconnect) {
    manuallyDisconnected = false;
    reconnectAttempts = 0;
  }

  clearTimeout(reconnectTimer);

  if (manuallyDisconnected) {
    setStatusBar(
      "$(circle-slash) Discord RPC off",
      "Click to reconnect Discord Rich Presence",
    );
    return;
  }

  if (!config().get("enabled")) {
    setStatusBar(
      "$(circle-slash) Discord RPC off",
      "Discord RPC disabled in settings. Click to reconnect when enabled.",
    );
    return;
  }

  setStatusBar(
    "$(sync~spin) Connecting to Discord...",
    "Connecting to Discord Rich Presence",
  );

  try {
    cleanupClient();

    rpcClient = new Client({ clientId: DEFAULT_CLIENT_ID });

    rpcClient.on("ready", () => {
      try {
        reconnectAttempts = 0;
        setStatusBar("$(plug) Discord RPC connected", "Click to disconnect");
        log("Connected to Discord");
        scheduleActivityUpdate();
        resetIdleTimer();
      } catch (err) {
        logError("on ready", err);
      }
    });

    rpcClient.on("disconnected", () => {
      try {
        cleanupClient();
        setStatusBar(
          "$(debug-disconnect) Discord RPC disconnected",
          "Reconnecting automatically... (click to reconnect now)",
        );
        log("Disconnected from Discord");
        scheduleReconnect();
      } catch (err) {
        logError("on disconnected", err);
      }
    });

    rpcClient.login().catch((err) => {
      cleanupClient();
      logError("login", err);
      setStatusBar(
        "$(error) Discord RPC failed",
        `Could not connect: ${err.message || err}. Retrying automatically...`,
      );
      scheduleReconnect();
    });
  } catch (err) {
    cleanupClient();
    logError("connectRPC", err);
    setStatusBar(
      "$(error) Discord RPC failed",
      `Could not connect: ${err.message || err}. Retrying automatically...`,
    );
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (manuallyDisconnected || !config().get("enabled")) return;

  clearTimeout(reconnectTimer);
  const delay = Math.min(
    BASE_RECONNECT_DELAY_MS * 2 ** reconnectAttempts,
    MAX_RECONNECT_DELAY_MS,
  );
  reconnectAttempts += 1;

  reconnectTimer = setTimeout(() => {
    connectRPC();
  }, delay);
}

function disconnectRPC(manual = false) {
  if (manual) {
    manuallyDisconnected = true;
  }
  clearTimeout(idleTimer);
  clearTimeout(updateDebounce);
  clearTimeout(reconnectTimer);
  cleanupClient();
  if (manual) {
    log("Discord RPC disconnected");
    setStatusBar(
      "$(circle-slash) Discord RPC off",
      "Click to reconnect Discord Rich Presence",
    );
  }
}

async function showManageMenu() {
  try {
    await showManageMenuInner();
  } catch (err) {
    logError("showManageMenu", err);
  }
}

async function showManageMenuInner() {
  const connectionLabel = rpcClient ? "Disconnect" : "Reconnect";
  const choice = await vscode.window.showQuickPick(
    [
      {
        label: `$(settings-gear) Open Settings`,
        action: "settings",
      },
      {
        label: `$(plug) ${connectionLabel}`,
        action: "toggle",
      },
      {
        label: "$(file) Edit Hidden File Patterns",
        action: "hiddenFiles",
      },
      {
        label: "$(folder) Edit Hidden Folder Patterns",
        action: "hiddenFolders",
      },
    ],
    { placeHolder: "Manage Discord RPC" },
  );

  if (!choice) return;

  if (choice.action === "settings") {
    openSettings();
  } else if (choice.action === "toggle") {
    if (rpcClient) {
      disconnectRPC(true);
    } else {
      connectRPC(true);
    }
  } else if (choice.action === "hiddenFiles") {
    await editPatternSetting("hiddenFilePatterns", "Hidden file patterns");
  } else if (choice.action === "hiddenFolders") {
    await editPatternSetting("hiddenFolderPatterns", "Hidden folder patterns");
  }
}

function openSettings() {
  vscode.commands.executeCommand(
    "workbench.action.openSettings",
    CONFIG_SECTION,
  );
}

async function editPatternSetting(settingName, title) {
  const currentPatterns = config().get(settingName) || [];
  const value = await vscode.window.showInputBox({
    title,
    prompt: "Comma-separated patterns. Example: .env, *.pem, secrets/*",
    value: currentPatterns.join(", "),
  });

  if (value === undefined) return;

  const patterns = value
    .split(",")
    .map((pattern) => pattern.trim())
    .filter(Boolean);

  const target = vscode.workspace.workspaceFolders
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;

  await config().update(settingName, patterns, target);
  log("Settings updated");
  scheduleActivityUpdate();
}

function scheduleActivityUpdate() {
  clearTimeout(updateDebounce);
  const sinceLastSend = Date.now() - lastActivitySentAt;
  const delay = Math.max(500, MIN_ACTIVITY_UPDATE_INTERVAL_MS - sinceLastSend);
  updateDebounce = setTimeout(setActivity, delay);
}

function resetIdleTimer() {
  isIdle = false;
  clearTimeout(idleTimer);
  const timeoutSeconds = config().get("idleCheckTimeout") || 300;
  idleTimer = setTimeout(() => {
    isIdle = true;
    setActivity();
  }, timeoutSeconds * 1000);
}

function handleEditorActivity() {
  resetIdleTimer();
  scheduleActivityUpdate();
}

function getEditorPositionText(editor) {
  const position = editor.selection.active;
  return `${position.line + 1};${position.character + 1}`;
}

function getWorkspaceName(activeUri) {
  const repoRootName = getActiveRepoRootName();
  if (repoRootName) return repoRootName;

  if (activeUri) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeUri);
    if (workspaceFolder) return workspaceFolder.name;
  }

  return vscode.workspace.name;
}

function normalizePath(value) {
  return value.replace(/\\/g, "/").toLowerCase();
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegExp(pattern) {
  const normalized = normalizePath(pattern).replace(/^\/+|\/+$/g, "");
  const regex = [...normalized]
    .map((char) => {
      if (char === "*") return ".*";
      return escapeRegExp(char);
    })
    .join("");

  return new RegExp(`^${regex}$`);
}

function matchesPattern(value, patterns) {
  const normalizedValue = normalizePath(value).replace(/^\/+|\/+$/g, "");
  return patterns.some((pattern) => {
    if (!pattern || typeof pattern !== "string") return false;
    return globToRegExp(pattern).test(normalizedValue);
  });
}

function getPathInfoFromUri(uri) {
  const filePath = uri.fsPath;
  const fileName = filePath.split(/[\\/]/).pop();
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  const relativePath = workspaceFolder
    ? vscode.workspace.asRelativePath(uri, false)
    : fileName;

  return { fileName, relativePath };
}

function getEditorPathInfo(editor) {
  return getPathInfoFromUri(editor.document.uri);
}

function isHiddenUri(uri) {
  const hiddenFilePatterns = config().get("hiddenFilePatterns") || [];
  const hiddenFolderPatterns = config().get("hiddenFolderPatterns") || [];
  const { fileName, relativePath } = getPathInfoFromUri(uri);
  const pathParts = normalizePath(relativePath).split("/");
  const folderParts = pathParts.slice(0, -1);
  const folderPath = folderParts.join("/");

  return (
    matchesPattern(fileName, hiddenFilePatterns) ||
    matchesPattern(relativePath, hiddenFilePatterns) ||
    matchesPattern(folderPath, hiddenFolderPatterns) ||
    folderParts.some((folder) => matchesPattern(folder, hiddenFolderPatterns))
  );
}

function getActiveNonTextFileUri() {
  const input = vscode.window.tabGroups.activeTabGroup?.activeTab?.input;
  if (
    input instanceof vscode.TabInputCustom ||
    input instanceof vscode.TabInputText
  ) {
    return input.uri;
  }
  return undefined;
}

function getProblemsCount() {
  const workspaceFolders = vscode.workspace.workspaceFolders || [];
  const diagnostics = vscode.languages.getDiagnostics();

  return diagnostics.reduce((count, [uri, items]) => {
    if (workspaceFolders.length) {
      const diagnosticPath = uri.fsPath.toLowerCase();
      const isInWorkspace = workspaceFolders.some((folder) => {
        const folderPath = folder.uri.fsPath.toLowerCase();
        return (
          diagnosticPath === folderPath ||
          diagnosticPath.startsWith(`${folderPath}\\`) ||
          diagnosticPath.startsWith(`${folderPath}/`)
        );
      });
      if (!isInWorkspace) return count;
    }

    return count + items.length;
  }, 0);
}

function setActivity() {
  if (!rpcClient) return;

  try {
    setActivityInner();
  } catch (err) {
    logError("setActivity", err);
  }
}

function setDiscordActivity(activity) {
  return rpcClient.user.setActivity(activity, process.pid);
}

function setActivityInner() {
  const rawEditor = vscode.window.activeTextEditor;
  const editor =
    rawEditor && rawEditor.document.uri.scheme !== "output"
      ? rawEditor
      : undefined;
  const mediaUri = editor ? undefined : getActiveNonTextFileUri();
  const activeUri = editor ? editor.document.uri : mediaUri;
  const showFileName = config().get("showFileName");
  const showWorkspace = config().get("showWorkspace");
  const showElapsedTime = config().get("showElapsedTime");
  const showGitBranch = config().get("showGitBranch");
  const showProblems = config().get("showProblems");
  const funnyMode = config().get("funnyMode");
  const showRepoButton = config().get("showRepoButton");
  const secondButtonLabel = config().get("secondButtonLabel");
  const secondButtonUrl = config().get("secondButtonUrl");
  const keepLastFileOnBlur = config().get("keepLastFileOnBlur");

  let details;
  let largeImageKey;
  let largeImageText;

  const editorIsHidden = activeUri ? isHiddenUri(activeUri) : false;

  if (isIdle) {
    details = funnyMode ? getIdleQuip() : "Idle";
    largeImageKey = IDLE_ICON_KEY;
    largeImageText = "Idle";
  } else if (editor) {
    if (editorIsHidden) {
      details = "Editing ???";
      largeImageKey = HIDDEN_ICON_KEY;
      largeImageText = "Hidden file";
    } else {
      const languageId = editor.document.languageId;
      const { fileName } = getEditorPathInfo(editor);
      const fileLabel = `${fileName} - ${getEditorPositionText(editor)}`;
      largeImageKey = getIconKey(languageId, editor.document.uri.fsPath);

      if (largeImageKey === DEFAULT_ICON_KEY) {
        details = `Spectating some assets: ${fileName}`;
        largeImageKey = UNKNOWN_FILE_ICON_KEY;
      } else if (funnyMode) {
        details = getFunnyDetails(
          languageId,
          fileLabel,
          editor.document.uri.toString(),
        );
      } else {
        details = showFileName ? `Editing ${fileLabel}` : "Editing a file";
      }
      largeImageText = languageId.length >= 2 ? languageId : `${languageId} `;
    }
    if (!editorIsHidden) {
      lastFileActivity = { details, largeImageKey, largeImageText };
    }
  } else if (mediaUri) {
    if (editorIsHidden) {
      details = "Editing ???";
      largeImageKey = HIDDEN_ICON_KEY;
      largeImageText = "Hidden file";
    } else {
      const { fileName } = getPathInfoFromUri(mediaUri);
      details = `Spectating some assets: ${fileName}`;
      largeImageKey = UNKNOWN_FILE_ICON_KEY;
      largeImageText = "Wonderful assets";
    }
    if (!editorIsHidden) {
      lastFileActivity = { details, largeImageKey, largeImageText };
    }
  } else if (keepLastFileOnBlur && lastFileActivity) {
    ({ details, largeImageKey, largeImageText } = lastFileActivity);
  } else {
    details = funnyMode ? "Deciding what to open" : "Not in a file";
    largeImageKey = DEFAULT_ICON_KEY;
    largeImageText = "Idle";
  }

  const repoUrl = getRemoteUrl();
  const repoIsConfirmedPublicOrNotGitHub = isGitHubRepoConfirmedPublic(repoUrl);

  const stateParts = [];
  const workspaceName = getWorkspaceName(activeUri);
  if (showWorkspace && workspaceName && !editorIsHidden) {
    stateParts.push(workspaceName);
  }
  if (showProblems) {
    const problemsCount = getProblemsCount();
    if (problemsCount) {
      const label = problemsCount === 1 ? "Problem" : "Problems";
      stateParts.push(`${problemsCount} ${label}`);
    }
  }
  if (showGitBranch && !editorIsHidden && repoIsConfirmedPublicOrNotGitHub) {
    const branch = getCurrentBranch();
    if (branch) stateParts.push(`branch: ${branch}`);
  }
  const state = stateParts.length ? stateParts.join(" - ") : undefined;

  const buttons = [];
  if (showRepoButton && repoUrl && repoIsConfirmedPublicOrNotGitHub) {
    buttons.push({ label: "View Repository", url: repoUrl });
  }
  if (secondButtonLabel && secondButtonUrl) {
    buttons.push({ label: secondButtonLabel, url: secondButtonUrl });
  }

  const activity = {
    details,
    state,
    largeImageKey,
    largeImageText,
    smallImageKey: BASE_LOGO_KEY,
    smallImageText: "Visual Studio Code",
    instance: true,
  };

  if (showElapsedTime && sessionStartTimestamp) {
    activity.startTimestamp = sessionStartTimestamp;
  }
  if (buttons.length) {
    activity.buttons = buttons;
  }

  const activityPayload = JSON.stringify(activity);
  if (activityPayload === lastActivityPayload) return;
  lastActivityPayload = activityPayload;
  lastActivitySentAt = Date.now();

  setDiscordActivity(activity).catch(() => {
    lastActivityPayload = undefined;
  });
}

function setStatusBar(text, tooltip) {
  statusBarItem.text = text;
  statusBarItem.tooltip = tooltip;
}

function deactivate() {
  clearInterval(lockHeartbeatTimer);
  if (isLeader) {
    releaseLockIfOwned();
  }
  disconnectRPC();
}

module.exports = { activate, deactivate };
