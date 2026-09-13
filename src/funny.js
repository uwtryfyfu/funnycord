const path = require("path");

const LANG_VERBS = {
  javascript: ["Wrestling with", "Arguing with", "Bribing", "Reasoning with"],
  javascriptreact: ["Herding components in", "Wrestling with"],
  typescript: [
    "Negotiating types in",
    "Fighting the compiler over",
    "Arguing with",
  ],
  typescriptreact: [
    "Herding typed components in",
    "Fighting the compiler over",
  ],
  python: [
    "Taming the snake in",
    "Aggressively indenting",
    "Whitespace-wrangling",
  ],
  html: ["Nesting divs in", "Untangling tags in", "Closing tags in"],
  css: [
    "Fighting specificity in",
    "Trying to center a div in",
    "Overriding !important in",
  ],
  scss: ["Nesting way too deep in", "Fighting specificity in"],
  json: [
    "Counting brackets in",
    "Minifying feelings about",
    "Chasing a trailing comma in",
  ],
  markdown: ["Writing a novel in", "Bulleting furiously in", "Formatting"],
  cpp: ["Managing memory (badly) in", "Fighting pointers in"],
  c: ["Segfaulting somewhere in", "Fighting pointers in"],
  java: [
    "Writing 40 lines of boilerplate in",
    "Extending AbstractFactoryImpl in",
  ],
  go: ["Handling every possible error in", "Formatting with gofmt in"],
  rust: ["Fighting the borrow checker in", "Finally getting it to compile in"],
  php: ["Reviving legacy code in", "Arguing with"],
  ruby: ["Making it beautifully unreadable in", "Vibing with"],
  shellscript: ["Piping chaos through", "Praying the exit code is 0 in"],
  sql: ["Writing a query that will haunt me in", "Joining seventeen tables in"],
  sqlite: [
    "Writing a query that will haunt me in",
    "Joining seventeen tables in",
  ],
  db: ["Writing a query that will haunt me in", "Joining seventeen tables in"],
  r: ["Plotting data in", "Debugging a statistical model in"],
  dockerfile: ["Building a container for", "Arguing with Docker over"],
  yaml: ["Counting spaces in", "Breaking the build with one space in"],
  default: [
    "Staring blankly at",
    "Vibing with",
    "Debugging",
    "Slowly losing it in",
  ],
  env: ["Setting environment variables in", "Arguing with dotenv over"],
  license: [
    "Reading the fine print in",
    "Definitely reading all of",
    "Pretending to understand",
    "Getting legal advice from",
  ],
};

const LICENSE_FILENAMES = new Set([
  "license",
  "license.txt",
  "license.md",
  "licence",
  "licence.txt",
  "licence.md",
  "copying",
]);

const IDLE_QUIPS = [
  "Probably making coffee ☕",
  "AFK - kidnapped by Stack Overflow",
  "Contemplating a career change",
  'Reading Hacker News "for research"',
  "Lost in a rabbit hole of docs",
  "Renaming a variable for the 5th time",
  "Staring blankly at a stack trace",
  "Negotiating with a merge conflict",
  "Explaining the bug to a rubber duck",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

let verbCache = null;

function isLicenseFile(cacheKey) {
  if (!cacheKey) return false;
  try {
    const base = path.basename(cacheKey).toLowerCase();
    return LICENSE_FILENAMES.has(base);
  } catch (_) {
    return false;
  }
}

function getFunnyDetails(languageId, fileName, cacheKey) {
  const effectiveLanguage = isLicenseFile(cacheKey) ? "license" : languageId;
  const verbs = LANG_VERBS[effectiveLanguage] || LANG_VERBS.default;
  if (!verbCache || verbCache.key !== cacheKey) {
    verbCache = { key: cacheKey, verb: pick(verbs) };
  }
  return `${verbCache.verb} ${fileName}`;
}

function getIdleQuip() {
  return pick(IDLE_QUIPS);
}

module.exports = { getFunnyDetails, getIdleQuip };
