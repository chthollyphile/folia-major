// electron/audioCacheRemove.cjs
// Deletes one song's cached audio, but only the file the renderer read. Playback reads a copy,
// measures it and then asks for it to go (it was less than the song); the end-of-song writer may
// write the song's whole file there in the meantime, and that file must stay. The renderer knows
// the size of what it read, so a file of another size is a newer one, and is left.

const fs = require('fs');

const fsp = fs.promises;

/**
 * Resolves to whether the file was deleted: false where it is not the file read (or not there).
 * Rejects where it could not be deleted (on Windows a file held open answers EBUSY or EPERM): the
 * copy is still there, so its metadata stays too, and the caller keeps its level and says so.
 */
const removeAudioCacheFileOfSize = async (dataPath, metaPath, size) => {
    try {
        const stat = await fsp.stat(dataPath);
        if (!Number.isInteger(size) || stat.size !== size) return false;
    } catch {
        return false;
    }
    await fsp.rm(dataPath, { force: true });
    // The metadata names a file that is gone: a failure to delete it leaves only a stray note.
    await fsp.rm(metaPath, { force: true }).catch(() => { });
    return true;
};

module.exports = { removeAudioCacheFileOfSize };
