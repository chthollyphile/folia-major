const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

// dev/beat-this-wgsl/main.cjs
// Test shell for the hand-written WGSL Beat This! runtime: a hidden window runs every chunk through
// the real WebGPU of this Electron build and writes the logits (and, optionally, every stage of
// chunk 0) next to the inputs. Never touches the app's own profile - userData is a throwaway dir.
//
//   npx rolldown dev/beat-this-wgsl/harness.ts -o $OUT/harness.js -f iife -p browser
//   BTW_DIR=$OUT BTW_WEIGHTS=... BTW_CHUNKS=chunks.f32 [BTW_STAGES=1] [BTW_REPEAT=5] [BTW_PROFILE=1] npx electron dev/beat-this-wgsl/main.cjs
//
// BTW_F16=storage|math runs the shader-f16 kernels (needs the --f16 export and an adapter with
// shader-f16); see kernels.ts for the two levels.
//
// BTW_COEXIST=1 runs coexist.ts instead (bundle it as harness.js and coexist-worker.ts as
// coexist-worker.js): a VISIBLE window drawing a WebGL2 load of BTW_LOAD iterations per pixel while
// a worker runs BTW_COEXIST_CHUNKS chunks per slicing mode, and prints missed frames per mode.
//
// BTW_PROFILE=1 times every dispatch with timestamp-query and writes profile.json (median per
// dispatch over the repeats) plus a summary by kernel and by network stage.
//
// Exit code 0 when the run completed; correctness is judged by the comparison scripts, not here.
// The whole acceptance run, from the official checkpoint to identical beat lists:
//
//   1. python build/beat_this_wgsl/export_weights.py beat_this-final0.ckpt $W/final0.bin
//      (or with --f16: matmul weights stored as fp16, 41 MB instead of 81; same steps, same gate)
//   2. layer by layer, chunk 0 of a [n, 1500, 128] f32 mel file:
//        python build/beat_this_wgsl/reference.py beat_this-final0.ckpt chunks.npy $REF
//        BTW_DIR=$OUT BTW_WEIGHTS=$W/final0.bin BTW_CHUNKS=chunks.f32 BTW_STAGES=1 npx electron dev/beat-this-wgsl/main.cjs
//        python build/beat_this_wgsl/compare_stages.py $REF $OUT
//   3. whole tracks through the app's own mel / chunking / peak picking, against ORT on the same chunks:
//        BTW_DIR=$OUT BTW_WEIGHTS=$W/final0.bin BTW_SONGS=a.mp3,b.mp3 npx electron dev/beat-this-wgsl/main.cjs
//        python build/beat_this_wgsl/ort_chunks.py models/beat_this.onnx $OUT a b
//        npx rolldown dev/beat-this-wgsl/compare-songs.ts -o $OUT/compare.cjs -f cjs -p node && node $OUT/compare.cjs $OUT a b
//      (exit 0 only when every track's beat and downbeat lists are identical)

const dir = process.env.BTW_DIR;
if (!dir) {
    console.error('BTW_DIR is required');
    process.exit(2);
}
// Unquantised timestamp-query, so per-kernel GPU times are real rather than rounded to 100 us.
app.commandLine.appendSwitch('enable-webgpu-developer-features');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'btw-userdata-')));

if (process.env.BTW_F16 && !['storage', 'math'].includes(process.env.BTW_F16)) {
    console.error(`BTW_F16 must be storage or math, got ${process.env.BTW_F16}`);
    process.exit(2);
}
ipcMain.handle('btw-config', () => ({
    weights: process.env.BTW_WEIGHTS,
    chunks: process.env.BTW_CHUNKS,
    out: dir,
    stages: process.env.BTW_STAGES === '1',
    repeat: Number(process.env.BTW_REPEAT || 5),
    songs: (process.env.BTW_SONGS || '').split(',').filter(Boolean),
    profile: process.env.BTW_PROFILE === '1',
    f16: process.env.BTW_F16 || undefined,
    load: Number(process.env.BTW_LOAD || 64),
    trimSec: Number(process.env.BTW_TRIM_SEC || 0),
    app: process.env.BTW_APP === '1',
    coexistChunks: Number(process.env.BTW_COEXIST_CHUNKS || 10),
}));
ipcMain.on('btw-log', (_event, line) => console.log(line));
ipcMain.on('btw-done', (_event, code) => app.exit(code));

app.whenReady().then(() => {
    const html = path.join(dir, 'harness.html');
    fs.writeFileSync(html, '<!doctype html><meta charset="utf-8"><script src="harness.js"></script>');
    const coexist = process.env.BTW_COEXIST === '1';
    const win = new BrowserWindow({
        show: coexist,
        width: 1280,
        height: 800,
        webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: !coexist },
    });
    win.webContents.on('console-message', (event) => console.log(`[renderer] ${event.message}`));
    win.webContents.on('did-fail-load', (_event, code, description) => {
        console.error('load failed', code, description);
        app.exit(4);
    });
    win.webContents.on('render-process-gone', (_event, details) => {
        console.error('renderer gone', details);
        app.exit(3);
    });
    win.loadFile(html);
});
