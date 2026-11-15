// electron/updateDownloadPhase.cjs
// Tells which of the updater's two downloads a progress event belongs to. On Windows the updater first
// fetches only the blocks that changed since the installed version (a differential download); when that
// fails it starts over with the whole installer, and both report as plain download progress. The two
// are told apart by size: the differential one counts only the changed blocks, so its total is smaller
// than the installer's. When nearly every block changed, the differential total can reach the installer
// size: that download then reads as a full one, and a fallback after it is not marked.

// The installer's size as the update metadata gives it: the first .exe file, as the updater picks it.
function getInstallerSize(info) {
    const files = Array.isArray(info?.files) ? info.files : [];
    const installer = files.find((file) => typeof file?.url === 'string' && file.url.toLowerCase().endsWith('.exe'));
    const size = installer?.size;
    return typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : null;
}

// Follows one download of an update. `mode` is 'differential' or 'full', or null when the size to compare
// with is unknown; `fallback` says a full download came after a differential one, which therefore failed.
function createUpdateDownloadPhase() {
    let installerSize = null;
    let installerVersion = null;
    let sawDifferential = false;

    return {
        // A found update: its installer size. Finding the same one again (a check during its download)
        // keeps what the running download has shown so far.
        setInstaller(info) {
            const size = getInstallerSize(info);
            const version = typeof info?.version === 'string' ? info.version : null;
            if (size !== installerSize || version !== installerVersion) {
                sawDifferential = false;
            }
            installerSize = size;
            installerVersion = version;
        },
        // A download of the same update starts again from the beginning.
        restart() {
            sawDifferential = false;
        },
        phaseOf(progress) {
            const total = progress?.total;
            const hasTotal = typeof total === 'number' && Number.isFinite(total) && total > 0;
            let mode = null;
            if (installerSize !== null && hasTotal) {
                mode = total < installerSize ? 'differential' : 'full';
            } else if (sawDifferential) {
                // A full download whose length the server did not say still follows a failed differential one.
                mode = 'full';
            }
            const fallback = mode === 'full' && sawDifferential;
            if (mode === 'differential') {
                sawDifferential = true;
            }
            return { mode, fallback };
        },
    };
}

module.exports = {
    createUpdateDownloadPhase,
    getInstallerSize,
};
