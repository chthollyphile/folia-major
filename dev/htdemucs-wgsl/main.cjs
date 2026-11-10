const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

// dev/htdemucs-wgsl/main.cjs
// Test shell for the hand-written WGSL htdemucs runtime: a hidden window runs one 172032-sample
// segment through the real WebGPU of this Electron build and writes the stem (and, optionally,
// every stage) next to the input. Never touches the app's own profile - userData is a throwaway dir.
//
//   npx rolldown dev/htdemucs-wgsl/harness.ts -o $OUT/harness.js -f iife -p browser
//   HTW_DIR=$OUT HTW_WEIGHTS=htdemucs-wgsl.bin HTW_MIX=segments.f32 [HTW_STAGES=1] [HTW_REPEAT=5] npx electron dev/htdemucs-wgsl/main.cjs
//
// HTW_SOURCES=0,1,2,3 returns those sources (htdemucs' drums, bass, other, vocals) from every run, and
// out.f32 is then [n, sources, 2, 172032] in that order.
// HTW_F16=1 opens the device with shader-f16 and runs the GEMMs in f16 (kernels.ts GemmMode).
// HTW_TIMINGS=1 also runs the first segment cut one dispatch per submit and writes timings.json
// (median ms per dispatch over five runs) - the dispatches a busy visualizer frame would wait behind.
//
// HTW_MIX is [n, 2, 172032] f32 (each segment left then right). Output: out.f32 ([n, 2, 172032], the drums) and
// stage_<name>.f32. Correctness is judged by the comparison script, not here:
//
//   python build/htdemucs_wgsl/compare_stages.py $REF $OUT
//
// where $REF holds the same segment run through the ONNX graph with its intermediate tensors exposed
// (build/htdemucs_wgsl/reference.py).

const dir = process.env.HTW_DIR;
if (!dir) {
    console.error('HTW_DIR is required');
    process.exit(2);
}
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'htw-userdata-')));

ipcMain.handle('htw-config', () => ({
    weights: process.env.HTW_WEIGHTS,
    mix: process.env.HTW_MIX,
    out: dir,
    stages: process.env.HTW_STAGES === '1',
    repeat: Number(process.env.HTW_REPEAT || 3),
    slice: process.env.HTW_SLICE || 'none',
    timings: process.env.HTW_TIMINGS === '1',
    f16: process.env.HTW_F16 === '1',
    sources: process.env.HTW_SOURCES || '',
}));
ipcMain.on('htw-log', (_event, line) => console.log(line));
ipcMain.on('htw-done', (_event, code) => app.exit(code));

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
