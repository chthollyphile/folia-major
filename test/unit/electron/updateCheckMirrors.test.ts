import { describe, expect, it } from 'vitest';

// test/unit/electron/updateCheckMirrors.test.ts
// The update check's fallback to public GitHub proxies: which URLs it reads, in what order, and what it
// accepts from them.

type ReadText = (url: string, signal: AbortSignal) => Promise<string>;

const {
    UPDATE_CHECK_MIRROR_PREFIXES,
    discoverUpdateVersion,
    getUpdateMetadataMirrorUrls,
    readFirstUpdateMetadataVersion,
    settleWithin,
} = require('../../../electron/updateCheckMirrors.cjs') as {
    UPDATE_CHECK_MIRROR_PREFIXES: string[];
    discoverUpdateVersion: (options: {
        githubUrl: string;
        readText: ReadText;
        githubError?: unknown;
        timeoutMs?: number;
        logger?: Pick<Console, 'info' | 'warn'>;
    }) => Promise<{ version: string; via: 'github' | 'mirror' }>;
    settleWithin: <T>(promise: Promise<T>, ms: number, message: string) => Promise<T>;
    getUpdateMetadataMirrorUrls: (githubUrl: string, prefixes?: string[]) => string[];
    readFirstUpdateMetadataVersion: (
        urls: string[],
        readText: (url: string, signal: AbortSignal) => Promise<string>,
        timeoutMs: number,
    ) => Promise<{ url: string; version: string }>;
};

const LATEST_YML = 'https://github.com/chthollyphile/folia-major/releases/latest/download/latest.yml';
const quietLogger = { info: () => {}, warn: () => {} };

const wait = (ms: number, signal: AbortSignal) => new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
    });
});

describe('update check mirrors', () => {
    it('puts the full GitHub URL after each proxy address', () => {
        expect(getUpdateMetadataMirrorUrls(LATEST_YML, ['https://a.example/', 'https://b.example/'])).toEqual([
            `https://a.example/${LATEST_YML}`,
            `https://b.example/${LATEST_YML}`,
        ]);
        expect(getUpdateMetadataMirrorUrls(LATEST_YML)).toHaveLength(UPDATE_CHECK_MIRROR_PREFIXES.length);
        expect(UPDATE_CHECK_MIRROR_PREFIXES.every(prefix => prefix.startsWith('https://') && prefix.endsWith('/'))).toBe(true);
    });

    it('builds no mirror URL for anything but a GitHub URL', () => {
        expect(getUpdateMetadataMirrorUrls('https://example.com/latest.yml')).toEqual([]);
        expect(getUpdateMetadataMirrorUrls('')).toEqual([]);
    });

    it('takes the first metadata that names a version and aborts the rest', async () => {
        let slowAborted = false;
        const result = await readFirstUpdateMetadataVersion(
            ['https://slow.example/x', 'https://html.example/x', 'https://ok.example/x'],
            async (url, signal) => {
                if (url.startsWith('https://slow.')) {
                    signal.addEventListener('abort', () => { slowAborted = true; });
                    return wait(5000, signal);
                }
                if (url.startsWith('https://html.')) {
                    return '<html><body>403 Forbidden</body></html>';
                }
                return 'version: 0.7.27\nfiles:\n  - url: Folia-Setup-0.7.27.exe\n';
            },
            5000,
        );

        expect(result).toEqual({ url: 'https://ok.example/x', version: '0.7.27' });
        expect(slowAborted).toBe(true);
    });

    it('rejects with the first URL error when none answers with a version', async () => {
        await expect(readFirstUpdateMetadataVersion(
            ['https://first.example/x', 'https://second.example/x'],
            async (url) => {
                throw new Error(`failed ${new URL(url).host}`);
            },
            5000,
        )).rejects.toThrow('failed first.example');
    });

    it('gives up on all of them when the time runs out', async () => {
        await expect(readFirstUpdateMetadataVersion(
            ['https://hang.example/x'],
            async (_url, signal) => wait(5000, signal),
            20,
        )).rejects.toThrow('aborted');
    });

    it('accepts only release-shaped versions', async () => {
        const read = (text: string) => readFirstUpdateMetadataVersion(['https://m.example/x'], async () => text, 1000);
        await expect(read('version: 0.7.26-beta.1794017588\n')).resolves.toMatchObject({ version: '0.7.26-beta.1794017588' });
        await expect(read('version: 99.0.0-<b>free</b>\n')).rejects.toThrow('release version');
        await expect(read('version: latest\n')).rejects.toThrow('release version');
    });

    it('reads GitHub first and leaves the mirrors alone when it answers', async () => {
        const asked: string[] = [];
        const result = await discoverUpdateVersion({
            githubUrl: LATEST_YML,
            readText: async (url) => {
                asked.push(url);
                return 'version: 0.7.27\n';
            },
            logger: quietLogger,
        });

        expect(result).toEqual({ version: '0.7.27', via: 'github' });
        expect(asked).toEqual([LATEST_YML]);
    });

    it('asks the mirrors when GitHub fails, and skips GitHub when the caller already failed to read it', async () => {
        const readText: ReadText = async (url) => {
            if (url === LATEST_YML) throw new Error('net::ERR_CONNECTION_RESET');
            return 'version: 0.7.27\n';
        };

        await expect(discoverUpdateVersion({ githubUrl: LATEST_YML, readText, logger: quietLogger }))
            .resolves.toEqual({ version: '0.7.27', via: 'mirror' });

        const asked: string[] = [];
        await discoverUpdateVersion({
            githubUrl: LATEST_YML,
            readText: async (url) => {
                asked.push(url);
                return 'version: 0.7.27\n';
            },
            githubError: new Error('updater failed'),
            logger: quietLogger,
        });
        expect(asked).not.toContain(LATEST_YML);
        expect(asked.length).toBe(UPDATE_CHECK_MIRROR_PREFIXES.length);
    });

    it('reports the GitHub error when no mirror answers either', async () => {
        await expect(discoverUpdateVersion({
            githubUrl: LATEST_YML,
            readText: async (url) => {
                throw new Error(url === LATEST_YML ? 'github down' : 'mirror down');
            },
            logger: quietLogger,
        })).rejects.toThrow('github down');
    });

    it('stops waiting for a promise after its time', async () => {
        await expect(settleWithin(new Promise(() => {}), 20, 'too slow')).rejects.toThrow('too slow');
        await expect(settleWithin(Promise.resolve(1), 1000, 'too slow')).resolves.toBe(1);
    });
});
