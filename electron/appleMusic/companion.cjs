'use strict';

const { app, BrowserWindow, session, components } = require('electron');
const { isAllowedNavigation } = require('./companionNavigation.cjs');
const { storefrontTarget } = require('./companionStorefront.cjs');
const { validateRequest, createRequestDispatcher } = require('./companionRequests.cjs');
const { createSessionActions } = require('./companionSession.cjs');

// Accessory apps have no Dock/menu-bar presence but can still display the explicit login window.
if (process.platform === 'darwin') app.setActivationPolicy('accessory');

// The isolated Apple Music window. Its parent talks to it over the inherited IPC channel;
// everything else about the page stays inside this process and its own profile.
const PARTITION = 'persist:folia-apple-music';
const START_URL = 'https://music.apple.com/';
let window;
let documentGeneration = 0;
const sessionActions = createSessionActions({
    getWindow: () => window,
    getSession: () => session.fromPartition(PARTITION),
    invalidate: () => { documentGeneration++; },
    startUrl: START_URL,
});

// Only the process that launched this companion owns the inherited IPC channel.
const dispatch = createRequestDispatcher(
    () => window?.webContents, 20000, () => documentGeneration,
    contents => sessionActions.recover(contents),
);
process.on('message', async message => {
    const request = validateRequest(message);
    if (!request || typeof process.send !== 'function') return;
    let result;
    if (!window || window.isDestroyed()) result = { ok: false, error: 'not-ready' };
    else if (sessionActions.isBusy()) result = { ok: false, error: sessionActions.isRecovering() ? 'not-ready' : 'busy' };
    else if (request.operation === 'showWindow') {
        window.show();
        window.focus();
        for (const child of BrowserWindow.getAllWindows()) {
            if (child !== window) { child.show(); child.focus(); }
        }
        result = { ok: true, data: {} };
    } else if (request.operation === 'hideWindow') {
        for (const ownedWindow of BrowserWindow.getAllWindows()) ownedWindow.hide();
        result = { ok: true, data: {} };
    } else if (request.operation === 'logout') result = await sessionActions.logout();
    else result = await dispatch(request);
    // The account's storefront is the one MusicKit can play against. The page may have been opened
    // in another region, so follow the account before answering: the caller's next request has to
    // find a page that is ready on that storefront.
    if (request.operation === 'accountStatus' && result.ok && window && !window.isDestroyed()) {
        const target = storefrontTarget(window.webContents.getURL(), result.data?.storefront);
        if (target) {
            console.info('[AppleMusic] following the account storefront', result.data.storefront);
            try {
                await window.loadURL(target);
            } catch (error) {
                console.warn('[AppleMusic] could not open the account storefront', error);
            }
        }
    }
    if (process.connected) process.send({ id: request.id, ...result }, () => {});
});
process.on('disconnect', () => app.quit());

// Prevent a remote page from navigating this window or opening an arbitrary external site.
function restrictNavigation(contents) {
    const rejectUntrusted = (event, url) => {
        if (!isAllowedNavigation(url)) event.preventDefault();
    };
    contents.on('will-navigate', rejectUntrusted);
    contents.on('will-redirect', rejectUntrusted);
    contents.setWindowOpenHandler(({ url }) => {
        // A background session must not create a visible login popup without an explicit login action.
        if (!isAllowedNavigation(url) || !window?.isVisible()) return { action: 'deny' };
        return {
            action: 'allow',
            overrideBrowserWindowOptions: {
                skipTaskbar: true,
                webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, plugins: true, backgroundThrottling: false },
            },
        };
    });
    contents.on('did-create-window', child => restrictNavigation(child.webContents));
}

app.whenReady().then(async () => {
    // CastLabs Electron installs the Widevine CDM on first launch through its component updater:
    // a page opened before it is ready cannot play DRM-protected audio. Stock Electron has no
    // `components` API, and there is nothing to wait for.
    if (components?.whenReady) {
        try {
            await components.whenReady();
            console.info('[AppleMusic] Widevine components ready', components.status?.());
        } catch (error) {
            console.warn('[AppleMusic] Widevine components did not become ready', error);
        }
    }
    const browserSession = session.fromPartition(PARTITION);
    window = new BrowserWindow({
        width: 1120,
        height: 760,
        show: false,
        skipTaskbar: true,
        webPreferences: { session: browserSession, sandbox: true, contextIsolation: true, nodeIntegration: false, plugins: true, backgroundThrottling: false },
    });
    restrictNavigation(window.webContents);
    // Only fixed diagnostic labels leave the remote page; error strings can contain credentials or URLs.
    window.webContents.on('console-message', (...args) => {
        const event = args[0];
        const message = typeof event?.message === 'string' ? event.message : args[2];
        const text = String(message);
        if (text === '[AppleMusic] Playback stage: queue' || text === '[AppleMusic] Playback stage: play') console.info(text);
        else if (text.startsWith('[AppleMusic] Playback command rejected')) console.warn('[AppleMusic] Page playback command rejected');
        else if (/widevine|decrypt|drm|license/i.test(text)) console.warn('[AppleMusic] Page reported a DRM-related message');
    });
    window.webContents.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => {
        // History changes inside Apple Music do not replace its player or pending commands.
        if (isMainFrame && !inPlace) documentGeneration++;
    });
    window.on('closed', () => { window = null; });
    await window.loadURL(START_URL);
    console.info('[AppleMusic] Companion window opened');
}).catch(error => {
    console.error('[AppleMusic] Companion could not start', error);
    app.quit();
});

app.on('window-all-closed', () => app.quit());
