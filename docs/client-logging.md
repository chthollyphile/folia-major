# Client logging

Everything the renderer logs is kept in memory for the session and readable from inside the app.
This exists because the packaged desktop build has no console: DevTools only open under
`ELECTRON_DEV`, and the window is frameless, so there is no menu to reach them from. A user's
paste of the log is often the only evidence a bug ever produces.

## Writing a log line

Use `console.log` / `info` / `warn` / `error` / `debug`. Nothing to import, nothing to register.

Start the line with your module in square brackets:

```ts
console.log('[Prefetch] Audio already cached for: Starry Eyes');
console.warn('[KugouProvider] login-status:error', { name, message });
```

That prefix is the whole convention. The buffer reads it once, at write time, and stores it as the
line's `scope`; the log panel groups by it, counts it, and lets a reader mute it. A line without a
prefix still gets recorded — it lands under `(untagged)`.

Rules that make the prefix useful:

- **One word, no spaces.** `[LocalLibrary]`, not `[Local Library]`. The parser stops at the first
  space, so a prefix with one in it is not a prefix.
- **Name the subsystem, not the file.** Readers mute `[Prefetch]`, not `prefetchService.ts:212`.
- **Be consistent.** Two spellings are two modules in the panel, and muting one leaves the other.
- **Only at the start.** `finished [after] a while` is prose and is treated as untagged.

## What to log, and what not to

The panel exists for someone who has just seen something go wrong. Every line that is not
about that is in their way.

- **Log the decision, not the arrival.** "chose X because Y" survives being read a day later;
  "entering function" does not.
- **Log success as well as failure.** A subsystem that prints only when it fails cannot be
  confirmed to be working: silence means both "fine" and "never ran". This is not hypothetical —
  the automix stem gesture ran zero times for its entire life, invisibly, because success printed
  nothing.
- **Once per event, not once per render.** A line printed from a component body or a hot effect
  buries everything around it. Guard it with a `Set` of things already reported if you have to.
- **Numbers, not adjectives.** `14.1s in the model` can be compared against another machine.
  `slow` cannot.

## Reading it

Two doors, one recorder:

- **Settings → 开发者 (Developer)** — the log, plus the switch that stops recording entirely.
- **Alt+Shift+D** on the player page, Console tab — the same panel inside the debug overlay.

The switch governs both. Off means off at both doors: the overlay drops its Console tab entirely
rather than opening on an empty one, and the settings page keeps the panel — directly under the
switch — saying nothing is being kept. Neither door can imply the recorder is running when it is not.

In the panel:

| | |
|---|---|
| Search | Substring match over the whole line. |
| Level / Module | Dropdowns. Each entry carries its share of the log, so you can see what is drowning you. `None` then one module is the fast way to isolate one subsystem. The menu stays open while you pick, because muting is rarely one choice. |
| Selection | Click a line, shift-click for a range, ctrl/cmd-click to add or remove one. |
| Copy | The selection if there is one, otherwise everything currently visible — never the raw buffer. |
| Clear | Empties the buffer, so a problem can be reproduced against a clean log. |

Filter choices persist across sessions. They persist as **what you muted**, so a module added to the
app later shows up on its own rather than being silently filtered out by an old setting.

## The pieces

| File | Role |
|---|---|
| `src/utils/consoleLogBuffer.ts` | Patches `console`, parses the `[Module]` prefix, keeps the last 1000 lines, formats them for the clipboard. Also catches `window` `error` and `unhandledrejection`, which never go through `console`. |
| `src/utils/consoleLogFilters.ts` | Persists muted modules and levels. |
| `src/components/shared/ConsoleLogPanel.tsx` | The panel — list, filters, selection, copy, and the off state. Take this if you need a log surface somewhere else; do not build a second list. |
| `src/components/modal/settings/DeveloperSettingsSubview.tsx` | Settings page host. |
| `src/components/DevDebugOverlay.tsx` | Player overlay host. |

`installConsoleLogCapture()` is called once from `src/index.tsx`, as early as possible — anything
logged before it is not recorded.
