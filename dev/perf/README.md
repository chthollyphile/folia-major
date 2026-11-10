# dev/perf: the measuring rig for lyric styles and backgrounds

It answers one question with numbers: what does each lyric style and each background cost per
frame, before and after a change. It measures; it changes no visual code.

Windows only (processor affinity, Windows' GPU counters, the project's `electron.exe`) — **except
the measuring runner itself, which also runs on macOS**; see "macOS" below. The whole-app tool in
`dev/perf/app/` stays Windows only.

**The whole app** (how long it takes to start, to change the song, to switch a page, and how much
memory it holds) is measured by a second tool, in `dev/perf/app/`, with a README of its own
(`dev/perf/app/README.md`). It starts the real app (`electron/main.cjs` and a production build)
behind a guard that keeps it away from the developer's data, the network and the desktop, and it
uses this rig's profiles, sampler and test song. One command takes its baseline:
`node dev/perf/app/run.mjs --baseline`.

## Run it

All commands from the repository root. `npx` is not needed; everything is `node <file>`.

```
node dev/perf/run.mjs --baseline
```

The whole baseline in one command, about 83 minutes: every scenario under the `laptop` and the
`old` profile, the core set under `host`, the ten heaviest on the graphics card again at
2560x1440 scale 1.5, the noise check, the truth check, then the table. It prints the duration
before it starts and **does not start while other programs keep the processors or the graphics
card busy** (a game, a test run). **It turns the screen on if it is off and keeps it on until
it ends**, and it does not start either while the window still does not run at the screen's
refresh rate (see "The screen has to be on" below). It writes
`claude-notes/perf/data/baseline/` and `claude-notes/perf/画面底数.md` (in the main checkout,
whichever worktree it runs in). With `--allow-disturbed` it runs anyway, marks every result, and
writes to `data/baseline-disturbed/` and `画面底数-baseline-disturbed.md` instead.

While it runs the results are in `data/baseline.partial/`. The folder gets the name `baseline`
only when everything has finished; a `baseline` that was there before is first renamed to
`baseline-replaced-<yyyymmdd-hhmm>`, and a `baseline.partial` an earlier run left unfinished to
`baseline.partial-stopped-<yyyymmdd-hhmm>`. Two runs are never mixed in one baseline folder, and a
folder named `baseline` is always a whole one.

```
node dev/perf/run.mjs --plan                         what --baseline would run, and for how long
node dev/perf/run.mjs --profile laptop --only style-lumiere,style-diorama --label after-fix
node dev/perf/run.mjs --profile old --set core --label after-fix
node dev/perf/run.mjs --profile laptop --viewport 2560x1440@1.5 --only style-diorama
node dev/perf/run.mjs --noise                        two scenarios, five runs each: the run-to-run spread
node dev/perf/run.mjs --truth                        one scenario without and with 4 ms added per frame
node dev/perf/report.mjs <results folder> <table.md> the table again from a folder of results
node dev/perf/song.mjs                               the test song again (it is made when missing)
```

**One measuring run at a time.** `run.mjs` (every way of running it except `--plan`), `shots.mjs
capture` and the whole-app tool (`dev/perf/app/run.mjs`) take the same lock before they start
anything (`dev/perf/lock.mjs`: one file in the system's temp folder, the same for every worktree).
A second run says whose run it is waiting for and starts when that one has ended; a lock left by a
run that was killed is taken over. `shots.mjs compare` and `floor` start no engine and take no lock.

Options: `--label <name>` (the folder under `claude-notes/perf/data/`), `--out <folder>`,
`--windows <n>` (3), `--check` (empty-page frame rate, GPU reading and the benchmark first),
`--no-build` (use the page built before; without it every run rebuilds, so the numbers are of the
code in the working tree), `--allow-disturbed`.

To compare a change: run the same scenarios with a new `--label`, then read
`summary.<name>.median` in the two JSON files. A difference smaller than the spread in
`noise.json` is not a difference. Every scenario is measured in a launch of the engine of its
own, in the baseline as in a run of one scenario, so where a scenario stood in a run does not
matter (before, memory read 6% to 34% higher for a scenario late in a long run).

Every folder of results holds `_run.json`: for each run that wrote into it the start and the end,
the git commit and whether the working tree differed from it, the command line, the passes that
finished, and how many scenarios were measured, failed or were disturbed. Every result file
carries the commit too. `report.mjs` says at the top of its table when `_run.json` is missing,
when a run in it did not finish, and which commit was measured.

**Stopping a run.** Ctrl+C (also Ctrl+Break, and a kill that asks first) closes the engine and
the sampler and marks the run as stopped in `_run.json`. A runner that is killed outright cannot
do that: the shell, the sampler and the helper that keeps the screen on each look for the
runner's process and end by themselves within a few seconds of its going. At its start the
runner also stops any `electron.exe` whose command line names this checkout's
`dev\perf\shell.cjs`, and says so. That includes the engine of a `shots.mjs` capture still
running from the same checkout: do not run the two at once.

### Looks the same

```
node dev/perf/shots.mjs capture <folder>             every scenario by its plan (about 5 minutes)
node dev/perf/shots.mjs capture <folder> --only style-classic,songchange-lumiere
node dev/perf/shots.mjs floor <capture> <capture> <capture> <capture> <capture> --out <floor.json>
node dev/perf/shots.mjs compare <folder A> <folder B> --floor <floor.json> [--out <result.json>] [--only <names>]
node dev/perf/shots.mjs list                         what is captured, and under which names
```

To check that a change left the looks alone: capture the changed code into a new folder, then

```
node dev/perf/shots.mjs compare claude-notes/perf/shots/before <new folder> --floor claude-notes/perf/shots/floor.json
```

It ends with code 0 when no picture is CHANGED, and with 1 when one is, when a picture is in one
folder only, or when the folders share none. Without `--floor` there is no verdict, and it ends
with 1 when any picture differs at all. It does not compare, and ends with 1, when the floor file
is not one that `floor` wrote (no `pictures` in it, or not the numbers this version compares by)
or when the manifest of a folder says that its capture did not get to its end.
`claude-notes/perf/shots/before/` holds the pictures
of the unchanged code and `floor.json` beside it what those pictures differ by between two
captures of the same code. Both are of one commit (`before/manifest.json` names it): after a
change that is meant to alter the looks, take them again.

**capture** writes `<scenario>@<moment>.png` and `manifest.json`. A scenario is not stored, its
old pictures are removed, the failure is written into the manifest and the command ends with
code 1 when:

- the page logged an exception or a console error, at any time (a style that throws in its frame
  callback fails here);
- the page holds another style or background than the scenario's, or the style has drawn nothing
  into the stage after its first second and a half;
- a picture is one flat colour, or not the size of the page;
- a load the page waits for does not end in 20 s.

It prints a warning when two scenarios give the very same picture, byte for byte, at the same
moment: look whether each shows its own style there. `--lanes <n>` sets how many engines work at
once (3; the large pictures have one more).

`--no-build` pictures the page as it was built the last time, whatever the checkout holds by now.
Every build writes the commit it was made from beside the page, the manifest holds it
(`builtFrom`, `buildSkipped`), and `capture` and later `compare` print a WARNING when a page that
was not built for the capture is of another commit than the checkout, or when either had changes
that were not committed. `--inject-css <css>` adds a style sheet to the page after the style's
first second and a half (the start-up runs without it): a way to plant a change and see that it is
reported. The manifest holds the CSS, and `compare` prints a WARNING for such a folder.

From its first scenario until its last one is done the manifest of the folder says `unfinished`.
A capture that is killed leaves it so, with the pictures of an earlier capture into the same
folder beside its own: `compare` and `floor` refuse such a folder. The mark goes when a later
capture into the folder has taken every scenario that has pictures in it.

**floor** takes captures of the same code (five is the rule) and keeps, for every picture and
each of the five numbers below, the largest value over all pairs of captures (`measured` in the
file). The floor a picture is then held to is the largest of those over all pictures of its
scenario, its song change and its large pictures among them (`pictures` in the file): what is
left unequal falls on any picture of a scenario, and five captures show it on some of them and
not on others. The pictures of the two scenarios with a grain pass (Tempera, and Sonnet with
post-processing; their song change and large pictures among them) are held to a set floor at
least, whatever the captures show: see "Grain" under "What stays unequal". It refuses captures
that do not hold the same pictures or that have a failed scenario, and warns when a scenario did
not take the same steps in every capture.

**compare** prints every picture that differs at all, with five numbers and the rectangle that
holds the differing pixels (`--all` prints the identical ones too; `--out` writes everything as
JSON, never into one of the two folders; `--only` compares just the named scenarios, for a
capture that took only those. Naming a scenario with grain to `--only`, here or in `capture`,
takes its twin without grain along; `compare` ends with an error when neither folder holds a
picture of a name it was given):

- worst pixel: the largest difference of one colour channel, 0 to 255, that more than 0.002% of
  the pixels reach (41 pixels at 1920x1080, 167 in the large pictures). What fewer pixels than that do is printed beside it
  (`a few pixels up to 18`) and never marks a picture by this number: see "What stays unequal" below;
- differing: the share of pixels that differ at all;
- over 8 levels: the share that differ by more than 8;
- mean: the mean difference of a colour channel over the whole picture;
- block shift: the picture is cut into blocks of 64x64 pixels; in each block and colour channel
  the differences are added up with their sign (brighter in A counts against darker in A) and
  divided by the 4096 pixels of a block; the number is the largest of these, in levels. A change
  of 2 levels over an area moves every block it covers by 2. Grain that comes out as another
  field is brighter on one pixel and darker on the next and moves a block by very little, so this
  is the number that sees a faint change in a picture with grain. The picture is cut twice, the
  second time half a block further right and down, and the larger result counts: a small bright
  dot on the corner of four blocks of one cut lies inside a block of the other.

A picture is CHANGED when one of the five is above its floor by more than its margin, and the
line then says which, by how much, and what the floor was:

| number | may be above the floor by |
| --- | --- |
| worst pixel | 2 levels where the floor is 8 or less, 16 above that |
| differing | half the floor again, plus 0.5% of the picture |
| over 8 levels | half the floor again, plus 0.1% of the picture |
| mean | half the floor again, plus 0.1 of a level |
| block shift | half the floor again, plus 0.25 of a level |

So on a picture that is the same in every capture, one level of brightness over 0.5% of the
picture is marked, and so is a difference of 3 levels on more than 41 pixels, and one level over
more than a quarter of a block (1024 pixels that lie in one block; 6 pixels where they differ by
200 levels). What the block shift does not see: something that only moves inside a block (a
stroke that moves by a pixel is brighter here by what it is darker there). A picture with no
entry in the floor file is held to a floor of 0. Without `--floor` there is no verdict.

Before its last line compare prints a WARNING for what the two manifests and the floor file say
against taking the pictures at their word: a folder without a manifest, a capture with failed
scenarios, with `--inject-css` or with a page that was not built from its commit (`--no-build`),
two captures of different engines, and a floor that was built from another state of the code than
folder A is of. A warning does not change the exit code.

## macOS

The measuring runner (`run.mjs`, `--noise`, `--truth`, `--baseline` and one-off runs) works on
macOS through `darwin.mjs` and `darwinSampler.mjs`. The scenarios, the page, the report and the
lock are the same files; only the platform layer is another one. What differs, honestly:

| what | Windows | macOS |
| --- | --- | --- |
| profiles | `host`, `laptop`, `old` (affinity) | `host` only; `laptop`/`old` are refused - macOS offers no processor pinning for an unprivileged process, and a QoS class would be a different kind of slow |
| GPU share, video memory | `GPU Engine` counters | **absent.** Nothing an unprivileged process may read counts the card (powermetrics needs root); the result files carry no `gpu.*` or `videoMemoryMb` rather than zeros, and the log says `GPU n/a` |
| whole-machine CPU | counter, instant | sum of ps' per-process decaying averages (see `darwinSampler.mjs`), an approximation, flagged `cpuTotalApproximate` in every line |
| screen refresh rate | video controller's mode | null - system_profiler does not tell it for the built-in display; the "follows the screen" check is off, every launch still records its `emptyFrameRate` |
| screen kept on | `win.ps1 -Action awake` | `caffeinate -u -d -w <runner>` (same contract: turns an off screen on, ends with the runner) |

`--baseline` on macOS runs everything under `host` (the large-viewport pass picks by main-thread
time, the GPU share not existing there), so its numbers compare with an Apple Silicon machine's
own runs, not with a Windows baseline. It writes the results JSON but no `画面底数` table:
report.mjs's table is built around Windows' GPU columns. Per-frame main-thread time, frame
percentiles, long frames, per-process CPU and working sets are measured exactly as on Windows.

Run it the same way, from the repository root: `node dev/perf/run.mjs --profile host --set core
--label <name>` (`host` is the default profile there, so the flag can be left off).
`shots.mjs` (the looks-the-same tool) is not ported: its engine and clock go
through the same rig, but nothing of it has been tried on macOS.

## The files

| file | what it is |
| --- | --- |
| `scenarios.mjs` | the scenarios as data (adding one is one entry), the viewports, how a window is played, the outside-load limits, the plans the pictures are taken by |
| `song.mjs` | makes the test song: WAV, lyrics, two covers, a table of band levels |
| `page.html`, `page.tsx`, `stage.tsx` | the measuring page |
| `vite.config.ts` | builds the page as a production bundle of its own (`dev/perf/.build/dist`), and for the pictures once more in one file (`dist-shots`) |
| `shell.cjs` | the Electron main script: one window nobody sees |
| `rig.mjs` | build, serve, launch, DevTools protocol, Windows / macOS helpers: shared by the two tools |
| `win.ps1` | processor layout, process tree with affinities, the per-second counter sampler |
| `darwin.mjs`, `darwinSampler.mjs` | the macOS side: machine description, process tree, stray engines, keeping the display on, and the per-second `ps` sampler (no GPU counters) |
| `run.mjs`, `report.mjs` | the runner and the table writer |
| `shots.mjs`, `clock.js` | the looks-the-same tool, and the script it puts into the page to take it off real time |

## What is measured

**The page.** One lyric style over one background, built from the app's own parts: the settings
stores (a scenario's options go in through the stores' own actions), `useVisualizerRendererModel`
(the same props and the same re-render on every lyric line), `VisualizerRenderer` with its
Suspense boundary and harmony layer, the layer and context `App.tsx` puts around it, `AppShell`
with the app's colour variables, and `usePlaybackVisualizerBridge`, which reads the song clock
from a real `<audio>` element and the band levels from an analyser (fftSize 2048, smoothing 0.6,
as in the app) every frame. The frame-rate cap is installed as `src/index.tsx` installs it and is
at its default, which is off. The bundle is production React. It is **not minified**, so that the
function names in the long-frame reports can be read; `PERF_MINIFY=1` builds it minified.

**A scenario's options** go into the settings store through the store's own actions, and the page
then reads every one of them back. A store action drops a field it does not know and turns a
value it does not accept into the default without a word, so a field that does not hold what the
scenario asked for stops the page and the scenario is written as failed. The options as the store
holds them are in every result (`page.tunings`).

**The lyrics** reach the store the way the app's do for a local song with a lyric file, in the
measuring and in the pictures mode alike:

1. What `LyricParserFactory.parse` does to the lines a parser has read, called without options as
   `resolveLocalSongLyrics` calls it: `finalizeParsedLyricLines` (every parser ends in it), which
   puts a line `......` into every gap of more than 3 s between two lines and before a first line
   that starts after 3 s, and adds the render hints. The line rules are not applied here; they run
   in `createLyricsSetter` (step 2). The test song so gets two such lines: 0.5 s to 5.5 s, and
   30.25 s to 34.55 s in its pause.
2. `createLyricsSetter`, built as `App.tsx` builds it from the lyric settings store, which holds a
   new user's settings here (no line rules; staff credits by the `smart` policy, 1.5 s minimum
   dwell, absorbing off, no pattern of the user's). Inside it, in this order: the pure-music check,
   the line rules (`applyLyricLineRules`), the staff-credit policy, the chorus effects (from the lines' own chorus
   marks, else from the ranges cached for the song, else found from repeated text), the saved word
   segmentation, the render hints, and the `lyrics.transform` hook of mods (none are installed).
   The song it reads follows the store in an effect, as in the app.

Not applied: reading the text of a lyric file (LRC, TTML and the rest). The test song's lines are
data with a time per word already, so the parse itself costs nothing here.

**The song.** `song.mjs` computes it: 96 s, a kick on every beat, a bass line, a pad, a lead in
the range of a voice and hi-hats that change by section; invented lyrics in Chinese and English
with a time per word, translations on some lines, a pause of 4.6 s, one long line and a fast
passage. Every measurement plays seconds 40 to 48: a Chinese line with a translation, the long
mixed line and the first two fast lines. Two runs write the same bytes.

**One measurement.** A scenario is one launch of the engine and one load of the page. After 6 s
of the song as warm-up the window is played three times (2 s of run-in before each); the result
is the median of the three, with the lowest and the highest in the JSON. A scenario that cannot
be measured (the page does not start, an option does not take, the sampler has no data for a
window, a process is not held to the profile's processors) is written as a file with an `error`
and no numbers, and the run goes on.

**A song change.** In a song-change scenario the song changes one second into every window, the
way the app changes to a local song (`onPlayLocalSong` in `useLibraryPlaybackController.ts`, and
the play effect of `usePlaybackAudioBridge.ts`). In one step: the new song's lyrics, line index
-1, the clock at 0, the new song, its cover, the audio element stopped at 0, and the player state
`IDLE`. 250 ms later: the song object once more, the lyrics once more (both as the app sets them
after it has looked for a match), then `play()`, and `PLAYING` when it has started. Left out:
everything before that first step (reading the file, extracting its cover, parsing its lyrics);
the 250 ms stand for a match look-up and a second lyric parse whose real length depends on the
song and the disk; the cover comes in the same step, in the app a moment later from its cache;
the theme restored for the song, the queue, the media session, the taskbar and Discord updates,
mods' song-changed event; the new source itself (the same WAV is played again from its start, so
nothing is decoded anew). A change to an online song, and a change under automix (two decks, no
stop), are not modelled.

**The engine.** The project's Electron binary with a main script of its own (`shell.cjs`) that
repeats the app window's options and `webPreferences`. On Windows `electron/main.cjs` sets no
switch that changes drawing, so none is copied. The window is shown inactive at x = y = -20000,
cannot take focus, has no taskbar button and is muted. A window that is never shown also runs but
unevenly (frame gap p95 12.4 ms on an empty page against 6.4 ms) and screenshots of it hang, so it
is not used. The Chrome fallback was not built: Electron works.

**The frame rate.** The window follows the screen: 160 frames a second on the PC this was built
on. No way was found to make it produce 60 without changing how frames are made (`--limit-fps`
does nothing in this Chromium; the app's own cap at 60 gives 53 on a 160 Hz screen and wraps
`requestAnimationFrame`). So the headline numbers are **per frame**, and beside them are two
numbers per second:

- `perSecond`: the main-thread milliseconds really spent per second, at the frame rate the page
  ran at (per frame x real frame rate). This is the DevTools number over its span; nothing is
  assumed.
- `perSecondAt60`: per frame x 60. On an ordinary 60 Hz screen a second costs **at least** this.
  It would be the cost there only if all work were done once per frame. Work that goes by time
  (once per lyric line or word, timers, a canvas that redraws at a rate of its own) was divided
  by 160 frames here and would be divided by 60 there.

The cost on a 60 Hz screen lies between the two. (A page that ran below 60 frames a second has
them the other way round, and the truth is still between them.) The GPU share is the same pair:
`gpu.percent` as measured, and `gpu.percentAt60` (share x 60 / real rate), which is at least what
60 frames a second would take.

The frame rate also differs from scenario to scenario: a heavy style ran at 117 frames a second
where a light one ran at 156, under the same profile. A scenario at a lower rate has its
by-time work divided by fewer frames, so **its per-frame numbers do not compare with those of a
scenario at full rate**; a change that raises the frame rate lowers the per-frame numbers by
that alone. The table marks every row whose frame rate is under 95% of the same profile's
empty-page frame rate (from `_check.json`); for those rows compare `perSecond`.

**The screen has to be on, and a run turns it on.** The window follows the screen only while
the screen is on. Once the screen has gone off (after 5 minutes without input on this PC) the
window is paced by a timer instead: 128 frames a second here (a gap of 7.8 ms), where the screen
refreshes 160 times. The same scenarios then read differently per frame, and nothing taken that
way compares with a result taken with the screen on. The shell's own hold on the screen
(`powerSaveBlocker`) keeps a screen from going off but does not turn one on. So the runner
starts a helper for the whole run (`win.ps1 -Action awake`) that tells Windows every two seconds
that the screen and the PC are in use: **a screen that was off comes on when a run starts, and
stays on until the run ends**; after that it goes off again by its usual timeout. No setting of
Windows is changed. Only `run.mjs` does this; `shots.mjs` does not.

The rig also looks, because a number at the wrong rate would not show otherwise:

- every launch watches its window for a second and a half while it is still empty; each result
  holds the rate it was paced at as `emptyFrameRate`, beside `screenRefreshRate`;
- a result whose empty window made less than 95% of the screen's refresh rate is marked
  `disturbed` with `disturbedBy: 'frame rate'`, and the table says so at its top;
- `--baseline` does not start in that state (with `--allow-disturbed` it runs, as
  `baseline-disturbed`).

The screen's refresh rate is the one Windows reports for the first video controller's current
mode: on a PC whose window follows another screen than that one, the mark is wrong.

**The profiles.** A fast PC drops no frames, so the cost is made visible by slowing it:

| profile | what it is |
| --- | --- |
| `host` | no limits; a reference |
| `laptop` | every process of the app held to 4 slow ("E") cores, and nothing else |
| `old` | every process of the app held to 2 slow cores, and nothing else |

A profile is a set of processors and nothing more. Affinity slows raster, compositor, GPU-process
and worker threads as well as the main thread, and `cpuCores` under a profile is the page's own
work. (`old` used to add the DevTools 2x slow-down of the main thread. It is gone: its helper
thread kept about 0.8 of a processor busy by itself, so the app was left with about 1.1, and it
did not slow short tasks at all, so a light page read no slower under `old` than under `laptop`.)

The app is started through `start /affinity`, so every process has the mask from its first
instruction. The runner asks Windows for the affinity of every process of the app after the
launch and again at the end of the scenario, when the processes that start later (the audio
service) exist; one process off the mask fails the scenario. The slow cores are the ones Windows
reports with the lowest efficiency class; a PC without two classes gets its last processors. A PC
that cannot give a profile exactly the number of processors it asks for is refused. The masks are
64 bits wide: **a PC with more than 64 logical processors is not supported.**

How slow a profile is, is not a factor that is set but a time that is measured: `--check` runs a
fixed single-thread benchmark in the page under the profile (`_check.json`, `benchmark`). **That
time is how a profile is matched against a real machine**: run the same benchmark on the machine
(`window.__perf.benchmark()` in the page) and take the profile whose time is nearest. It says
nothing about the machine's graphics card. On this PC the benchmark reads the same under `laptop`
and `old` (360 to 370 ms under both, against 178 without limits): one thread is as fast on 2 slow
cores as on 4. The two profiles differ only in how many threads can run at once, and `old` is
not the harder one for every scenario: `style-diorama` made 151 frames a second under `old` (one
run) and 138 under `laptop` (two runs). The viewport is 1920x1080 at device
scale 1 for every profile (the scale is forced, so it means the same pixels on any screen).

**The numbers** (per window; `summary` holds median, min and max of each):

- `frames`: rate, count, mean gap, p50, p95, p99, worst, share of gaps over 16.7 ms and over 33.3 ms.
  These are gaps between `requestAnimationFrame` callbacks, not frames shown on the screen. The
  recorder itself is two small callbacks per frame inside the page; they are in the script time
  of every scenario alike (the lightest scenario, all included, reads about 0.1 ms per frame).
- `perFrame`: main-thread milliseconds per frame: script, style recalculation, layout, the rest
  of task time, the total, the total as a share of the 16.7 ms budget of a 60 Hz screen, and the
  number of layouts and style recalculations per frame. From `Performance.getMetrics` deltas;
  nested style and layout time is not counted as script.
- `perSecond`: main-thread milliseconds per second as spent, at the real frame rate.
- `perSecondAt60`: per frame x 60, the least a 60 Hz screen costs per second (see the frame rate
  above). `perFrame.budgetPercent` is the same as a share of the second.
- `longFrames`: count, blocking time, and in `longFrameScripts` the top scripts by time with
  their function name and their forced style-and-layout time (`long-animation-frame` entries).
- `cpuCores`, `cpuMsPerFrame`: CPU time of the GPU process, the renderer, the browser process
  and the rest, over the window (`SystemInfo.getProcessInfo`).
- `heapMb`, `domNodes`: JS heap and DOM node count at the start and the end of the window.
- `gpu.percent`, `gpu.percentAt60`: the share of the graphics card's 3D engine the app's
  processes used (Windows' `GPU Engine ... engtype_3D ... Utilization Percentage`, one sample a
  second, averaged), and the same scaled to 60 frames a second, which is at least what 60 frames
  a second would take. `videoMemoryMb`: their dedicated video memory at the end of the window
  (`GPU Process Memory ... Dedicated Usage`).
- `workingSetMb`: the working set of every process of the app at the end of the window.
- `samplerLines`: how many of the sampler's one-a-second lines the GPU, memory and outside
  numbers of the window rest on. A window with fewer than 6, or with lines that do not list the
  app, fails the scenario: these numbers are never written as 0 for want of data.
- `outside`: what programs that are not the app did meanwhile (see below).

Beside the numbers a result holds `commit` and `dirty` (the code it was measured from),
`emptyFrameRate` and `screenRefreshRate` (whether the window followed the screen), `page`
(what the page reports about itself: style, background, `tunings` as the store holds them, how
many lyric lines the store holds, the graphics card), `processesAtEnd` (every process of the app
with its affinity, as Windows listed it at the end) and `tookSeconds`.

## Outside load

The sampler also reads the whole machine's CPU use, the use of the processors the app is held
to, and the 3D-engine use and video memory of every *other* process. A window is disturbed when,
on average over it, the others used more than 30% of all processors, or more than 25% of the
held processors, or more than 10% of the 3D engine (`OUTSIDE_LOAD` in `scenarios.mjs`; the first
two were set from what this PC shows with and without a test run elsewhere; for the third, a
game read 85% and the desktop with nothing moving reads about 1%. With nothing else running the
windows read 3% to 9% of all processors and 0.3% to 4% of the held ones). A disturbed window is thrown
away and played again, up to four more times; a scenario that never gets three quiet windows is
marked `disturbed` in its JSON and in the table, and its numbers are not a baseline.

What the outside numbers do and do not see:

- **A sampler per launch.** Every scenario has a launch of its own, and every launch a sampler of
  its own, so a sampler lives for about a minute. Windows' counter reader lists the processes
  with a 3D engine once, when it starts, so the graphics-card use of a program started later is
  missing from `outside.gpuPercent`. (Tried: a sampler started before the rig's own engine read
  0.00% of outside 3D use while that engine played a style; one started after it read 4.64%.)
  Before, one sampler ran for a whole pass of up to 35 minutes; now such a program is missed only
  until the next scenario starts. What is still not seen: the graphics-card use of a program that
  starts while a scenario is being measured, for the rest of that scenario. Its processor use is
  seen at once (that counter is one for the whole machine).
- **The sampler's first seconds.** For about 5 s after it starts a sampler reads its own start-up
  (an idle PC read 11% to 13% of all processors there, 4.5% afterwards). No number is taken from
  those seconds: the check before a baseline, the empty-page check and every window wait them out.
- **The rig itself.** The sampler (PowerShell, held to the fast cores under `laptop` and `old`),
  the node runner and its page server are not the app, so they count as outside: about 2.5 points
  of all processors on this PC with nothing else running. They are not subtracted.
- A process of the app that starts after the sampler did is counted as outside until the next
  window, when the sampler is started again with it.

## What the app has around a style that this page does not

- `App.tsx` itself: it re-renders on every lyric line (the renderer model lives in it), with
  everything it holds. Here only the small `Stage` component does.
- The player chrome: the bottom bar with its progress line, the title bar strip, the panel, the
  toasts, the command palette, the overlays. They are separate layers over the style and some of
  them repaint while a song plays.
- The Home surface, kept mounted behind the player page.
- The real audio path: two decks, the effect chain (equaliser, ReplayGain, fades), a compressed
  format being decoded. Here one WAV goes straight into the analyser.
- Electron's preload bridge and the IPC traffic (media session, remote window, stage API), and
  the transparent-window and native-blur modes.
- Mods (Folium stage layers are mounted but empty), a video layer with a video in it, a user
  cover picture pool, uploaded fonts.
- The web font for Chinese serif text: the shell refuses every request beyond this machine, so
  the system's fallback font is drawn.

## What is not measured

- GPU time itself. The 3D-engine share says how busy the card was, not how long a frame took on
  it, and it reads unreliably when the load is very low.
- Frames actually shown. A frame the compositor dropped after the page produced it is not seen.
- A real 60 Hz screen. Work done once per lyric line or word is spread over 160 frames a second
  here, so its share per frame is smaller than at 60.
- Compositor-thread and raster-thread time on their own; they are inside the renderer's and the
  GPU process's CPU time.
- Start-up: the first six seconds after a style mounts are warm-up and are left out.
- Anything outside the 8-second window: the pause, the end of the song, idle.

## How a picture is made repeatable (`shots.mjs`)

Two captures of the same code have to give the same picture, or a comparison shows the tool and
not the change. Three things make them:

**The page is off real time.** `clock.js` goes into the page before its own scripts:

- a seeded `Math.random`;
- one clock for `performance.now`, `Date` and the time given to animation-frame callbacks, that
  only moves when the page is told to take a step, and then by exactly 1/60 s;
- animation-frame callbacks run once per step and never in between, as a browser runs them: the
  ones asked for before the step, in order; one that is cancelled before its turn does not run,
  and one asked for during the step waits for the next;
- `setTimeout`, `setInterval`, `setImmediate` and `requestIdleCallback` are kept in a list and run
  when the stepped clock reaches them. React schedules its rendering through `setImmediate` when
  there is one, so its work is in that list too;
- CSS animations, CSS transitions and Web Animations are paused the moment they appear and moved
  1/60 s per step by hand; one that reaches its end is finished, so its events fire;
- loads are counted (fetch and the reading of a response, image elements, `createImageBitmap`,
  `decode()`, fonts, `FileReader`, `canvas.toBlob`, IndexedDB, style sheets and scripts added to
  the page, messages to a worker that have not been answered, a worker that has just been made),
  and while one is under way nothing of the page's own runs: no timer and no step. A load takes
  real time; whatever went on beside it would get further in one capture than in another.

All of it runs once per frame of the screen, inside that frame's callback, so the page is laid
out and painted after every turn and never in the middle of one. A step is taken only in a frame
that found the page still: no timer to run, nothing loading, no animation just begun. What a step
sets off has played out before the next one, however long that takes. How fast the screen is and
how busy the PC is change how long a capture takes, not what is in the pictures; the screen may be
off.

**The page is one file.** For the pictures the page is built once more with every dynamic import
folded into the one script (`PERF_ONE_FILE=1` in `vite.config.ts`, into `.build/dist-shots`). In
the usual build a style's code arrives, downloaded and compiled, at a moment that depends on the
PC, and the style then starts a few steps earlier or later. The measuring runner does not use
this build.

**Every scenario starts clean and goes one way.** Each has a launch of the engine of its own,
with an empty profile: an engine that has drawn other scenarios before draws the next one
differently (the text on Fume's canvas came out with other edges), and which scenarios share an
engine would change from capture to capture. The page loads with the clock standing, then takes
90 steps before the song starts
(React shows a lazy style 300 ms after it asked for it: the style draws at step 18, and the
manifest holds that number as `mountedAtStep`). Then the plan: the song only goes forward, and at
least 4 s of it have played before each picture. The one exception is the picture 1.2 s after a
song change: the new song has then played 0.95 s and its first line (1.4 s) has not begun, so the
picture shows what a style draws between two songs (Mindscape, Luminous and Tilt draw nothing but
the background there, and give the very same picture). Before a picture the page is left standing
for three frames of the screen, so the last step is on it.

What the plans picture (`SHOT_PLANS` in `scenarios.mjs`; no picture is nearer than 0.3 s to the
start or the end of a lyric line):

| pictures | of | when |
| --- | --- | --- |
| 10 each | every scenario that is not a song change | 4.2 s (the start, the first `......` line); 30.7 and 35.0 (into and out of the pause); 41.5, 44.6, 47.5 (inside the measured eight seconds); 78.5 (the second chorus); 88.0 (the last line); `paused` (one second after pausing there); `paused-daylight` (two seconds after the daylight theme is switched on, still paused) |
| 3 each | a song change, for each of the 14 styles (`songchange-<style>`) and for Tempera without post-processing | `before-change` (41.0), `change+1.2s`, `change+5.0s` |
| 3 each | `large-...`: fume, claddagh, lumiere, pendolo, cappella, tempera, sonnet with post-processing, and tempera and sonnet without it, at the large viewport | 41.5, 44.6, 47.5 |

The pictures are the size of the measurements: 1920x1080 at scale 1, and the large viewport at
scale 1.5. On a screen the large viewport does not fit, Windows holds the window to the screen
plus its border, in the measurements as here: on the 3840x2160 screen this was built on the large
page is 2575x1448 (pictures of 3862x2172), not 2560x1440. The manifest says so.

The song change is the measured one (`changeSong` in `stage.tsx`), with the stepped clock in
place of the audio element: the new song with its lyrics, no line, the clock at 0 and the player
idle in one go; 250 ms of stepped time later the song and its lyrics once more, and it plays.
While nothing plays (paused, or those 250 ms) the band levels are what the app's bridge writes
then: a slow breath on every band.

**What stays unequal** goes into the floor, and `floor` prints it. In the reference of
2026-10-12 (five captures, ten pairs, 372 pictures of 54 scenarios, taken after the clock stopped
running cancelled frame callbacks) 238 pictures are the same in every capture, and 8 of the 30
scenarios (86 pictures) have a floor of 0 in all five numbers. How many come out equal differs
from one set of five captures to the next: a set taken a few hours earlier, before the two large
scenarios of Pendolo and Cappella were added, had 282 of 366 the same and 17 scenarios at 0, and
61 pictures that were equal in that set were not in this one. What is left is the graphics card
giving one of two results for the same commands: in a check on the two scenarios with grain, the
page's state at every picture and every WebGL call it had made, arguments included, were the same
in four captures whose pictures differed.

- **Grain.** The grain pass of Tempera and of Sonnet with post-processing (Pixi's NoiseFilter)
  comes out as one of two fields, on this picture in one capture and on that one in the next:
  23% to 38% of the pixels differ, the worst by 9 to 15 levels, the mean by 0.2 to 0.9 of a
  level. In the one pair that was looked at closely a tenth of the pixels were one level brighter
  and as many one level darker, on flat areas as on edges, so the block shift stays small: 0.08
  to 0.18 on Sonnet's four pairs. How far apart the two fields are differs from picture to
  picture, and whether five captures show the other field is luck: in the seven captures of
  2026-10-12 Tempera's grain was the same field every time (the day before it differed on five
  pictures at least; in a later capture of that day, one with a planted change of 2 levels, it
  was the other field on `style-tempera@41.5s`, where the block shift read 2.09 instead of 2.00), and
  Sonnet's differed on four pictures, the two with the largest difference only in a capture
  taken after the floor was built. In the five captures of the reference that is in place now,
  18 of the 29 pictures with grain showed the other field; at the large size the block shift
  reached 0.38 (`large-sonnet-postprocess-on@41.5s`) and 0.20 (Tempera), so the pictures of Sonnet
  with post-processing are marked by the block shift only above 0.83. So `floor` does not leave
  these pictures to what the captures show. A picture of a scenario with a grain pass
  (`SHOT_GRAIN` in `scenarios.mjs`; marked `grain` in the floor file) is held to at least worst
  pixel 16, differing 50%, over 8 levels 1%, mean 1, block shift 0.2 (`GRAIN_FLOOR` in
  `shots.mjs`): with the margins it is CHANGED above worst pixel 32, differing 75.5%, over 8
  levels 1.6%, mean 1.6 or block shift 0.55. The first four hardly ever decide there. The block
  shift does: a change of one level that covers a block is marked, grain or not. What the block
  shift does not see (a stroke that moves by a pixel) is seen in the twin without the grain pass,
  which has a floor of 0: `tempera-postprocess-off` and `style-sonnet`, pictured wherever the
  grain is (the main plan, the large pictures, Tempera's song change). No twin shows a change
  inside the post-process pass itself.
- **One cell of the dither pattern.** The default background (Latent) has dither cells that sit
  exactly on their threshold; such a cell, 3x3 pixels, comes out lit or not: a difference of 16
  to 19 levels on 9 pixels (seen at 35.0 s, 41.0 s and 78.5 s in the reference of 2026-10-11, and
  in none of the seven captures of 2026-10-12). This is why fewer than 0.002% of the pixels never
  mark a picture by the worst pixel; such a cell moves its block by 0.04. In the five captures of
  the reference that is in place now a few pixels (fewer than 41) differed by 17 to 32 levels in
  one or two pictures each of Cadenza, Classic, Fume, Monet, Partita, Pendolo and Sonnet, and by
  81 and 112 levels in two pictures of `bg-latent-dithering`, where a block moved by 0.14: taken
  to be the same thing, the pictures were not looked at.
- **One picture of Pendolo.** In one of those five captures `style-pendolo@41.5s` differed by one
  level on 0.19% of its pixels, which moved a block by 0.21; the cause was not looked for. The
  pictures of a scenario share the largest floor among them, so every picture of Pendolo is
  marked by the block shift only above 0.57.
- **Edges of text.** Text that the graphics card draws turned or scaled differs by one or two
  levels at up to 0.04% of the pixels from one capture to the next, and moves a block by 0.03 at
  most.

What the clock does not step: videos, animated images, smooth scrolling, what a worker does
without being asked by a message, a load that begins without any of the calls above (a picture
named in a style sheet: `shots.mjs` watches the network at the start and after a song change and
takes those steps in small pieces), and an animation that is paused through CSS
(`animation-play-state`), which stays paused.

### What no picture shows

- **The app's per-frame bridge.** `usePlaybackVisualizerBridge` is not mounted in the pictured
  page: the song clock, the band levels and the lyric line are written by the rig itself, from
  the song's table. A change to the bridge that alters what a style is given changes how every
  style moves in the app, and no picture differs. A check for it has to be a logic test on fixed
  analyser data, not a picture.
- The first half second of a song, before any line (the opening `......` line begins at 0.5 s),
  and the eight seconds after the last line.
- A song without lyrics, an online song, a change of song under automix.
- The daylight theme while a song plays: its one picture is taken paused.
- Backgrounds and options at the large viewport, and a song change over any background but the
  default.
- Code that arrives late: the page is one file here, so a style never shows its state "still
  loading".
- Anything the measuring page lacks too (the list above: "What the app has around a style that
  this page does not").

## Adding a scenario

One entry in `SCENARIOS` in `scenarios.mjs`: an id, a set (`core` or `second`), a label for the
table, the style, the background, and the options to change as `tunings` (by the settings
store's field name, for example `{ lumiereTuning: { renderQuality: 'low' } }`). The page reads
each option back from the store: a field or a value the store does not take fails the scenario
with a message that names it, so a new entry is checked by running it once.

A new lyric style is one row in `STYLES` in `scenarios.mjs`: `[id, the name the app shows, how it
draws]`. The row gives the measured scenario `style-<id>` and the song-change unit
`songchange-<id>` of the looks-the-same tool. A measured song change is one more entry
(`songChange(...)` in `SCENARIOS`). The id has to be in `BUILTIN_VISUALIZER_MODES`
(`src/types/visualizerModes.ts`): `applyScenario` in `stage.tsx` stops the page on a style it does
not know. The rest of adding a style is in `src/components/visualizer/README.md`.
