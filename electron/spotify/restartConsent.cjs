// electron/spotify/restartConsent.cjs
// Whether the listener agreed to Folia restarting Spotify's own app, and the channel that carries
// that answer. The app is steered over its DevTools port, so a restart throws away the one Folia was
// talking to and the new one has to be found again: the listener is asked once, and the answer is
// kept in the main process's electron-store so a later run reads it instead of asking again. Unset
// means no - only a `true` written after the listener said yes counts, and the generic settings
// write in main.cjs refuses this key, so nothing else can stand in for the answer.

const SETTING_KEY = 'spotifyClientRestartConsented';

/** Whether the listener agreed, from what the store holds: anything but `true` is a no. */
const read = (store) => store.get(SETTING_KEY) === true;

/** Keeps the listener's yes. There is nothing to write for a no: the key stays unset. */
const grant = (store) => {
    store.set(SETTING_KEY, true);
    return true;
};

/**
 * Registers the channel. Only the main window may call it (the handler's first statement), and one
 * call both reads and answers: `true` records the agreement, no argument only asks.
 */
const registerRestartConsentIpc = ({ ipcMain, isTrustedSender, store }) => {
    ipcMain.handle('spotify-client-restart-consent', (event, granted) => {
        if (!isTrustedSender(event)) {
            throw new Error('Untrusted renderer attempted to read or grant the restart consent.');
        }
        if (granted === true) return grant(store);
        return read(store);
    });
};

module.exports = { SETTING_KEY, read, grant, registerRestartConsentIpc };
