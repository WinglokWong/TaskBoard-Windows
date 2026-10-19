# TaskBoard for Windows

A lightweight, offline kanban board inspired by Trello. Single-user, no account, no server: everything stays on your PC.

This is the Windows version of [TaskBoard for macOS](https://github.com/WinglokWong/TaskBoard). The two apps share the same data format, so boards exported on one open on the other.

The interface is available in **English**, **Simplified Chinese** (任务看板) and **Traditional Chinese** (任務看板).

## Features

- **Boards and lists**:
  - Create, rename and delete boards from the sidebar.
  - Add, rename (double-click the title), color, delete and reorder lists.
- **Cards**: title, Markdown description, done state, color, labels, checklist, due date with reminder, and attachments (the first image becomes the cover).
- **Drag and drop**:
  - Drag cards between and within lists, or drag a whole list to reorder.
  - An exact copy follows the pointer, a faded placeholder shows where it will land, and the rest make room.
  - On release, the copy glides into place.
  - The board scrolls automatically near the edges, and Esc cancels.
- **Labels and filters**:
  - Per-board colored labels.
  - Filter by label, status or due date, combined with search.
- **Due Soon**: due cards from every board, grouped as overdue, today, tomorrow, next 7 days and later.
- **Reminders**: Windows notifications at the due time or 15 minutes, 1 hour or 1 day before. TaskBoard keeps running in the notification area when you close the window so reminders arrive on time; you can turn this off in Settings.
- **Undo / redo**:
  - Ctrl+Z and Ctrl+Y (or Ctrl+Shift+Z) work for every board action.
  - Everything you change in one card-editor session undoes as a single step.
- **Archive**:
  - Archive single cards, or all done cards in a list.
  - Done cards can archive themselves 1, 3, 7 or 30 days after completion (board gear menu).
- **Backups**: a backup is taken once a day, keeping the latest 30 (configurable). Restore any backup from the sidebar's ⋯ menu.
- **Import & export**:
  - Export a board, or all data, to a `.taskboard` file that includes attachments.
  - Import with Ctrl+Shift+I, or double-click a `.taskboard` file.
  - Files from the Mac version work too.
- **Keyboard**:
  - Arrow keys move between cards; Enter opens; Space previews attachments; D toggles done; Delete archives; N adds a card; Esc clears the selection.
  - Ctrl+F searches; Ctrl+, opens Settings; Ctrl+/ lists all shortcuts.
- **Automatic updates**: new versions are downloaded in the background from this repository's releases; restart when prompted to install.
- **Windows 11 look**: Mica window material, native menus and dialogs, the system accent color, and light and dark mode that follow Windows.

## Download & install

1. Download `TaskBoard-Setup-x.y.z.exe` from the [latest release](https://github.com/WinglokWong/TaskBoard-Windows/releases/latest).
2. Run it. The installer isn't code-signed, so Windows SmartScreen may show "Windows protected your PC". Click **More info**, then **Run anyway**. You only need to do this once; later versions install through the in-app updater.
3. Choose where to install (per user, no administrator rights needed), and TaskBoard opens when setup finishes.

Requires Windows 10 or 11 (64-bit).

## Data

Everything is stored in `%APPDATA%\TaskBoard\Data`:

| Path | Contents |
| --- | --- |
| `data.json` | Boards, lists and cards (human-readable JSON, the same format as the Mac version) |
| `Attachments\` | Copies of attached files |
| `Backups\` | Daily and manual backups of `data.json` |

Preferences live in `%APPDATA%\TaskBoard\prefs.json`. Uninstalling TaskBoard keeps your data.

Safety measures:

- Saves are atomic (written to a temporary file, then swapped in).
- If `data.json` can't be read, a copy is kept in `Backups\` and you're told where it is.
- Deleted attachments are only cleaned up at a later launch, once nothing (including backups) refers to them, so undo and restore can still find them.
- `.taskboard` files are treated as untrusted: entry paths are checked before anything is read, attachment names must be plain file names, and the data is decoded strictly.

## Moving between Mac and Windows

On the Mac, choose **File → Export All Data…**. On Windows, open the `.taskboard` file and choose **Replace All Data** or **Add as New Boards**. The other direction works the same way. Dates, labels, checklists, reminders and attachments all carry over; this is covered by tests that read files produced by the Mac app's own code.

## Building from source

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev          # run the app with hot reload
npm test             # unit tests, including Mac compatibility
npm run typecheck
npm run check-strings # every interface string has English and Traditional Chinese
npm run dist:win     # build the Windows installer into release/
```

`npm run web` runs the interface in a normal browser with a simulated desktop layer (data in `localStorage`). It's handy for working on the UI from any OS.

The Windows installer can be built on Windows, or by the GitHub Actions workflow.

## Releasing

1. Bump `version` in `package.json`, write the release notes in `release-notes/<version>.md`, and commit.
2. Tag and push:

   ```bash
   git tag v1.0.1 && git push origin main v1.0.1
   ```

The [Build workflow](.github/workflows/build.yml) then does the following on a Windows machine:

1. Type-checks, runs the tests and checks the translations.
2. Packages the app and runs a smoke test of the packaged build: it renders, edits, undoes, saves and reloads, exports and re-imports, and backs up, all in a throwaway data folder.
3. Creates a draft release with the notes from `release-notes/`, uploads the installer, its `.blockmap` and `latest.yml` (which the in-app updater reads), checks that all three are there, and then publishes the release.

## Translations

Interface strings use the Simplified Chinese source text as keys, the same as the Mac version:

- `src/shared/i18n/mac.json` is imported from the Mac app's String Catalog with `node scripts/import-mac-strings.mjs <path to Localizable.xcstrings>`.
- `src/shared/i18n/windows.json` holds Windows-only strings.

## Project structure

```
src/
├── main/                 # Electron main process
│   ├── index.ts          # Window, tray, single instance, IPC, file association, smoke test
│   ├── storage.ts        # data.json, backups, attachment cleanup, preferences
│   ├── attachments.ts    # Attachment import and the tbfile:// protocol
│   ├── archive.ts        # .taskboard export / import (shared format with macOS)
│   ├── reminders.ts      # Due-date notifications
│   └── updater.ts        # Auto-update from GitHub Releases
├── preload/index.ts      # The window.taskboard bridge (no Node.js in the UI)
├── shared/               # Used by both processes
│   ├── model.ts          # Data model, tolerant decoding, filters, auto-archive
│   ├── api.ts            # Typed contract between the processes
│   └── i18n/             # Translations
└── renderer/             # React UI
    ├── store.ts          # Data, undo / redo, saving
    ├── actions.ts        # Shared flows (import, export, menus, confirmations)
    ├── components/       # Board, lists, cards, editor, dialogs
    ├── mockApi.ts        # Simulated desktop layer for `npm run web`
    └── smoke.ts          # Smoke test run in CI
test/                     # Node test runner; fixtures written by the Mac app
```
