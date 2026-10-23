// electron/modSystem/safeStart.cjs
// The start note, and the two questions asked when mods may be what keeps the
// app from working.
//
// A mod's code runs inside the app. One that freezes or crashes it while the
// app starts would do so again on every start, and the switch that turns the
// mod off is inside the app. So a note is written to disk when mods begin to
// start, and taken up again when the window reports that every client has
// started and the first screen is up. A note that is still there at the next
// start means that start never got to its end: Folia then asks, before any mod
// code runs, whether to start without mods this time.
//
// Only a start that went wrong is to leave the note: the app killed, crashed
// or stuck. Leaving the app the normal way while the start is merely not over
// yet (a slow mod takes seconds) takes the note up too. What tells the two
// apart on the way out is the page itself: while the start is under way it
// says once a second that it is answering. A page that has gone quiet may be
// stuck on a mod, and then the note stays, also when the user gets out through
// the tray or the system shuts down. It stays as well when the page failed to
// load or its process ended in this run.
//
// A note that cannot be removed (a locked file, a folder that refuses) is
// written off in a second file by the time it carries, so the same note is not
// read as a failed start at every start from then on.
//
// The second question is for a window that stops answering while mods run: keep
// waiting, or reopen the window without mods.
//
// Both answers hold for this run of the app only and write no setting. Both
// questions are native dialogs of the main process: the first comes before the
// page has drawn anything, the second when the page cannot draw.

'use strict';

const fs = require('fs');
const path = require('path');

const NOTE_FILE = 'mod-start-note.json';
// Which note was written off because it could not be removed: { startedAt }.
const WRITTEN_OFF_FILE = 'mod-start-note-written-off.json';
// The page says it is answering once a second while the start is under way
// (src/mods/runtime/mainWindowStart.ts). Quiet for longer than this, it may be stuck.
const PAGE_QUIET_LIMIT_MS = 3000;

// Native dialog copy. The main process cannot reach the renderer's i18n bundle,
// so the four shipped locales are mirrored here, as for the trust dialog.
const SAFE_START_LOCALE = {
    'zh-CN': {
        startMessage: 'Folia 上次没有启动完。',
        startDetail: '可能是某个模组造成的。这次要不要不带模组启动？只管这一次：设置不会变，下次打开 Folia 时模组照常启动。',
        startWithout: '这次不带模组启动',
        startAsUsual: '照常启动',
        stuckMessage: 'Folia 的窗口没有反应了。',
        stuckDetail: '可能是某个模组卡住了。可以继续等，也可以不带模组重新打开窗口。重新打开只管这一次：设置不会变，下次打开 Folia 时模组照常启动。',
        stuckWait: '继续等',
        stuckReopen: '不带模组重新打开',
    },
    'zh-TW': {
        startMessage: 'Folia 上次沒有啟動完。',
        startDetail: '可能是某個模組造成的。這次要不要不帶模組啟動？只管這一次：設定不會變，下次開啟 Folia 時模組照常啟動。',
        startWithout: '這次不帶模組啟動',
        startAsUsual: '照常啟動',
        stuckMessage: 'Folia 的視窗沒有反應了。',
        stuckDetail: '可能是某個模組卡住了。可以繼續等，也可以不帶模組重新開啟視窗。重新開啟只管這一次：設定不會變，下次開啟 Folia 時模組照常啟動。',
        stuckWait: '繼續等',
        stuckReopen: '不帶模組重新開啟',
    },
    en: {
        startMessage: 'Folia did not finish starting last time.',
        startDetail: 'A mod may have caused it. Start without mods this time? This is for this time only: no setting changes, and mods start as usual the next time Folia opens.',
        startWithout: 'Start without mods',
        startAsUsual: 'Start as usual',
        stuckMessage: 'The Folia window has stopped answering.',
        stuckDetail: 'A mod may be stuck. You can keep waiting, or reopen the window without mods. Reopening is for this time only: no setting changes, and mods start as usual the next time Folia opens.',
        stuckWait: 'Keep waiting',
        stuckReopen: 'Reopen without mods',
    },
    in: {
        startMessage: 'Folia tidak selesai dimulai terakhir kali.',
        startDetail: 'Mungkin penyebabnya sebuah mod. Mulai tanpa mod kali ini? Hanya untuk kali ini: tidak ada pengaturan yang berubah, dan mod berjalan seperti biasa saat Folia dibuka berikutnya.',
        startWithout: 'Mulai tanpa mod',
        startAsUsual: 'Mulai seperti biasa',
        stuckMessage: 'Jendela Folia tidak merespons.',
        stuckDetail: 'Mungkin ada mod yang macet. Anda bisa terus menunggu, atau membuka ulang jendela tanpa mod. Membuka ulang hanya untuk kali ini: tidak ada pengaturan yang berubah, dan mod berjalan seperti biasa saat Folia dibuka berikutnya.',
        stuckWait: 'Terus menunggu',
        stuckReopen: 'Buka ulang tanpa mod',
    },
    vi: {
        startMessage: 'Folia không hoàn tất khởi động ở lần mở trước.',
        startDetail: 'Sự cố có thể do một mod gây ra. Bạn có muốn khởi động không kèm mod lần này không? Lựa chọn này chỉ áp dụng cho lần này: cài đặt không đổi, và các mod sẽ khởi động bình thường vào lần mở Folia tiếp theo.',
        startWithout: 'Khởi động không kèm mod',
        startAsUsual: 'Khởi động như thường lệ',
        stuckMessage: 'Cửa sổ Folia không phản hồi.',
        stuckDetail: 'Có thể một mod đang bị treo. Bạn có thể tiếp tục đợi, hoặc mở lại cửa sổ mà không kèm mod. Mở lại chỉ áp dụng cho lần này: cài đặt không đổi, và các mod sẽ khởi động bình thường vào lần mở Folia tiếp theo.',
        stuckWait: 'Tiếp tục đợi',
        stuckReopen: 'Mở lại không kèm mod',
    },
};

/*
 * `directory` is where the note lives (the app's userData). `dialog` is
 * Electron's; `getLocaleKey` and `getWindow` may be absent or throw.
 */
const createSafeStart = ({ directory, dialog, getLocaleKey, getWindow }) => {
    const notePath = path.join(directory, NOTE_FILE);
    const writtenOffPath = path.join(directory, WRITTEN_OFF_FILE);
    // This run wrote a note and it is still down.
    let noteDown = false;
    // When the window's page last said it was answering during this start; null before it began.
    let pageHeardAt = null;
    // The window's page failed to load, or its process ended, in this run.
    let pageFailed = false;

    const readJson = (file) => {
        try {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch {
            return null;
        }
    };

    // What tells one note from another: when its start began. A note without it (empty, made by hand) has ''.
    const noteStamp = () => {
        const note = readJson(notePath);
        return note && typeof note.startedAt === 'string' ? note.startedAt : '';
    };

    const locale = () => {
        try {
            const key = typeof getLocaleKey === 'function' ? getLocaleKey() : null;
            return SAFE_START_LOCALE[key] ?? SAFE_START_LOCALE.en;
        } catch {
            return SAFE_START_LOCALE.en;
        }
    };

    const show = async (win, options) => {
        const result = win && !win.isDestroyed()
            ? await dialog.showMessageBox(win, options)
            : await dialog.showMessageBox(options);
        return result.response;
    };

    /**
     * Whether the note of an earlier start is still there: that start never got to its end.
     * A note that was written off (it could not be removed) does not count.
     */
    const isNoteLeft = () => {
        try {
            if (!fs.existsSync(notePath)) {
                return false;
            }
        } catch {
            return false;
        }
        const writtenOff = readJson(writtenOffPath);
        return !(writtenOff && writtenOff.startedAt === noteStamp());
    };

    /** Mods begin to start. Written at once, so it is on disk if the app dies in the next moment. */
    const writeNote = () => {
        try {
            fs.mkdirSync(directory, { recursive: true });
            fs.writeFileSync(notePath, JSON.stringify({ startedAt: new Date().toISOString() }));
            noteDown = true;
        } catch (error) {
            // Without the note the next start simply does not ask.
            console.warn('[Mods] Could not write the start note', error);
        }
    };

    /** The start got to its end, the app is left the normal way, or the note was answered. */
    const clearNote = () => {
        noteDown = false;
        try {
            fs.rmSync(notePath, { force: true });
        } catch (error) {
            console.warn('[Mods] Could not remove the start note; writing it off instead', error);
            // It stays on disk. Written off by the time it carries, or every start from now on
            // would read it as a start that did not finish and ask.
            try {
                fs.writeFileSync(writtenOffPath, JSON.stringify({ startedAt: noteStamp() }));
            } catch (writeError) {
                console.warn('[Mods] Could not write the start note off either', writeError);
            }
            return;
        }
        try {
            // No note is left, so none is written off any more.
            fs.rmSync(writtenOffPath, { force: true });
        } catch {
            // It only matters while a note with the same time exists.
        }
    };

    /** This run's note stays where it is, whatever is reported from now on: a start with mods never got to its end. */
    const leaveNote = () => {
        noteDown = false;
    };

    /** The window's page says it is answering: once a second while its start is under way. */
    const notePageAnswering = () => {
        pageHeardAt = Date.now();
    };

    /**
     * The window's page did not load, or its process ended (a crash, a kill from outside). While
     * this run's note is down that is a start that went wrong, whatever the page said before and
     * whatever a page loaded in its place says after: only the end of a start takes the note up.
     */
    const notePageFailed = () => {
        pageFailed = true;
    };

    /**
     * The app is being left the normal way (quit by the user, the system shutting down, a restart
     * for an update, the window closed where that leaves the app running). A start that is merely
     * not over yet did not go wrong, so this run's note is taken up. It stays when the page has
     * begun starting the mods and has since gone quiet (it may be stuck on one, and that is what
     * the note is for), and when the page failed in this run (`notePageFailed`).
     */
    const noteNormalQuit = () => {
        if (!noteDown || pageFailed) {
            return;
        }
        if (pageHeardAt !== null && Date.now() - pageHeardAt > PAGE_QUIET_LIMIT_MS) {
            return;
        }
        clearNote();
    };

    /**
     * Asks whether to start without mods this time. Resolves true for "without".
     * Closing the dialog counts as "without": that start is the one that cannot
     * go wrong the same way again.
     */
    const askStartWithoutMods = async () => {
        const text = locale();
        let win = null;
        try {
            win = typeof getWindow === 'function' ? getWindow() : null;
        } catch {
            win = null;
        }
        const response = await show(win, {
            type: 'warning',
            message: text.startMessage,
            detail: text.startDetail,
            buttons: [text.startWithout, text.startAsUsual],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
        });
        return response !== 1;
    };

    /**
     * Asks, for a window that stopped answering, whether to reopen it without
     * mods. Resolves true for "reopen". Waiting is the default, and what an
     * aborted `signal` (the window answers again) comes out as.
     */
    const askReopenWithoutMods = async (win, signal) => {
        const text = locale();
        const response = await show(win, {
            type: 'warning',
            message: text.stuckMessage,
            detail: text.stuckDetail,
            buttons: [text.stuckWait, text.stuckReopen],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
            signal,
        });
        return response === 1;
    };

    return {
        isNoteLeft,
        writeNote,
        clearNote,
        leaveNote,
        notePageAnswering,
        notePageFailed,
        noteNormalQuit,
        askStartWithoutMods,
        askReopenWithoutMods,
    };
};

module.exports = { createSafeStart, NOTE_FILE, WRITTEN_OFF_FILE, PAGE_QUIET_LIMIT_MS };
