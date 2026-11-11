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
    try {
        store.set(SETTING_KEY, true);
    } catch { /* read below says whether it went */ }
    return read(store);
};

/**
 * Takes the yes back (the settings row): the key goes, so the next player this app has to close is
 * asked about again. Answers what the store holds afterwards rather than what was asked for: a store
 * that could not clear the key still has the yes in force, and the switch that is drawn from this
 * answer has to show the agreement that is really there instead of a no that never landed.
 */
const revoke = (store) => {
    try {
        store.delete(SETTING_KEY);
    } catch { /* read below says whether it went */ }
    return read(store);
};

/**
 * Registers the channel. Only the main window may call it (the handler's first statement), and one
 * call both reads and answers: `true` records the agreement, `false` takes it back, no argument only
 * asks. Every answer is what the store holds afterwards, so a write that did not land is never
 * reported as done.
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
