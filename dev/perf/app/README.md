# dev/perf/app: the measuring tool for the whole app

It answers four questions with numbers: how long the app takes to start, to change the song, to
switch a page, and how much memory it holds. It measures; it changes no line of `src/` or
`electron/`. The lyric styles and backgrounds one by one are the business of the rig beside it
(`dev/perf/README.md`), whose parts this tool uses: the profiles, the counter sampler, the
outside-load limits, the helper that keeps the screen on, the test song.

Windows only.

## Run it

All commands from the repository root.

```
node dev/perf/app/run.mjs --baseline
```

The whole baseline in one command, about 117 minutes: the four areas under the three profiles, the
check against a known change, then the table. It builds the app first, says how long it will take,
turns the screen on and keeps it on, and **does not start while other programs keep the processors
or the graphics card busy**. It writes `claude-notes/perf/data/app-baseline/` and
`claude-notes/perf/应用底数.md` (in the main checkout, whichever worktree it runs in). While it runs
the results are in `app-baseline.partial/`; a baseline that was there before is renamed
`app-baseline-replaced-<yyyymmdd-hhmm>`. The table is written before the folders are renamed; if
the table itself cannot be written the run says so, the results stay as they are, and the table
can be written later with `report.mjs` (exit code 3).
Windows does not rename a folder while another program has something inside it open (a dev server
that watches the checkout does): the rename is tried for 15 s, and if it still fails the results
stay whole in `app-baseline.partial/`, the run says so in capitals and ends with exit code 3. The
next `--baseline` moves such a folder aside as `app-baseline.partial-finished-not-placed-<stamp>`
(one that was stopped: `-stopped-<stamp>`).

```
node dev/perf/app/run.mjs --plan                      what --baseline runs, and for how long
node dev/perf/app/run.mjs --trial --label <name>      the same on a PC that is in use: nothing is refused, results say what disturbed them
node dev/perf/app/run.mjs --profile laptop --only songs,pages --label after-fix
node dev/perf/app/run.mjs --truth --profile laptop    song changes without and with the main thread held 200 ms
node dev/perf/app/run.mjs --recorder --profile old    what the recorder in the page costs: song changes with its looks and without
node dev/perf/app/report.mjs <results folder> <table.md>   the table again from a folder of results
node dev/perf/app/fixtures.mjs                        the music folders again (they are made when missing)
```

Options: `--only startup,songs,pages,memory`, `--profile host|laptop|old`, `--label <name>` (the
folder under `claude-notes/perf/data/`), `--out <folder>`, `--table <file>`, `--no-build` (use
`dist/` and the prepared profiles as they are; without it every run builds, so the numbers are of
the code in the working tree), `--cold <n>` (3), `--warm <n>` (5), `--rounds <n>` (5 rounds of page
switches), `--launches <n>` (2 launches each of the song series and of the page series), `--memory-series <n>`
(2), `--memory-rounds <n>` (20), `--quick` (fewer of each).

To compare a change: run the same areas with a new `--label` and read `summary.<name>.median` in
the two JSON files. Every summary holds `min` and `max` beside the median: a difference smaller
than that range is not a difference. Every folder holds `_run.json` (start, end, commit, whether
the tree was dirty, the command line, what was measured, failed or disturbed, and `trial: true`
for anything that is not the baseline) and `_setup.json` (the machine, the build, the library).

**What was not measured is said, three times.** A launch, a start-up or a memory series that
fails does not stop the run, and the rest of its kind is still summarised. So that a median from
half the samples is not read as a whole one: `_run.json` lists under `failed` what has no number
at all and under `partial` what was measured only in part, with what is missing (2 of 5 warm
start-ups, 1 of 2 launches, single switches); the table says the same in bold under the section;
and the run ends with **exit code 3** instead of 0. (1: an error ended the run. 2: `--baseline`
did not start on a busy PC. 130: stopped by a signal.) In every summary `runs` is how many values
a number rests on; a cell of the table that rests on fewer than its column or row says so:
`405（400～410）〔2 次〕`.

**A label that is used again** keeps the files of the earlier runs in its folder. Every result
file names the run that wrote it (`run`: that run's `startedAt` in `_run.json`). The table is of
the last run; a section whose file an earlier run wrote is marked as such, with that run's commit.

Stopping a run: Ctrl+C closes the app and the samplers. A runner that is killed outright cannot;
the app, the samplers and the screen helper each look for the runner's process and end by
themselves within a few seconds (seen: nothing was left 7 s after the runner was stopped).

## The files

| file | what it is |
| --- | --- |
| `entry.cjs` | the script Electron is started with: it loads the guard, then `electron/main.cjs` |
| `guard.cjs` | keeps the app inside one folder and off the network, the screen and the speakers; notes what the main process does when |
| `locks.cjs` | the guard's locks on node's own modules (files, child processes, sockets, DNS, UDP, listening): `guard.cjs` puts them on the main thread, `guardWorker.cjs` on every worker thread |
| `guardWorker.cjs` | runs in every worker thread the app starts, before the worker's own script, and puts the locks on that thread's modules |
| `probe.cjs` | the recorder inside the app's page (a preload script of the session) |
| `fixtures.mjs` | makes the music folders the app imports |
| `launch.mjs` | builds the app, starts it, attaches to its page over the DevTools protocol |
| `drive.mjs` | what a person does: clicks, keys, the first run, the import |
| `measure.mjs` | the four areas |
| `run.mjs`, `report.mjs` | the runner and the table writer |

**What stays on disk.** Everything a run writes is under `dev/perf/.build/app/` of the worktree
it runs in (not in git), except the build, which goes to the repository's own `dist/` (15 MB, also
not in git: a build the developer had there is replaced, labelled commit `0000000`):

- `library/`, 248 MB: the music. Made once and kept; it is the same every time.
- `profiles/template-songs` and `profiles/template-large`, 9 MB and 12 MB: the prepared profiles.
  Kept, and made again when the build or the music changes.
- `profiles/run-<profile>-<area>`, 9 to 13 MB each, 12 of them after a baseline: the copy each
  measured launch started from. They stay until the next run, which removes at its start
  everything under `profiles/` but the two prepared profiles.

So a worktree that has run the tool holds about 400 MB. Deleting `dev/perf/.build/app/` gives it
all back; the next run makes the library and the profiles again (the two profiles took 47 and
38 s here; how long the library takes was not timed).

## The app that is measured

**The real one.** `launch.mjs` builds the app as `npm run dev:electron:dist` does (`vite build`
with `ELECTRON=true`) into `dist/`, and starts the project's Electron with `entry.cjs`, which sets
the app's name, version and folder as `electron .` would, puts the guard in place and then
requires `electron/main.cjs`. Main.cjs loads `dist/index.html` by itself. It is production React,
minified, as shipped. (During the build `VERCEL_GIT_COMMIT_SHA=0000000` makes `vite.config.ts`
skip its look-up of a commit name on the network; the only trace is the commit label in the app's
About page.) The app's own preload script, IPC, tray code, API servers and stores all run.

**What is different from a user's app**, all of it on purpose:

- It starts with `--lang=en-US`, so the buttons the runner looks for have the same names on every PC.
- The window is 1920x1080 at device scale 1 (forced, so a viewport means the same pixels on any
  screen), shown without focus at x = y = -20000, with no taskbar button, muted. The page is told
  it has the focus (`Emulation.setFocusEmulationEnabled`). `CalculateNativeWinOcclusion` and
  `HardwareMediaKeyHandling` are switched off.
- It is unpackaged: the auto-updater never runs, and `main.cjs` is read from a folder, not from an
  archive.
- It has no network (see the guard). Its settings are a new user's: the default lyric style and
  background, mods off, no account.
- `probe.cjs` runs in the page (in Electron's isolated world): a few observers, and during a
  measured action one callback per frame. What that costs is measured: "What the recorder costs".
- A DevTools port is open on 127.0.0.1 and the runner is attached to it.

**The guard.** `electron/main.cjs` never sets the user-data folder, so started plainly it would
open the developer's real profile. The guard is loaded first and:

| what the app would touch | what happens here |
| --- | --- |
| user data (`%APPDATA%\Folia`: settings, IndexedDB library, caches) | `userData`, `sessionData`, `temp`, `home`, `appData`, `documents`, `music`, `videos`, `downloads`, `desktop`, `pictures`, `logs`, `crashDumps` all point into the run's own folder, set before anything reads them; the process ends at once if `userData` is anywhere else (checked at load and at `ready`) |
| the single-instance lock | Electron keys it to the user-data folder, so it does not meet a real Folia that is running (inferred from that; two real instances side by side were not tried) |
| files anywhere else (node's `fs`) | a write, delete, rename or create outside the run's folder is refused with `EPERM` and reported. One is refused at every start: `mkdir logs` beside `electron.exe` (the crash log's first choice); it then uses `userData/logs` |
| `%TEMP%` (`anonymous_token`, `xeapi_public_key` of the Netease module) | `TEMP`/`TMP` point into the run's folder |
| the network, main process (Netease, QQ, KuGou, YouTube Music, Spotify, update check) | node's sockets, DNS look-ups, named pipes and UDP sends are refused unless they go to this machine; each refused host is reported |
| the network, Chromium (page requests, `net.fetch`, every session partition) | `webRequest.onBeforeRequest` on every session cancels http, https, ws and ftp beyond this machine; `host-resolver-rules` makes every other name unresolvable as a second lock |
| servers the app starts (Netease API and QQ API on a free port; stage, OBS and lyric servers when switched on) | they listen on 127.0.0.1 only (the QQ server asks for every address of the PC); with a new user's settings only the QQ server starts, and the Netease one never gets that far without the network |
| the Discord client (a named pipe) | off by default; a connection to any pipe is refused anyway |
| child processes (wallpaper helper, windowtolayer, ffmpeg, `reg.exe`; and through Electron's `utilityProcess` the analysis worker of automix, which starts the Python sidecar) | `child_process` starts nothing and `utilityProcess.fork` starts nothing; each reports what was asked for and hands back a child that ends at once. Nothing asks at start with a new user's settings |
| worker threads (the app loads and runs its Netease API in one: `electron/netease/neteaseApiWorker.cjs`) | a worker thread has its own copies of node's modules, so the locks on the main thread's do not hold in it. Every `Worker` the app makes is started with `guardWorker.cjs` in front of its own script (`execArgv: --require`), which puts the same locks on that thread: files, child processes, sockets, DNS, UDP, listening. Its notes carry `thread` |
| the tray icon | a stand-in object; no icon |
| dialogs, notifications, `shell.openExternal`/`openPath`/`trashItem`, global shortcuts | stand-ins that report and do nothing; a dialog answers "cancelled" |
| windows | every `BrowserWindow` is created hidden, moved off-screen, shown without focus, not focusable, without a taskbar button, muted; `focus`, `show`, `maximize`, `setPosition`, `setBounds`, `setFullScreen`, `setAlwaysOnTop`, `setSkipTaskbar`, `hide` and the like do nothing |
| a window a page opens by itself (`window.open`) | refused for every page (`setWindowOpenHandler`) and reported: Electron would build that window itself and show it before the guard could move it. The desktop app's own code opens none |
| the system's file and folder pickers (`showDirectoryPicker`, `showOpenFilePicker`, `showSaveFilePicker`: Chromium's own dialogs, not Electron's `dialog`) | in every page they answer as a dialog that was closed (`AbortError`), put there by the recorder's preload script; the import (below) puts its one answer in front of that |
| a proxy (`HTTP_PROXY` and the like in the shell; the system's proxy) | the shell's proxy variables are not handed to the app, and Chromium starts with `no-proxy-server`. A session the app itself points at the system's proxy keeps it; its requests are cancelled by the request lock above all the same |
| media keys and Windows' media overlay | `HardwareMediaKeyHandling` is off (whether the overlay then lists the app was not confirmed) |
| `app.relaunch`, login items, protocol and file-type registration, jump lists | replaced by stand-ins (main.cjs registers none of them on Windows today) |
| the screen staying on while a song plays (`powerSaveBlocker`) | left as it is: it ends with the process |
| the registry | nothing in `electron/` writes it; what Chromium itself may write was not looked at |

The app quits by itself when the runner that started it is gone (`PERF_RUNNER_PID`).

What the guard does not cover: reading (the app can read any file of the PC; only writes are held
to the run's folder); what Chromium itself writes to the registry; and a client in the main
process that is told in code, not by the shell's variables, to go through a proxy on 127.0.0.1:
an address of this machine is let through whatever listens there (no such client exists today).

**One measuring run at a time.** Every way of running that starts the app first takes the lock of
`dev/perf/lock.mjs`: one file in the system's temp folder, the same for every worktree (and for
the other measuring tools under `dev/perf`, once they call it). While another run holds it, this one says whose run it
waits for and since when, and starts when that one has ended; the lock of a run that was killed is
taken over. So two runs never share the processors, and never the profile folders or `dist/` of
one worktree.

**The library.** `fixtures.mjs` computes two folders from the rig's test song; no real music.
`Perf Library`: 6 albums of 4 songs, each a 96 s WAV whose tag (ID3v2.4) holds title, artist,
album, track number and a cover of its own, with word-timed lyrics (`.lrc`) and a translation
(`.t.lrc`) beside it. `Perf Sketches`: 30 albums of 10 tracks of 2 s. Every song's lyrics start
with one word of its own at 0.2 s.

The library gets into the app **through the app's own Import Folder button**. One step is
replaced: the system's folder dialog cannot be answered from outside without appearing on the
desktop, so the folder is dropped on the page instead (a real drop of a real path, through the
DevTools protocol), which hands the page the same kind of handle the dialog would, and
`showDirectoryPicker` answers with that handle once. The scan, the metadata reader, the covers
and the stored library are the app's.

**The prepared profiles.** `template-songs`: a first launch gone through as a person would (the
release notes closed, the choice of the view Play opens left at its default, the Ponder
introduction opened and left), the 24 songs imported, the app closed and started twice more.
`template-large`: the same with the 300 short tracks imported as well. Every measured launch
starts from a fresh copy of one of them. They are made again when the app is rebuilt or the music
files change.

**Driving.** Real mouse clicks and key presses through the DevTools protocol
(`Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`), at the place an element is drawn, once it
has stopped moving and nothing lies over it. Nothing calls into the app's code.

## The profiles

The rig's (`dev/perf/README.md`, "The profiles"): `host` without limits, `laptop` every process of
the app held to 4 slow cores, `old` to 2. The app is started through `start /affinity`; every
process is asked of Windows after the launch and again at the end, and one off the mask fails the
measurement.

## What is measured

Every number is taken several times. A summary gives the median, the lowest and the highest, and
how many runs it rests on. The song series and the page series are taken in two launches of the
app each; `launchMedians` holds each launch's own median, because two launches of the same code
differ by more than the runs inside one launch do (seen under `laptop`: first sound 228 ms in one
launch and 141 ms in the next), and a comparison of two versions is a comparison of launches.
What a launch has one value of (the idle frame rate, the app's share of the graphics card, what
the guard noted, whether the processors were looked at once more at the end) is in `ofEachLaunch`,
one entry per launch; the same names at the top of the file are the first launch's.

### Start-up (`startup.json`)

The clock starts at **the creation of the app's process, as Windows dates it**
(`process.getCreationTime()`). Each milestone is the time from there:

| name | the clock stops when | read by |
| --- | --- | --- |
| `entryScript` | Electron has started and runs the first line of the entry script | the guard (`Date.now()`) |
| `mainScriptEvaluated` | `electron/main.cjs` has been evaluated to its last line, with everything it requires | the guard |
| `appReady` | Electron's `ready` event: "main process ready" | the guard |
| `windowCreated` | main.cjs has constructed the app's window | the guard |
| `navigationStart` | the page starts to load (`performance.timeOrigin`) | the probe |
| `firstPaint` | the window has something in it for the first time: the splash screen's background | the browser's `paint` entry |
| `firstScreen` | **the app's first screen**: React has put its first render into `#root` | a MutationObserver in the probe |
| `firstContentfulPaint` | the first frame with text or a picture in it | the browser's `paint` entry |
| `splashGone` | the splash screen is removed from the page (it fades for 320 ms after the first screen) | the probe |
| `picturesIn` | the last of the pictures that are inside the window has finished loading (pictures elsewhere in the page are not asked) | `load` events, in the probe |
| `homeUsable` | **the first page can be used**: the window holds at least as many pictures as the first page of this profile shows when it is whole, every one of them has loaded, and there has been no main-thread task over 50 ms for one second; the time given is the later of the last picture and the end of the last such task, not the end of the quiet second | the probe |

How many pictures the first page shows when it is whole is counted when the profile is prepared
(`homePictures` in its `template.json`: 3 for the 24 songs) and handed to the recorder of every
measured launch. Without it a library whose covers arrive late, with the main thread quiet
meanwhile, would be called usable with none of them. A launch that never shows that many fails
after three minutes and says how many it saw. `where.picturesShown` and `where.picturesWanted`
are in every run.

`where` holds the lengths of the stretches between them, and: `mainScript` (the evaluation of
main.cjs alone, with its slowest `require` calls in `detail.slowestRequires`), the long tasks
before and after the first screen, the longest task, how long the main process took to answer
`folia-mods:list` (the IPC call `bootFolium()` waits for) and when the answer came, how many IPC
calls the main process handled before the first screen and their time, how many script files the
page had loaded and their size (`detail.scripts` names them), and how many service workers are
registered.

`cold` and `warm` are two kinds of launch. `warm`: the profile as an earlier launch left it,
which is every launch but the first. `cold`: the same profile with the graphics caches (`GPUCache`
and the Dawn and shader folders: compiled shaders, about 7 MB) and the cache of responses (`Cache`,
under 1 MB) removed. **It is not the first launch after an update:** the scripts are compiled
again in a warm launch just as in a cold one. The app's page is loaded from `file://`, for which
Chromium keeps no compiled scripts; `Code Cache` is removed too, but it holds four index files of
24 and 48 bytes after any number of launches. So cold less warm is what the graphics caches save
and nothing else. What the packaged app keeps between launches was not looked at. The Windows
file cache is warm in both (the files were just built); a launch after a reboot is not measured.

During a start-up measurement the page is only attached to and asked twice a second whether it is
done; no DevTools domain is switched on in it.

### A change of song (`songs.json`)

The clock starts at **the input event's own time stamp**: the `keydown` of Ctrl+Right or
Ctrl+Left (the app's keys for next and previous), or the `click` on a Play button. Each number
is the first animation frame, from then on, in which something holds; the recorder looks once
per frame, so each is exact to one frame of the screen. A frame's time is the moment it began. So
a time of 0, or a fraction of a millisecond under 0, means: it held in the very frame in which the
input arrived (seen for closing Settings: -0.2 ms).

| name | the clock stops when |
| --- | --- |
| `titleMs` | the new song's title is in the card on the player page that names the playing song |
| `soundMs` | **first sound**: an `<audio>` element has been given a source since the input, has fired `playing`, and its clock is past zero. The window is muted; what the sound card adds after this is not measured |
| `lyricMs` | the new song's first word is on screen in the lyric view. That word is due 0.2 s into the song |
| `lyricLateMs` | how late that word was, **by the song's own clock**: where the playing `<audio>` element's `currentTime` stood in the frame the word was first on screen, less the 200 ms it is due at. Not `lyricMs` less `soundMs`: when the page first sees that the song plays, the song is already some way in (the sound starts off the main thread), and that way would be taken for punctuality |
| `coverMs` | the song card's picture is a picture that was not in the page before the input, and has loaded |

The title, the word and the cover count from the frame in which they are there **and the Home
surface is out of the way**: its layer has faded below one half (what "first frame" of the switch
from Home to the player page means too), or is hidden or gone. The player page lies under the Home
surface in the same document, so on the kinds that start from an album's page these three are in
the page well before anyone can see them (seen under `laptop`: the title 200 ms after the click,
the Home layer below one half at 394 ms). On the player page the condition holds from the first
frame.

| name | the clock stops when |
| --- | --- |
| `sourceSetMs`, `canPlayMs`, `playCalledMs`, `playingEventMs` | the audio element's own events `loadstart`, `canplay`, `play`, `playing`: the way to the first sound in steps. `sourceToPlayCalledMs` is how long the app took to call `play()` after it gave the element its source; `playCalledToCanPlayMs` is above zero when the app had called `play()` before the element could play |
| `longestTaskMs` | the longest main-thread task or animation frame from the input on, as the browser reports them (it reports none under 50 ms: 0 then) |
| `frames` | the gaps between animation frames from the input until 0.5 s after the last of the above: the 95th percentile, the worst, and how many were over twice the screen's frame time |
| `inputDelayMs` | from the input to the start of its handler (the browser's event timing). The browser reports an event only when 16 ms or more passed until its next paint: for a quicker one the number is missing, so its summary is of the slower events only (`runs` says how many) |

Four kinds, all local song to local song: `nextOnPlayer` (on the player page, next three times
and previous three times), `nextOnHome` (with an album's page of the Home surface in front; the
app goes to the player page by itself when the song changes), `playFromHome` (a click on Play on
an album's page, five albums one after the other; the app goes to the player page) and
`firstPlay` (the first Play of the launch, kept apart: it also builds the audio graph).

### A switch of page (`pages.json`)

The clock starts at the input event's time stamp. Ten switches, five rounds, a song playing:

| name | the clock stops when |
| --- | --- |
| `firstFrameMs` | the first frame of the new view. Going to a page: its element is in the page and not hidden (for the player page: the Home layer's opacity is under 0.5). Going back to a page that is underneath (closing Settings or search, leaving an album's page or the wall): the frame in which the page in front starts to move or fade; `goneMs` is when it is gone altogether |
| `contentMs` | what the new view needs has arrived as well, where that is more than its first frame: every picture inside the window loaded (Home, an album's page), the local result listed (search), the wall's controls there |
| `settledMs` | the last change of place, size, opacity, visibility or transform of the element that is followed (the new page, or the page that leaves) in the whole recording, which is 2.5 s or longer. It is not "the first time the element rested for 200 ms": an element that rests and then moves again settles at its last move. A run in which the element still changed in the last 200 ms of the recording has no settled time; the table then says on how many runs the cell rests |
| `longestTaskMs`, `frames`, `inputDelayMs` | as for a song change; the frame gaps are counted from the input to the last change that was seen of the followed element (or to the first frame or the content, when that is later) |

A switch that leaves a page (closing Settings or search, leaving an album's page or the wall) is
only measured when that page is in front. After an opening switch that failed it is not, and the
closing one is then counted as failed too: the recorder would otherwise write down "gone" in the
first frame after the key (seen: 5 ms).

The switches: Home to the player page (Back to Player) and back (Escape); Settings open (Options)
and shut (Escape); search (Enter in the search box, with "Lantern" typed) and its page shut
(Escape); Home to an album's page (a click on its card) and back (Back); Home to the wall (Queue
collage) and back (Back). A switch is kept away from the end of the playing song.

### Memory (`memory.json`)

One series is one launch of its own, from the profile with 324 tracks. Five fixed points:

1. after start-up and 30 s idle;
2. after 60 s of playing on the player page;
3. after 20 song changes;
4. after 20 rounds of page switches (a round: to the player page and back, Settings open and
   shut, an album's page and back);
5. back on Home, the music paused (read from the page: a series whose music did not stop says so
   under `failures`), 20 s idle, after a forced collection.

**What a forced collection is here:** `HeapProfiler.collectGarbage`, twice, on the page. It
collects the JS heap of the page's main thread and nothing else: not workers or worklets, not the
main process, not the graphics process, and private bytes do not fall at once when a heap is
collected. Points 3 and 4 are read right after the last reading for the slopes, which collects;
point 5 after a collection of its own; points 1 and 2 after none. So the page's JS heap, DOM nodes
and listeners at points 3, 4 and 5 are what is still held, and at 1 and 2 they include garbage;
the process and video-memory numbers include what other processes have not given back at every
point.

At each: for every process of the app its working set and private bytes (asked of Windows:
`win.ps1 -Action memory`), summed as `renderer` (the page), `gpuProcess`, `browser` (the main
process), `other` and `total`; the dedicated and shared video memory (Windows' `GPU Process
Memory` counters); and for the page the JS heap in use and reserved, DOM nodes, event listeners
(DevTools' `Performance.getMetrics`).

**Growth per round.** After every song change and every page round the page's heap is read, a
collection is forced (`HeapProfiler.collectGarbage`, twice) and heap, nodes and listeners are
read again; every fifth round the processes too. `growthPerSongChange` and `growthPerPageRound`
are the slopes of the straight lines through those readings: what one more round leaves held.
Only the heap, the nodes and the listeners are "after collection" in the sense above; the slopes
of the process numbers and of the video memory are of numbers that still hold other processes'
garbage.

The song changes go round the four songs of one album (next three times, back three times), so
what the app keeps per song stops growing after the first changes, and the first rounds of
anything fill caches. Over the whole series that reads as growth: readings that rise by 2 for four
rounds and are flat for sixteen give a slope of 0.234. `growthPerSongChangeLate` and
`growthPerPageRoundLate` are the slopes over the second half of the rounds only (that example:
0.000; a leak of 0.25 a round: 0.250 in both). **A leak is a late slope that stays above zero.**
Growth per song that only shows with songs not played before is not measured.

A video-memory number is missing (not 0) when Windows' counters gave nothing at that reading.

## Other programs

As in the rig: a counter sampler reads what programs that are not the app do, and a result whose
stretch broke one of the rig's limits (`OUTSIDE_LOAD` in `dev/perf/scenarios.mjs`) carries
`disturbedBy`. For a start-up, the two seconds before the launch are judged; for the other areas,
the whole series of a launch. The sampler that judges the start-ups reads the whole machine and
is started anew before each series of start-ups: a sampler does not see the graphics-card use of
a program that was started after it. A program that starts in the middle of a series (up to three
minutes long) is seen on the processors at once, on the graphics card from the next series on. `--baseline` does not start on a busy PC. Nothing is thrown away
and repeated, as the rig does with a window: a series is minutes long.

## No network: which numbers are lower bounds

A refused request fails at once; a real one takes time. So:

- **Start-up.** `startNeteaseApi()` is not awaited and fails at once here (it fetches a key and a
  token first); the Netease API server never listens. The page's account checks (KuGou, Netease)
  fail at once. Everything from `appReady` on has these on its path: lower bounds.
  The Netease package itself is loaded in a worker thread while the main process starts. That
  load is not in `mainScript` and holds no milestone up by itself, but it takes one of the
  profile's processors for as long as it lasts; the main process's log says when it was over
  (`[Netease API] package loaded in the worker thread in … ms`, in `detail.mainLog`).
- **A change of song.** No request is refused on the measured path: the songs have lyrics and
  covers of their own, so the app looks for no match online. A song without them would.
- **A switch of page.** Search asks the online provider, which is not reachable: the search row is
  the local result only. The other switches make no request.
- **Memory.** Nothing online is held: no online covers, no explore feed.

## The check against a known change

`--truth` measures the same song changes twice: as they are, and with the main thread held for
200 ms right after the input (a capture listener put into the page from outside, which spins
before the app's own handler runs). Every time from the input must rise by 200 ms. Seen under
`laptop` (two launches, so their own difference is in it): first sound +212 ms, title +217, first
word +212, cover +209, longest task 205 ms; under `host`: title +203, first word +202, cover +204,
source set +200, first sound +187 ms.

## What the recorder costs

The recorder (`probe.cjs`) runs on the page's main thread, inside every time it measures. It
times its own work, and that is in the results:

- **Start-up:** `where.recorderMs`, everything it did from the page's start until the first page
  was usable (its watch of the document, its look at the pictures ten times a second, its answers
  to the runner). Seen under `laptop`: 1.8 and 4.3 ms, of about 1200 ms the page took. The runner
  asks twice a second with a short question and reads the recorder's lists once, afterwards.
- **A song change, a page switch:** `recorder` in every run. `perFrameWaitingMs` is what one look
  at the page took while something that was watched for had not held yet, `whileWaitingMs` those
  looks in all, `perFrameAfterMs` a look once everything has held, `worstFrameMs` the longest.
  Seen for a song change on the player page: 1.1 ms a frame under `old` and 1.2 under `laptop`;
  53 and 40 ms in all per change, of the 400 to 600 ms until the first word; 0.01 ms a frame
  afterwards. A look reads boxes and computed styles, which makes the browser work out style and
  layout at that moment; how much of a look is work the frame would have done anyway was not
  told apart.

```
node dev/perf/app/run.mjs --recorder --profile old
```

measures what the looks do to the app: 24 song changes on the player page in one launch, by
turns with the whole recorder and bare (no look and no frame asked for, only the listeners that
are always on). The audio element's own events and the browser's long tasks need no look, so
both kinds of turn have them (`recorder.json`; with other results in the folder the table shows
it). Seen, two runs under each profile, the `playing` event with the looks against without
(medians of 12 changes each): `old` 311 against 345 ms, then 332 against 301; `laptop` 175 against
189, then 183 against 201. Under `old` the sign changes from one run to the next, and single
changes lie 150 ms and more apart. So **the looks do not move the audio events by anything that
can be told from the spread**: about 35 ms under `old`, 20 under `laptop`. Whatever they cost is
the same in a run before a change and a run after it, so a comparison of two versions does not
carry it; an absolute time does.

Not measured: a page switch with and without the looks (all its numbers need them), and what the
DevTools connection itself costs.

## What cannot be measured from outside

Nothing was added to the app. These would each need a `performance.mark` in it:

- how long `bootFolium()` and `initializeLocalCoverRuntime()` take on their own
  (`src/bootstrap.tsx:69-73` and `:76-78`; from outside only the IPC call inside the first is seen);
- when the lyric-loading flag is set and cleared around a song change
  (`src/components/app/playback/start/useLibraryPlaybackController.ts:628` and `:659`), and how long
  the match step and the second lyric parse between them take (`:651` and `:655`); from outside
  only "source given" and "`play()` called" are seen;
- when the lyrics reach the store (`useLibraryPlaybackController.ts:611`), as opposed to when a
  style draws them;
- the first lyric line in the styles that draw on a canvas (Pixi, three.js): the recorder finds
  words in the page's elements, which only the DOM styles have.

## What is not measured

- The sound card and the screen: "first sound" ends at the audio element, "first frame" at the
  page's frame.
- Online songs, automix, a change of song by a song ending.
- Compressed formats: the songs are WAV, which needs no decoding.
- Other lyric styles and backgrounds than the defaults (the rig beside this measures those).
- A launch after a reboot, and the very first launch of a new user.
- A 60 Hz screen: frame gaps are counted against the refresh rate of the screen the run is on.
