const path = require("path");

const ICON_MAP = {
  javascript: "lang-js",
  javascriptreact: "lang-js",
  typescript: "lang-ts",
  typescriptreact: "lang-ts",
  python: "lang-py",
  html: "lang-html",
  css: "lang-css",
  scss: "lang-css",
  less: "lang-css",
  json: "lang-json",
  jsonc: "lang-json",
  markdown: "lang-md",
  plaintext: "lang-txt",
  cpp: "lang-cpp",
  c: "lang-c",
  csharp: "lang-csharp",
  java: "lang-java",
  r: "lang-r",
  go: "lang-go",
  rust: "lang-rust",
  php: "lang-php",
  ruby: "lang-ruby",
  shellscript: "lang-shell",
  yaml: "lang-yaml",
  sql: "lang-sql",
  sqlite: "lang-sqlite",
  db: "lang-db",
  dockerfile: "lang-docker",
  vue: "lang-vue",
  swift: "lang-swift",
  gitignore: "lang-git",
  gitconfig: "lang-git",
  kotlin: "lang-kotlin",
  ignore: "lang-git",
};

const EXTENSION_MAP = {
  ".r": "lang-r",
  ".sqlite": "lang-sqlite",
  ".sqlite3": "lang-sqlite",
  ".db": "lang-db",
  ".txt": "lang-txt",
  ".c": "lang-c",
  ".kt": "lang-kotlin",
  ".kts": "lang-kotlin",
  ".env": "lang-env",
};

const FILENAME_MAP = {
  ".gitignore": "lang-git",
  ".gitconfig": "lang-git",
  license: "lang-license",
  "license.txt": "lang-license",
  "license.md": "lang-license",
  licence: "lang-license",
  "licence.txt": "lang-license",
  "licence.md": "lang-license",
  copying: "lang-license",
};

const DEFAULT_ICON_KEY = "lang-default";
const UNKNOWN_FILE_ICON_KEY = "lang-star";
const IDLE_ICON_KEY = "vscode-idle";
const HIDDEN_ICON_KEY = "vscode-hidden";
const BASE_LOGO_KEY = "vscode-logo";

function getIconKey(languageId, filePath) {
  if (filePath) {
    const base = path.basename(filePath).toLowerCase();
    if (FILENAME_MAP[base]) {
      return FILENAME_MAP[base];
    }

    if (base.startsWith(".env")) {
      return "lang-env";
    }

    const ext = path.extname(filePath).toLowerCase();
    if (EXTENSION_MAP[ext]) {
      return EXTENSION_MAP[ext];
    }
  }

  if (ICON_MAP[languageId]) {
    return ICON_MAP[languageId];
  }

  return DEFAULT_ICON_KEY;
}

module.exports = {
  ICON_MAP,
  EXTENSION_MAP,
  FILENAME_MAP,
  DEFAULT_ICON_KEY,
  UNKNOWN_FILE_ICON_KEY,
  IDLE_ICON_KEY,
  BASE_LOGO_KEY,
  HIDDEN_ICON_KEY,
  getIconKey,
};
