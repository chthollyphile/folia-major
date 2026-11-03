// electron/modSystem/pickedFiles.cjs
// `folium.ui.pickFile`, `restoreFile` and `releaseFile`: the files a user
// picked for a mod in a native dialog, each handed to the mod as a
// folia-mod://_files/<token>/<name> URL. Which token stands for which file is
// kept here, for this run of the app. Cut out of modSystem.cjs.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { dialog } = require('electron');

// folium.ui.pickFile dialog filters.
const PICK_FILE_FILTERS = {
    video: [{ name: 'Video', extensions: ['mp4', 'm4v', 'webm', 'mov', 'mkv'] }],
    audio: [{ name: 'Audio', extensions: ['mp3', 'm4a', 'flac', 'ogg', 'wav'] }],
    image: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'] }],
    any: [],
};

/*
 * All three are the loader's: `requireLoadedMod(modId)` gives the running mod
 * of that id or throws, `fileGrants` is the stored list of files a mod may
 * open again in a later run (fileGrants.cjs), and `getMainWindowSafe` gives the
 * window the dialog belongs to.
 */
const createPickedFiles = ({ requireLoadedMod, fileGrants, getMainWindowSafe }) => {
    /*
     * folium.ui.pickFile: the user chooses the file in a native dialog, so no
     * permission is involved; the mod only ever gets an unguessable
     * folia-mod://_files/<token>/<name> URL, valid until the app quits.
     * With `persist` the pick is also recorded as a file grant (fileGrants.cjs)
     * and the handle carries its opaque id for folium.ui.restoreFile.
     */
    const pickedFiles = new Map();
    // `${modId}:${grantId}` -> session token, so restoring a grant twice in one
    // session yields the same URL (a media element does not reload for nothing).
    const grantTokens = new Map();

    const issueFileHandle = (filePath, token = crypto.randomBytes(18).toString('hex')) => {
        const stat = fs.statSync(filePath);
        pickedFiles.set(token, filePath);
        const name = path.basename(filePath);
        return {
            token,
            handle: {
                url: `folia-mod://_files/${token}/${encodeURIComponent(name)}`,
                name,
                size: stat.size,
            },
        };
    };

    const invokeModPickFile = async (modId, accept, persist) => {
        requireLoadedMod(modId);
        const win = getMainWindowSafe();
        const options = {
            properties: ['openFile'],
            filters: PICK_FILE_FILTERS[accept] ?? PICK_FILE_FILTERS.any,
        };
        const result = win && !win.isDestroyed()
            ? await dialog.showOpenDialog(win, options)
            : await dialog.showOpenDialog(options);
        const filePath = result.canceled ? null : result.filePaths[0];
        if (!filePath) {
            return { ok: true, result: null };
        }
        const { token, handle } = issueFileHandle(filePath);
        if (persist !== true) {
            return { ok: true, result: handle };
        }
        const grantId = fileGrants.add(modId, filePath);
        grantTokens.set(`${modId}:${grantId}`, token);
        return { ok: true, result: { ...handle, grantId } };
    };

    /*
     * folium.ui.restoreFile: a grant this mod holds back as a session URL, or
     * null when the grant is unknown, belongs to another mod, or its file is
     * gone (such a grant is dropped).
     */
    const invokeModRestoreFile = (modId, grantId) => {
        requireLoadedMod(modId);
        const filePath = fileGrants.resolve(modId, grantId);
        if (!filePath) {
            grantTokens.delete(`${modId}:${grantId}`);
            return { ok: true, result: null };
        }
        const cacheKey = `${modId}:${grantId}`;
        const cachedToken = grantTokens.get(cacheKey);
        const { token, handle } = issueFileHandle(
            filePath,
            cachedToken && pickedFiles.get(cachedToken) === filePath ? cachedToken : undefined,
        );
        grantTokens.set(cacheKey, token);
        return { ok: true, result: { ...handle, grantId } };
    };

    // folium.ui.releaseFile: the grant is forgotten; URLs already handed out stay valid this session.
    const invokeModReleaseFile = (modId, grantId) => {
        requireLoadedMod(modId);
        grantTokens.delete(`${modId}:${grantId}`);
        return { ok: true, result: fileGrants.release(modId, grantId) };
    };

    /** The file a token of a folia-mod://_files/ URL stands for, or null: the protocol handler asks. */
    const resolvePickedFile = (token) => pickedFiles.get(token) ?? null;

    return { invokeModPickFile, invokeModRestoreFile, invokeModReleaseFile, resolvePickedFile };
};

module.exports = { createPickedFiles, PICK_FILE_FILTERS };
