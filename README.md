# Funnycord - Discord RPC

Tell Discord what you're actually doing instead of leaving your status on
"Playing Visual Studio Code" like some kind of animal.

Shows your file, your workspace, your git branch, your problem count, and
a **language icon designed just for this extension** - because the
built-in language icons are fine, but they're not *ours*.

![Discord profile showing the presence in action](https://cdn.abgesetzt.xyz/assets/example.png)

## Features

- **Live file + language icon** - shows what you're editing, with a
  custom icon for each language.
- **Funny Mode** (on by default) - `"Wrestling with app.js"`,
  `"Fighting the compiler over Main.java"`, `"Segfaulting somewhere in
  main.c"`. Turn it off if you're a serious professional. We won't judge.
  Much.
- **Idle detection** - goes quiet (with its own idle quips) after you've
  stopped touching the keyboard, instead of pretending you're still
  furiously coding while you get coffee.
- **"Spectating an unknown file"** - open a `.png`, `.mp3`, `.mp4`, or
  anything else VS Code doesn't have a real language for, and it says so
  honestly instead of just going blank.
- **Keeps your last file on screen** - clicking into the terminal or
  sidebar for two seconds doesn't flip your status back and forth like a
  strobe light.
- **Git branch + workspace name** - so people know it's `main` and not,
  God forbid, `fix-fix-actually-fix-this-one`.
- **Live Problems count** - wear your error count with pride. Or shame.
  Your call.
- **"View Repository" button** - auto-detected from your git remote.
  For GitHub repos specifically, it only appears once we've confirmed the
  repo is actually **public** - it will never accidentally link people to
  a private repo just because you forgot to flip a setting.
- **Secret files stay secret** - `.env`, `*.pem`, `*secret*`,
  `node_modules`, and anything else you list stays completely off your
  status. Not "shown vaguely," not "shown as ???" - just not mentioned.
- **A second custom button** - link your portfolio, your website, your
  Twitch, whatever. Your presence, your billboard.
- **Actually stable elapsed time** - works correctly across multiple VS
  Code windows and Extension Development Hosts running at once, so the
  timer doesn't reset every time you look at it funny.

![Hidden files and folders staying out of your status](https://cdn.abgesetzt.xyz/assets/hidden.png)

## Settings

| Setting | Default | Description |
|---|---|---|
| `discordRpc.enabled` | `true` | Turn presence on/off. |
| `discordRpc.funnyMode` | `true` | Playful status text (`"Wrestling with app.js"`) instead of plain (`"Editing app.js"`). |
| `discordRpc.showFileName` | `true` | Show the current file name. |
| `discordRpc.showWorkspace` | `true` | Show the current folder/workspace name. |
| `discordRpc.showGitBranch` | `true` | Show the current git branch when in a repo. |
| `discordRpc.showProblems` | `true` | Show the current workspace Problems count. |
| `discordRpc.showElapsedTime` | `true` | Show a running timer for the current session. |
| `discordRpc.keepLastFileOnBlur` | `true` | Keep showing your last file when you click into the terminal/sidebar/search, instead of flickering to "Deciding what to open" and back. |
| `discordRpc.idleCheckTimeout` | `300` | Seconds of inactivity before switching to "Idle". |
| `discordRpc.hiddenFilePatterns` | `.env`, `*.env`, `*.key`, `*.pem`, `*secret*` | File names/paths that never show up in your status. Supports `*` wildcards. |
| `discordRpc.hiddenFolderPatterns` | `.git`, `node_modules`, `dist`, `build`, `out` | Folders whose files never show up in your status. Supports `*` wildcards. |
| `discordRpc.showRepoButton` | `true` | "View Repository" button from your git remote. GitHub remotes only show it once confirmed public. |
| `discordRpc.secondButtonLabel` | *(empty)* | Label for an optional second button (e.g. `"My Portfolio"`). |
| `discordRpc.secondButtonUrl` | *(empty)* | URL for the second button. Required if the label is set. |

Click the Discord RPC status bar item any time to manage settings,
disconnect, or reconnect.

## Support

If this saved you from a boring "Playing Visual Studio Code" status,
consider buying me a coffee:

[![Support me on Ko-fi](https://img.shields.io/badge/support-ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/abgesetzt)