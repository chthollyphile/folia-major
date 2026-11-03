const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

// electron/spotify/audioFiles.cjs
// Spotify's audio files on disk, kept as Spotify sends them: encrypted. No key is written here
// or anywhere; a kept file opens only with the key Spotify gives a signed-in paying account, and
// that key is asked for anew in every run (`audio.cjs`).
// A file is `<name>.bin`. It is written as `<name>.part` and takes its name only once every byte
// of it is on disk.
// The folder is inside one the listener may have chosen, and may hold files that are not the
// store's: nothing here lists, counts or removes a file that is not named as the store names one.

const fsp = fs.promises;
// `<trackId>-<bitrate>`, as `audio.cjs` names a file.
const NAME = /^[0-9A-Za-z]{22}-\d+$/;
const nameOf = (file, ending) => (file.endsWith(ending) && NAME.test(file.slice(0, -ending.length)) ? file.slice(0, -ending.length) : null);

// `directory()` is where the files are; it may change between calls (the cache folder is a setting).
function createSpotifyAudioFiles({ directory }) {
  const at = (name, ending) => path.join(directory(), `${name}${ending}`);
  const writing = new Set();
  let swept = null;
  // The parts a run that ended in the middle of a file left behind. Looked for once a run,
  // before the first file is written or counted.
  const sweep = () => {
    swept ??= (async () => {
      const files = await fsp.readdir(directory()).catch(() => []);
      await Promise.all(files.filter(file => nameOf(file, '.part') && !writing.has(nameOf(file, '.part')))
        .map(file => fsp.rm(path.join(directory(), file), { force: true }).catch(() => {})));
    })();
    return swept;
  };

  return {
    // How long the kept file is, or null when there is none.
    async size(name) {
      const stat = await fsp.stat(at(name, '.bin')).catch(() => null);
      return stat?.isFile() ? stat.size : null;
    },

    // The first `length` bytes of a kept file.
    async head(name, length) {
      const handle = await fsp.open(at(name, '.bin'), 'r');
      try {
        const { bytesRead, buffer } = await handle.read(Buffer.alloc(length), 0, length, 0);
        return buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    },

    // Bytes [from, to] of a kept file, as `{ body, stop() }`. A file that is read counts as used
    // now: the cache drops the files used longest ago first.
    read(name, from, to) {
      const file = at(name, '.bin');
      const used = new Date();
      fsp.utimes(file, used, used).catch(() => {});
      const stream = fs.createReadStream(file, { start: from, end: to });
      return { body: Readable.toWeb(stream), stop: () => stream.destroy() };
    },

    // Writes a file of `length` bytes from `chunks`. Fewer or more bytes than that leave nothing.
    async write(name, length, chunks) {
      writing.add(name);
      const part = at(name, '.part');
      try {
        await fsp.mkdir(directory(), { recursive: true });
        await sweep();
        let written = 0;
        const handle = await fsp.open(part, 'w');
        try {
          for await (const chunk of chunks) {
            if (written + chunk.length > length) throw new Error(`more bytes arrived than the ${length} of the file`);
            written += (await handle.write(chunk)).bytesWritten;
          }
          if (written !== length) throw new Error(`${written} bytes were written of a file of ${length}`);
          // On disk before it has its name: a file cut short by a power failure would play cut short.
          await handle.sync();
        } finally {
          await handle.close();
        }
        await fsp.rename(part, at(name, '.bin'));
      } catch (error) {
        await fsp.rm(part, { force: true }).catch(() => {});
        throw error;
      } finally {
        writing.delete(name);
      }
    },

    // Every kept file, as the media cache counts its files: `{ name, size, usedAt }`.
    async list() {
      await sweep();
      const files = await fsp.readdir(directory()).catch(() => []);
      const kept = await Promise.all(files.map(async file => {
        const name = nameOf(file, '.bin');
        const stat = name && await fsp.stat(path.join(directory(), file)).catch(() => null);
        return stat?.isFile() ? { name, size: stat.size, usedAt: stat.mtimeMs } : null;
      }));
      return kept.filter(Boolean);
    },

    async remove(name) {
      if (NAME.test(String(name))) await fsp.rm(at(name, '.bin'), { force: true });
    },

    // Removes the store's files, and the folder when nothing else is in it.
    async clear() {
      const files = await fsp.readdir(directory()).catch(() => []);
      await Promise.all(files.filter(file => nameOf(file, '.bin') || nameOf(file, '.part'))
        .map(file => fsp.rm(path.join(directory(), file), { force: true }).catch(() => {})));
      await fsp.rmdir(directory()).catch(() => {});
    },
  };
}

module.exports = { createSpotifyAudioFiles };
