'use strict';

const fs = require('fs');
const { spawn } = require('child_process');

// Runs one strict, bounded FFmpeg encode and validates that its published output fully decodes.

const MAX_STDERR_CHARS = 32 * 1024;

const appendBounded = (current, chunk) => `${current}${String(chunk)}`.slice(-MAX_STDERR_CHARS);

const DSD_INPUT = /\.(dsf|dff)$/i;
/**
 * The one rate DSD is brought down to; every other source keeps its own.
 *
 * FFmpeg decodes DSD at an eighth of its bit rate: 352.8 kHz for DSD64, 1411.2 kHz for DSD256,
 * which the FLAC encoder refuses outright. Even the rates it accepts are mostly the modulator's
 * noise shaping, an incompressible 13 Mb/s per DSD64 track in the cache. 88.2 kHz divides every
 * 44.1 kHz-family DSD rate exactly and is still above the 44.1/48 kHz most output devices mix at.
 */
const DSD_PCM_RATE = 88200;

const runProcess = ({ executable, args, spawnProcess = spawn, signal, timeoutMs = 30 * 60 * 1000 }) => new Promise((resolve, reject) => {
    let stderr = '';
    let settled = false;
    const child = spawnProcess(executable, args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
    });

    const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve(result);
    };
    const abort = () => {
        child.kill();
        const error = new Error('Transcode cancelled');
        error.code = 'CANCELLED';
        finish(error);
    };
    const timeout = setTimeout(() => {
        child.kill();
        const error = new Error('FFmpeg timed out');
        error.code = 'TIMEOUT';
        finish(error);
    }, timeoutMs);

    signal?.addEventListener('abort', abort, { once: true });
    child.stderr?.on('data', chunk => { stderr = appendBounded(stderr, chunk); });
    child.once('error', error => finish(error));
    child.once('close', code => {
        if (code === 0) finish(null, { stderr });
        else {
            const error = new Error(stderr.trim() || `FFmpeg exited with code ${code}`);
            error.code = 'FFMPEG_FAILED';
            finish(error);
        }
    });
    if (signal?.aborted) abort();
});

const encodeArgs = (inputPath, outputPath, format) => [
    '-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-y',
    '-i', inputPath,
    '-map', '0:a:0', '-vn', '-sn', '-dn', '-map_metadata', '-1',
    '-ac', '2',
    ...(DSD_INPUT.test(inputPath) ? ['-ar', String(DSD_PCM_RATE)] : []),
    ...(format === 'flac'
        ? ['-c:a', 'flac', '-compression_level', '5', '-f', 'flac']
        : ['-c:a', 'pcm_s16le', '-f', 'wav']),
    outputPath,
];

const validateArgs = outputPath => [
    '-hide_banner', '-nostdin', '-v', 'error', '-xerror',
    '-i', outputPath, '-map', '0:a:0', '-f', 'null', '-',
];

const transcodeAudioFile = async ({ executable, inputPath, outputPath, format, signal, spawnProcess }) => {
    await runProcess({ executable, args: encodeArgs(inputPath, outputPath, format), signal, spawnProcess });
    const stat = await fs.promises.stat(outputPath);
    if (!stat.isFile() || stat.size < 128) {
        const error = new Error('FFmpeg produced an empty audio file');
        error.code = 'INVALID_OUTPUT';
        throw error;
    }
    await runProcess({ executable, args: validateArgs(outputPath), signal, spawnProcess });
    return { size: stat.size };
};

module.exports = { DSD_PCM_RATE, encodeArgs, runProcess, transcodeAudioFile, validateArgs };
