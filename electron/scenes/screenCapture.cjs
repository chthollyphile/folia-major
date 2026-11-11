const { createSenderGuardedHandler } = require('../ipcAccessGuard.cjs');

// electron/scenes/screenCapture.cjs
// A scene's surface as the user sees it (window.electron.sceneScreen): a small picture of a rect of the
// window, so a scene can light its room by what its screen shows (src/components/scenes/engine/surfaceSample.ts).
// The window is cut and scaled by the compositor; only the small picture crosses back.

/** Largest picture handed back, per side: a few colours are all a scene reads from it. */
const MAX_SIDE = 64;

const createSceneScreenHost = ({ ipcMain, isTrusted }) => {
    ipcMain.handle('scene-screen-capture', createSenderGuardedHandler({
        channel: 'scene-screen-capture',
        isTrusted,
        onUntrusted: () => null,
        handler: async (event, request) => {
            const { x, y, width, height, outWidth, outHeight } = request ?? {};
            if (![x, y, width, height, outWidth, outHeight].every(Number.isFinite)) return null;
            if (width < 1 || height < 1 || outWidth < 1 || outHeight < 1 || outWidth > MAX_SIDE || outHeight > MAX_SIDE) return null;
            const image = await event.sender.capturePage({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
            // A minimised or hidden window gives an empty picture: the scene keeps its last light.
            if (image.isEmpty()) return null;
            return image.resize({ width: Math.round(outWidth), height: Math.round(outHeight), quality: 'good' }).toPNG();
        },
    }));
};

module.exports = { createSceneScreenHost };
