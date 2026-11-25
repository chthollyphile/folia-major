'use strict';

const { createSenderGuardedHandler } = require('../ipcAccessGuard.cjs');
const { createMprisReader } = require('./mprisReader.cjs');

// MPRIS 源的 IPC：start/stop，快照和连接状态推回主窗口。

const START_CHANNEL = 'mpris:start';
const STOP_CHANNEL = 'mpris:stop';
const STATE_CHANNEL = 'mpris:state';
const STATUS_CHANNEL = 'mpris:status';

/** 只在 Linux 上调。dispose() 停轮询、关总线。 */
const registerMprisSourceIpc = ({
    ipcMain,
    isTrustedSender,
    getMainWindow,
    createReader = createMprisReader,
}) => {
    let reader = null;

    const sendToMainWindow = (channel, payload) => {
        const window = getMainWindow();
        if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
        window.webContents.send(channel, payload);
    };

    const handle = (channel, handler) => {
        ipcMain.handle(channel, createSenderGuardedHandler({ channel, isTrusted: isTrustedSender, handler }));
    };

    handle(START_CHANNEL, () => {
        if (!reader) {
            reader = createReader({
                onSnapshot: snapshot => sendToMainWindow(STATE_CHANNEL, snapshot),
                onStatus: status => sendToMainWindow(STATUS_CHANNEL, status),
            });
        }
        reader.start();
        return true;
    });

    handle(STOP_CHANNEL, () => {
        reader?.stop();
        reader = null;
        return true;
    });

    return {
        dispose: () => {
            reader?.stop();
            reader = null;
        },
        isRunning: () => Boolean(reader),
    };
};

module.exports = {
    START_CHANNEL,
    STOP_CHANNEL,
    STATE_CHANNEL,
    STATUS_CHANNEL,
    registerMprisSourceIpc,
};
