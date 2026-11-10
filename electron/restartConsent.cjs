// electron/restartConsent.cjs
// Whether the listener agreed to Folia restarting the external player's own app, and the channel
// that carries that answer. Such a player is steered over its DevTools port, so a restart throws
// away the one Folia was talking to and the new one has to be found again: the listener is asked
// once, and the answer is kept in the main process's electron-store so a later run reads it instead
// of asking again. Unset means no - only a `true` written after the listener said yes counts, and
// the generic settings write in main.cjs refuses this key, so nothing else can stand in for it.
// Its name says what the answer is about rather than which player asked first: a first-party app
// steered over its DevTools port is any of them.

const SETTING_KEY = 'externalPlayerRestartConsented';

/** Whether the listener agreed, from what the store holds: anything but `true` is a no. */
const read = (store) => store.get(SETTING_KEY) === true;

/** Keeps the listener's yes. There is nothing to write for a no: the key stays unset. */
const grant = (store) => {
    store.set(SETTING_KEY, true);
    return true;
};

/** Takes the yes back (the settings row): the key goes, so the next player this app has to close is asked about again. */
const revoke = (store) => {
    store.delete(SETTING_KEY);
    return false;
};

/**
 * Registers the channel. Only the main window may call it (the handler's first statement), and one
 * call both reads and answers: `true` records the agreement, `false` takes it back, no argument only
 * asks.
 */
const registerRestartConsentIpc = ({ ipcMain, isTrustedSender, store }) => {
    ipcMain.handle('external-player-restart-consent', (event, granted) => {
        if (!isTrustedSender(event)) {
            throw new Error('Untrusted renderer attempted to read or grant the restart consent.');
        }
        if (granted === true) return grant(store);
        if (granted === false) return revoke(store);
        return read(store);
    });
};

module.exports = { SETTING_KEY, read, grant, revoke, registerRestartConsentIpc };
