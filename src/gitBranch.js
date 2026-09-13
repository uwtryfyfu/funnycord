const vscode = require("vscode");

let gitApi;

async function initGit() {
  try {
    const gitExtension = vscode.extensions.getExtension("vscode.git");
    if (!gitExtension) return null;
    const exports = gitExtension.isActive
      ? gitExtension.exports
      : await gitExtension.activate();
    gitApi = exports.getAPI(1);
    return gitApi;
  } catch (_) {
    return null;
  }
}

function getActiveRepo() {
  if (!gitApi || !gitApi.repositories.length) return undefined;
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const match = gitApi.repositories.find((r) =>
      editor.document.uri.fsPath.startsWith(r.rootUri.fsPath),
    );
    if (match) return match;
  }
  return gitApi.repositories[0];
}

function getCurrentBranch() {
  const repo = getActiveRepo();
  return repo?.state?.HEAD?.name;
}

function getActiveRepoRootName() {
  const repo = getActiveRepo();
  return repo?.rootUri?.fsPath.split(/[\\/]/).pop();
}

function getRemoteUrl() {
  const repo = getActiveRepo();
  if (!repo) return undefined;
  const remote =
    repo.state.remotes.find((r) => r.name === "origin") ||
    repo.state.remotes[0];
  let url = remote?.fetchUrl || remote?.pushUrl;
  if (!url) return undefined;
  // Normalize git@github.com:user/repo.git -> https://github.com/user/repo
  if (url.startsWith("git@")) {
    url = url.replace(":", "/").replace("git@", "https://");
  }
  return url.replace(/\.git$/, "");
}

module.exports = {
  initGit,
  getCurrentBranch,
  getRemoteUrl,
  getActiveRepoRootName,
};
