import { createRequire } from 'module';
import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/electron/voiceInputPause.test.ts
// Locks down Windows microphone ConsentStore parsing and the monitor debounce.

const require = createRequire(import.meta.url);
const { createVoiceInputPauseMonitor, parseMicrophoneConsentStoreInUse } = require('../../../electron/voiceInputPause.cjs') as {
    createVoiceInputPauseMonitor: (options: {
        getMainWindow: () => { isDestroyed: () => boolean; webContents: { send: (channel: string, payload: unknown) => void; }; } | null;
        isEnabled: () => boolean;
        getOwnExePath: () => string;
        isSupported: boolean;
        pollIntervalMs?: number;
        queryInUse: (ownExePath: string) => Promise<boolean | null>;
    }) => {
        getStatus: () => { active: boolean; enabled: boolean; supported: boolean; };
        stop: () => void;
        syncState: () => { active: boolean; enabled: boolean; supported: boolean; };
    };
    parseMicrophoneConsentStoreInUse: (output: string, ownExePath: string) => boolean;
};

const CONSENT_STORE_HEADER = 'HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';

const buildRegOutput = (entries: Array<{ subKey: string; start: string; stop: string; }>) => [
    CONSENT_STORE_HEADER,
    ...entries.flatMap(({ subKey, start, stop }) => [
        `${CONSENT_STORE_HEADER}\\${subKey}`,
        `    LastUsedTimeStart    REG_QWORD    ${start}`,
        `    LastUsedTimeStop    REG_QWORD    ${stop}`,
        '',
    ]),
    'End of search: 1 match(es) found.',
].join('\r\n');

describe('parseMicrophoneConsentStoreInUse', () => {
    it('detects an actively capturing app (stop == 0 with a real start)', () => {
        const output = buildRegOutput([
            { subKey: 'Microsoft.Windows.ShellExperienceHost_cw5n1h2txyewy', start: '0x1dc1234abcd0000', stop: '0x0' },
        ]);

        expect(parseMicrophoneConsentStoreInUse(output, 'C:\\Apps\\Folia.exe')).toBe(true);
    });

    it('ignores apps whose capture session already ended', () => {
        const output = buildRegOutput([
            { subKey: 'Microsoft.Windows.ShellExperienceHost_cw5n1h2txyewy', start: '0x1dc1234abcd0000', stop: '0x1dc1234abce0000' },
        ]);

        expect(parseMicrophoneConsentStoreInUse(output, 'C:\\Apps\\Folia.exe')).toBe(false);
    });

    it('ignores entries that never started capturing', () => {
        const output = buildRegOutput([
            { subKey: 'Some.Packaged.App_abc123', start: '0x0', stop: '0x0' },
        ]);

        expect(parseMicrophoneConsentStoreInUse(output, 'C:\\Apps\\Folia.exe')).toBe(false);
    });

    it('excludes the Folia process itself from NonPackaged entries', () => {
        const output = buildRegOutput([
            { subKey: 'NonPackaged\\C:#Program Files#Folia#Folia.exe', start: '0x1dc1234abcd0000', stop: '0x0' },
        ]);

        expect(parseMicrophoneConsentStoreInUse(output, 'C:\\Program Files\\Folia\\Folia.exe')).toBe(false);
    });

    it('still reports other apps capturing alongside the Folia process', () => {
        const output = buildRegOutput([
            { subKey: 'NonPackaged\\C:#Program Files#Folia#Folia.exe', start: '0x1dc1234abcd0000', stop: '0x0' },
            { subKey: 'NonPackaged\\C:#IME#sogou#SogouVoice.exe', start: '0x1dc1234abcd0000', stop: '0x0' },
        ]);

        expect(parseMicrophoneConsentStoreInUse(output, 'C:\\Program Files\\Folia\\Folia.exe')).toBe(true);
    });

    it('treats empty or malformed output as not in use', () => {
        expect(parseMicrophoneConsentStoreInUse('', 'C:\\Apps\\Folia.exe')).toBe(false);
        expect(parseMicrophoneConsentStoreInUse('ERROR: The system was unable to find the specified registry key or value.', 'C:\\Apps\\Folia.exe')).toBe(false);
    });
});

describe('createVoiceInputPauseMonitor', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    const createHarness = (options: { enabled?: boolean; } = {}) => {
        let inUse = false;
        let enabled = options.enabled ?? true;
        const sent: Array<{ active: boolean; }> = [];
        const win = {
            isDestroyed: () => false,
            webContents: {
                send: (_channel: string, payload: unknown) => {
                    sent.push(payload as { active: boolean; });
                },
            },
        };
        const monitor = createVoiceInputPauseMonitor({
            getMainWindow: () => win,
            isEnabled: () => enabled,
            getOwnExePath: () => 'C:\\Apps\\Folia.exe',
            isSupported: true,
            pollIntervalMs: 1000,
            queryInUse: async () => inUse,
        });

        return {
            monitor,
            sent,
            setInUse: (value: boolean) => {
                inUse = value;
            },
            setEnabled: (value: boolean) => {
                enabled = value;
            },
        };
    };

    it('publishes active after consecutive in-use samples and resumes after consecutive free samples', async () => {
        vi.useFakeTimers();
        const { monitor, sent, setInUse } = createHarness();

        monitor.syncState();
        await vi.advanceTimersByTimeAsync(0);
        expect(monitor.getStatus().active).toBe(false);

        setInUse(true);
        await vi.advanceTimersByTimeAsync(1000);
        expect(sent).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(1000);
        expect(sent).toHaveLength(1);
        expect(sent[0].active).toBe(true);
        expect(monitor.getStatus().active).toBe(true);

        setInUse(false);
        await vi.advanceTimersByTimeAsync(2000);
        expect(sent).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(1000);
        expect(sent).toHaveLength(2);
        expect(sent[1].active).toBe(false);
        expect(monitor.getStatus().active).toBe(false);

        monitor.stop();
    });

    it('ignores single-sample blips without flipping state', async () => {
        vi.useFakeTimers();
        const { monitor, sent, setInUse } = createHarness();

        monitor.syncState();
        await vi.advanceTimersByTimeAsync(0);

        setInUse(true);
        await vi.advanceTimersByTimeAsync(1000);
        setInUse(false);
        await vi.advanceTimersByTimeAsync(5000);

        expect(sent).toHaveLength(0);
        expect(monitor.getStatus().active).toBe(false);

        monitor.stop();
    });

    it('releases the active state when the feature is disabled mid-dictation', async () => {
        vi.useFakeTimers();
        const { monitor, sent, setInUse, setEnabled } = createHarness();

        monitor.syncState();
        await vi.advanceTimersByTimeAsync(0);

        setInUse(true);
        await vi.advanceTimersByTimeAsync(2000);
        expect(monitor.getStatus().active).toBe(true);

        setEnabled(false);
        monitor.syncState();
        expect(monitor.getStatus().active).toBe(false);
        expect(sent[sent.length - 1].active).toBe(false);

        monitor.stop();
    });

    it('does not poll while unsupported', async () => {
        vi.useFakeTimers();
        let queryCount = 0;
        const monitor = createVoiceInputPauseMonitor({
            getMainWindow: () => null,
            isEnabled: () => true,
            getOwnExePath: () => 'C:\\Apps\\Folia.exe',
            isSupported: false,
            pollIntervalMs: 1000,
            queryInUse: async () => {
                queryCount += 1;
                return true;
            },
        });

        monitor.syncState();
        await vi.advanceTimersByTimeAsync(5000);

        expect(queryCount).toBe(0);
        expect(monitor.getStatus().active).toBe(false);

        monitor.stop();
    });
});
