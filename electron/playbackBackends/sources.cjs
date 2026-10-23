'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Stages opaque renderer-owned audio bytes; no decoder, engine or mod dependency belongs here.

const MAX_SOURCE_BYTES = 512 * 1024 * 1024;

const createPlaybackSourceStore = (root) => {
    const files = new Map();
    const stage = async (data) => {
        if (!(data instanceof ArrayBuffer) || data.byteLength < 1 || data.byteLength > MAX_SOURCE_BYTES) {
            throw new Error('invalid-playback-source-size');
        }
        await fs.mkdir(root, { recursive: true });
        const id = randomUUID();
        const filePath = path.join(root, `${id}.audio`);
        await fs.writeFile(filePath, Buffer.from(data), { flag: 'wx', mode: 0o600 });
        files.set(id, filePath);
        return { id, filePath };
    };
    const release = async (id) => {
        const filePath = files.get(id);
        if (!filePath) return;
        // Delete only exact paths minted by this instance, never renderer-supplied paths.
        await fs.rm(filePath, { force: true });
        files.delete(id);
    };
    const dispose = async () => {
        const results = await Promise.allSettled([...files.keys()].map(release));
        results.forEach(result => {
            if (result.status === 'rejected') console.warn('[PlaybackBackend] Source cleanup failed', result.reason);
        });
    };
    return { stage, release, dispose };
};

module.exports = { createPlaybackSourceStore, MAX_SOURCE_BYTES };
