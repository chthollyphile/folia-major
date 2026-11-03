// test/manual/wallpaper-watchdog-child.cjs
// Stand-in for the wrapped Folia process used by wallpaper-watchdog-sim.ts. Plain Node, no
// Electron: it wires the real electron/wallpaper/wallpaperWatchdog.cjs module with stubbed side effects and
// reports its own lifecycle to a status file, so the simulation proves the watchdog's parent
// liveness probe actually recovers after the fake windowtolayer dies.
//
// Consumed env:
//   WATCHDOG_SIM_STATUS      path of the status file to append lifecycle lines to
//   WATCHDOG_SIM_PARENT_PID  the pid to treat as "windowtolayer" (the fake wtl's pid)
'use strict';

const fs = require('fs');
const { createWallpaperWatchdog } = require('../../electron/wallpaper/wallpaperWatchdog.cjs');

const statusFile = process.env.WATCHDOG_SIM_STATUS;
const parentPid = Number(process.env.WATCHDOG_SIM_PARENT_PID);

const append = (line) => {
  fs.appendFileSync(statusFile, `${line}\n`, 'utf8');
};

// In-memory no-op store: this sim only exercises the probe + recovery path, not persistence.
const store = {
  get: () => undefined,
  set: () => {},
  delete: () => {},
};

const watchdog = createWallpaperWatchdog({
  store,
  env: process.env,
  // A fake relaunch child: record what a real relaunch would spawn (proving the env rules), and
  // treat the spawn as immediately successful so exit() fires and terminates this stand-in.
  spawnFn: (cmd, args, opts) => {
    append(
      `relaunch-spawned ${cmd} ${args.join(' ')} ` +
      `FOLIA_RELAUNCH=${opts.env.FOLIA_RELAUNCH} ` +
      `WAYLAND_SOCKET=${opts.env.WAYLAND_SOCKET ?? ''} ` +
      `WRAPPED=${opts.env.FOLIA_WRAPPED_BY_WINDOWTOLAYER ?? ''}`
    );
    return {
      on: (event, cb) => { if (event === 'spawn') cb(); },
    };
  },
  execPath: () => process.execPath,
  argv: () => ['--sim'],
  getPpid: () => process.ppid,
  exit: (code) => {
    append(`exit ${code}`);
    process.exit(code);
  },
  killFn: process.kill.bind(process),
  probeIntervalMs: 300,
  logWarn: (msg) => append(`warn ${String(msg)}`),
  logError: (msg) => append(`error ${String(msg)}`),
});

append(`started pid=${process.pid} parent=${parentPid}`);
watchdog.recordWrappedLaunch();
watchdog.startParentLivenessProbe({ parentPid });

// The probe interval is unref'd (as in the real app); hold the event loop open so this stand-in
// keeps polling until the orchestrator kills the fake wtl and recovery fires.
setInterval(() => {}, 10_000);
