// test/unit/mod-system/mainWindowFake.ts
// A main window for loader tests that call its IPC handlers. Folium 2.0 (plan §5.4): every folia-mods:*
// handler answers the main window's main frame only, so a test hands the loader this window
// (`getMainWindow: () => MAIN_WINDOW`) and calls the handlers with FROM_MAIN_WINDOW as the event.

/** What the window's page sent through `webContents.send`, as [channel, payload]. */
export const sentToMainWindow: Array<[string, unknown]> = [];

const mainFrame = Object.freeze({ name: 'main frame' });

const webContents = {
    mainFrame,
    isDestroyed: () => false,
    send: (channel: string, payload: unknown) => {
        sentToMainWindow.push([channel, payload]);
    },
};

export const MAIN_WINDOW = Object.freeze({ isDestroyed: () => false, webContents });

/** The event of a request from the main window's main frame. */
export const FROM_MAIN_WINDOW = Object.freeze({ sender: webContents, senderFrame: mainFrame });

/** A request from a sub-frame of the main window (a mod's `ui.embed` page). */
export const FROM_MAIN_WINDOW_SUBFRAME = Object.freeze({ sender: webContents, senderFrame: Object.freeze({ name: 'sub-frame' }) });

/** A request from some other window (the remote control, a popup). */
export const FROM_OTHER_WINDOW = Object.freeze({ sender: { mainFrame: {} }, senderFrame: {} });
