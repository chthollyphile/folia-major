const { spawn } = require('child_process');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

// electron/analysis/sidecar.cjs
// Runs one htdemucs separation in the downloaded Python runtime and hands the stems back.
//
// The whole of htdemucs' DSP lives in htdemucs_runner.py - see the note at the top of it for why
// this one model is in Python at all. This file is only the plumbing on the JS side: raw stereo out
// to a temp file, the runner over it, the three stems back. Plain node, no 'electron', so worker.cjs
// can require it from its utilityProcess and a test can require it from anywhere.
//
// Spawning a child and awaiting its exit is genuinely async, unlike onnxruntime-node's run() - the
// CPU work happens in another OS process, so the event loop that spawned it stays free. That is what
// lets the memory win cost nothing here: the peak is the child's, and it is gone when the child exits.

/** Stem order out of the runner, the single JS-side source of it. Reading a row wrong is silent. */
const RETURNED = ['drums', 'bass', 'vocals'];

/**
 * Ships with the app, versioned beside this file - our code, not part of the downloaded runtime.
 *
 * The .py is handed to an external python.exe, which cannot read an asar archive. In a packaged build
 * this file lives inside app.asar, so the script is listed in build.asarUnpack and its path rewritten
 * to the unpacked copy - the standard trick for feeding an asar-bundled file to an outside process. In
 * dev there is no `app.asar` in the path and the replace is a no-op.
 */
const RUNNER_SCRIPT = path.join(__dirname, 'htdemucs_runner.py')
    .replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');

/** A hung separation should not wedge the queue forever. The longest real run measured is ~17s (a
 *  40s window plus a cold model load); this is the line for "not running", not a performance target. */
const TIMEOUT_MS = 120_000;

/**
 * Runs the runner once and resolves with whatever it said, or rejects with why it did not.
 *
 * Separate from `separate` for the two things easy to get wrong once they are tangled with the temp
 * files below: that stdout is a diagnostic channel rather than data, and that a successful run still
 * has to say what it cost - logging only failures is what let a 4GB spike run unmeasured for a day.
 */
const runRunner = (pythonExe, args) => new Promise((resolve, reject) => {
    const child = spawn(pythonExe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    child.stdout.on('data', (chunk) => { output += String(chunk); });

    const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`htdemucs runner timed out after ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);
    timer.unref?.();

    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
            reject(new Error(`htdemucs runner exited ${code}: ${output.trim().slice(-400)}`));
            return;
        }
        if (output.trim()) console.log(`[htdemucs] ${output.trim().slice(-400)}`);
        resolve();
    });
});

/** Float32Array from a Buffer, copied into an aligned ArrayBuffer - a readFile Buffer is not
 *  guaranteed 4-byte aligned, and a misaligned `new Float32Array(buf.buffer, off)` throws. */
const floatsFrom = (buf) => {
    const floats = new Float32Array(buf.length / 4);
    Buffer.from(floats.buffer).set(buf);
    return floats;
};

/**
 * Separates one stereo buffer. Resolves `{ drums, bass, vocals }` each `{ left, right }` Float32Array,
 * or rejects - the caller (worker.cjs) turns any rejection into the same null a missing model gives,
 * which the renderer already handles by falling back to a crossfade.
 *
 * @param pythonExe absolute path to the runtime's interpreter
 * @param script    absolute path to htdemucs_runner.py (ships with the app)
 * @param modelPath absolute path to htdemucs.onnx
 * @param left,right equal-length Float32Array, the raw stereo mix at 44100
 */
const separate = async ({ pythonExe, script, modelPath, left, right }) => {
    const total = left.length;
    // A per-call 0700 directory rather than two predictable names in the shared temp root. os.tmpdir()
    // is multi-user on Linux/macOS, and a name built only from pid+time+counter lets another local user
    // pre-place a symlink at either path - the .in redirecting our ~10MB of decoded audio, the .out
    // swapping in stems we did not separate. mkdtemp's name is unguessable and the directory is not
    // writable by anyone else, so neither file can be pre-created. CWE-377.
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'folia-htd-'));
    const inPath = path.join(dir, 'mix.in');
    const outPath = path.join(dir, 'stems.out');

    try {
        const inBuf = Buffer.allocUnsafe(2 * total * 4);
        Buffer.from(left.buffer, left.byteOffset, total * 4).copy(inBuf, 0);
        Buffer.from(right.buffer, right.byteOffset, total * 4).copy(inBuf, total * 4);
        await fsp.writeFile(inPath, inBuf);

        await runRunner(pythonExe, [script, inPath, outPath, String(total), modelPath]);

        const floats = floatsFrom(await fsp.readFile(outPath));
        if (floats.length !== RETURNED.length * 2 * total) {
            throw new Error(`htdemucs runner wrote ${floats.length} floats, expected ${RETURNED.length * 2 * total}`);
        }
        const reply = {};
        RETURNED.forEach((name, i) => {
            reply[name] = { left: floats.slice(i * 2 * total, (i * 2 + 1) * total),
                            right: floats.slice((i * 2 + 1) * total, (i * 2 + 2) * total) };
        });
        return reply;
    } finally {
        await fsp.rm(dir, { recursive: true, force: true }).catch(() => { });
    }
};

module.exports = { separate, RETURNED, RUNNER_SCRIPT, TIMEOUT_MS };
