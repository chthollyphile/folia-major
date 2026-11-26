const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

// dev/strokes-wgsl/main.cjs
// Test shell for the hand-written WGSL stroke-order runtime (src/services/analysis/strokesWgsl): a hidden
// window runs full6 / own2 through the real WebGPU of this Electron build against the torch reference
// data (~/bihua tools/mnn/build/ref: ref.bin + index.json, read in place, never copied) and prints the
// alignment and timing figures. Never touches the app's own profile - userData is a throwaway dir.
//
//   npx rolldown dev/strokes-wgsl/harness.ts -o $OUT/harness.js -f iife -p browser
//   SW_DIR=$OUT SW_TASK=align [SW_F16=1] npx electron dev/strokes-wgsl/main.cjs
//
// SW_TASK: stages (encoder / memory / step-0 intermediates against dbg_*), align (teacher-forced and free
// generation, with and without the reference), bench (timings, SW_B=1,16,64,128,256 batch sizes), own2
// (own2 against SW_OWN2REF, the scratch own2_ref.py output, at each SW_B: the first is the reference run,
// the others must match it bitwise), ownbench (own2 ms/char per SW_B, median of SW_ROUNDS rounds, and end
// to end after full6). SW_FULL6 / SW_OWN2 / SW_REF override the default paths under ~/bihua;
// SW_OWN2_CHUNK is own2's glyphs a forward.
// SW_PACED=1 runs with gpuSlices' default pacing (2 ms slices) and reports the longest dispatch.

const dir = process.env.SW_DIR;
if (!dir) {
    console.error('SW_DIR is required');
    process.exit(2);
}
const bihua = path.join(os.homedir(), 'bihua');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'sw-userdata-')));
// Unquantised timestamps for per-dispatch costs (dev shell only).
app.commandLine.appendSwitch('enable-webgpu-developer-features');

ipcMain.handle('sw-config', () => ({
    out: dir,
    task: process.env.SW_TASK || 'align',
    f16: process.env.SW_F16 === '1',
    full6: process.env.SW_FULL6 || path.join(bihua, 'models/full6/full6-folia.bin'),
    own2: process.env.SW_OWN2 || path.join(bihua, 'models/own2/own2-folia.bin'),
    own2ref: process.env.SW_OWN2REF || '',
    own2Chunk: Number(process.env.SW_OWN2_CHUNK || 2),
    rounds: Number(process.env.SW_ROUNDS || 5),
    ref: process.env.SW_REF || path.join(bihua, 'tools/mnn/build/ref'),
    batches: (process.env.SW_B || '1,16,64,128,256').split(',').map(Number),
    chars: Number(process.env.SW_CHARS || 126),
    paced: process.env.SW_PACED === '1',
    readEvery: Number(process.env.SW_READ_EVERY || 8),
    chunk: Number(process.env.SW_CHUNK || 4),
    alignB: Number(process.env.SW_ALIGN_B || 0),
    modes: (process.env.SW_MODES || 'ref,noref').split(','),
}));
ipcMain.on('sw-log', (_event, line) => console.log(line));
ipcMain.on('sw-done', (_event, code) => app.exit(code));

app.whenReady().then(() => {
    const html = path.join(dir, 'harness.html');
    fs.writeFileSync(html, '<!doctype html><meta charset="utf-8"><script src="harness.js"></script>');
    const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
    win.webContents.on('console-message', (event) => console.log(`[renderer] ${event.message}`));
    win.webContents.on('render-process-gone', (_event, details) => {
        console.error('renderer gone', details);
        app.exit(3);
    });
    win.loadFile(html);
});
