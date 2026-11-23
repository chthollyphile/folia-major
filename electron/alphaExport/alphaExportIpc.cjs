'use strict';

const path = require('path');
const { createSenderGuardedHandler } = require('../ipcAccessGuard.cjs');
const { findAlphaFormat } = require('./ffmpegCapabilities.cjs');

// electron/alphaExport/alphaExportIpc.cjs
// The IPC of the host's own transparent video export: which ffmpeg it uses (status, choosing a file,
// going back to the search) and running an export with it. The export itself is the mod export
// service's off-screen render (modSystem.runHostExport), which keeps the alpha channel; the main
// window's ordinary recording (MediaRecorder of the window) cannot. Channels are registered in
// dev/dedicatus/ipcChannels.mjs.

const PROGRESS_CHANNEL = 'video-export-alpha-progress';

/** What the renderer is told about the ffmpeg in use; the long candidate list stays in the main process. */
const toRendererStatus = (status) => ({
    available: Boolean(status?.available),
    source: status?.source ?? null,
    path: status?.path ?? null,
    version: status?.version ?? null,
    formats: Array.isArray(status?.formats) ? [...status.formats] : [],
    manualPath: status?.manualPath ?? null,
    manualProblem: status?.manualProblem ?? null,
    checked: Array.isArray(status?.checked) ? status.checked.map((item) => ({ ...item })) : [],
});

// The name carries no extension of its own (a title like "Mr. Brightside" keeps its dot).
const sanitizeFileName = (value, extension) => {
    const base = String(value ?? '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'folia-export';
    return `${base.slice(0, 120)}.${extension}`;
};

/*
 * registerAlphaExportIpc({ ipcMain, dialog, app, resolver, getModSystem, getMainWindow, getSenderWindow,
 *   isFirstParty(event), isMainWindowSender(event) })
 */
const registerAlphaExportIpc = ({
    ipcMain,
    dialog,
    app,
    resolver,
    getModSystem,
    getMainWindow,
    getSenderWindow,
    isFirstParty,
    isMainWindowSender,
}) => {
    // A cancel that arrives while the save dialog is open, before the export service has a session:
    // kept here and honoured once the dialog closes, instead of being lost.
    let hostExportStarting = false;
    let cancelWhileStarting = false;
    // The mods panel shows the same ffmpeg: its copy of the status is brought up to date too.
    const noteModsPanel = () => {
        void Promise.resolve(getModSystem()?.probeFfmpeg?.()).catch(() => {});
    };

    const guarded = (channel, handler) => createSenderGuardedHandler({ channel, isTrusted: isFirstParty, handler });
    const mainOnly = (channel, handler) => createSenderGuardedHandler({ channel, isTrusted: isMainWindowSender, handler });

    ipcMain.handle('video-export-ffmpeg-status', guarded('video-export-ffmpeg-status', async (_event, refresh) => {
        const status = await resolver.resolve({ refresh: refresh === true });
        if (refresh === true) noteModsPanel();
        return toRendererStatus(status);
    }));

    // Opens the system file dialog over the window that asked, and keeps the file only when it can export.
    ipcMain.handle('video-export-ffmpeg-choose', guarded('video-export-ffmpeg-choose', async (event) => {
        const parent = getSenderWindow(event) ?? getMainWindow();
        const options = {
            title: 'ffmpeg',
            properties: ['openFile'],
            ...(process.platform === 'win32' ? { filters: [{ name: 'ffmpeg', extensions: ['exe'] }] } : {}),
        };
        const picked = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
        if (picked.canceled || !picked.filePaths?.[0]) {
            return { canceled: true, ok: false, problem: null, status: toRendererStatus(await resolver.resolve()) };
        }
        const result = await resolver.chooseManual(picked.filePaths[0]);
        console.info(`[VideoExportFfmpeg] chosen file ${result.ok ? 'accepted' : `rejected (${result.problem})`}`);
        if (result.ok) noteModsPanel();
        return { canceled: false, ok: result.ok, problem: result.problem, status: toRendererStatus(result.status) };
    }));

    ipcMain.handle('video-export-ffmpeg-clear', guarded('video-export-ffmpeg-clear', async () => {
        const status = await resolver.clearManual();
        noteModsPanel();
        return toRendererStatus(status);
    }));

    /*
     * Runs one transparent export of what the main window shows now. `request`: { codec, width, height,
     * fps, startSec, endSec, defaultName }. Asks where to save first; resolves when the export ends:
     * { ok, canceled?, cancelled?, error?, outputPath?, warnings? }.
     */
    ipcMain.handle('video-export-alpha-start', mainOnly('video-export-alpha-start', async (_event, request) => {
        if (hostExportStarting) {
            return { ok: false, error: 'export-already-running' };
        }
        hostExportStarting = true;
        cancelWhileStarting = false;
        try {
            return await startHostExport(request);
        } finally {
            hostExportStarting = false;
            cancelWhileStarting = false;
        }
    }));

    const startHostExport = async (request) => {
        const modSystem = getModSystem();
        if (!modSystem?.runHostExport) {
            return { ok: false, error: 'export-unavailable' };
        }
        const status = await resolver.resolve();
        if (!status?.available) {
            return { ok: false, error: 'export-ffmpeg-not-found' };
        }
        const format = findAlphaFormat(request?.codec);
        if (!format || !status.formats.includes(format.id)) {
            return { ok: false, error: 'export-codec-unavailable' };
        }
        const mainWindow = getMainWindow();
        if (!mainWindow || mainWindow.isDestroyed()) {
            return { ok: false, error: 'export-unavailable' };
        }
        const saved = await dialog.showSaveDialog(mainWindow, {
            title: 'Save transparent video',
            defaultPath: path.join(app.getPath('videos'), sanitizeFileName(request?.defaultName, format.extension)),
            filters: [{ name: format.extension.toUpperCase(), extensions: [format.extension] }],
        });
        if (saved.canceled || !saved.filePath) {
            return { ok: false, canceled: true };
        }
        if (cancelWhileStarting) {
            return { ok: false, cancelled: true, error: 'export-cancelled' };
        }
        // A typed name with another extension (or a dot inside it) still gets the format's own.
        const outputPath = path.extname(saved.filePath).toLowerCase() === `.${format.extension}`
            ? saved.filePath
            : `${saved.filePath}.${format.extension}`;
        console.info(`[VideoExportAlpha] start ${format.id} ${request?.width}x${request?.height}@${request?.fps}`);
        const result = await modSystem.runHostExport({
            spec: {
                codec: format.id,
                width: request?.width,
                height: request?.height,
                fps: request?.fps,
                startSec: request?.startSec,
                endSec: request?.endSec,
                background: 'transparent',
            },
            outputPath,
            onProgress: (progress) => {
                const target = getMainWindow();
                if (target && !target.isDestroyed()) {
                    target.webContents.send(PROGRESS_CHANNEL, progress);
                }
            },
        });
        if (result.ok) {
            console.info(`[VideoExportAlpha] done: ${result.frameCount} frames, ${result.sizeBytes} bytes`);
        } else if (!result.cancelled) {
            console.warn(`[VideoExportAlpha] failed: ${result.error}`);
        }
        return result;
    };

    ipcMain.handle('video-export-alpha-cancel', mainOnly('video-export-alpha-cancel', () => {
        if (getModSystem()?.cancelExport?.()) {
            return { ok: true };
        }
        if (hostExportStarting) {
            cancelWhileStarting = true;
            return { ok: true };
        }
        return { ok: false };
    }));
};

module.exports = { registerAlphaExportIpc, toRendererStatus, PROGRESS_CHANNEL };
