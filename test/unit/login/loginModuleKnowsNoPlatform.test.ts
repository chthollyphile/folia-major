import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { omni } from '@/services/onlineMusic/omni';
import { listOnlineMusicProviders } from '@/services/onlineMusic/providerRegistry';
import { useNeteaseApiStatusStore } from '@/services/onlineMusic/netease/useNeteaseApiStatusStore';

// test/unit/login/loginModuleKnowsNoPlatform.test.ts
// One platform's rule stays with the platform. The sign-in window (src/components/login/) names
// no platform: what belongs to one is declared in that platform's adapter and asked for through
// omni. The first test reads the folder's source; the others pin what each adapter declares and
// that a platform nobody declared anything for is still served.

const LOGIN_FOLDER = 'src/components/login';

describe('the sign-in window names no platform', () => {
    it('has no platform id, no platform name and no import of an adapter in any of its files', async () => {
        const ids = listOnlineMusicProviders().map(provider => provider.id);
        expect(ids.length).toBeGreaterThanOrEqual(6);
        const files = (await readdir(LOGIN_FOLDER, { recursive: true })).filter(name => /\.(ts|tsx|css)$/.test(name));
        expect(files.length).toBeGreaterThan(0);
        for (const name of files) {
            const file = `${LOGIN_FOLDER}/${name}`;
            const source = await readFile(file, 'utf8');
            const named = ids.filter(id => new RegExp(`(?<![A-Za-z])${id}(?![a-z])`, 'i').test(source));
            expect(named, file).toEqual([]);
            expect(source, file).not.toMatch(/网易|酷狗|波点|微信|WeChat|Spotify|YouTube|Bodian|KuGou|NetEase/i);
            const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match => match[1]);
            expect(imports.filter(path => /onlineMusic\/(?!omni$|login\/)[A-Za-z]+\//.test(path)), file).toEqual([]);
            expect(imports.filter(path => /providerRegistry|NeteaseApiStatus/.test(path)), file).toEqual([]);
        }
    });
});

describe('what each platform declares for the sign-in window', () => {
    it('its mark: one letter and one colour', () => {
        const marks = Object.fromEntries(listOnlineMusicProviders().map(provider => [provider.id, omni.getProviderMark(provider.id)]));
        expect(marks).toEqual({
            netease: { letter: '云', color: '#dc2626' },
            kugou: { letter: 'K', color: '#2563eb' },
            qq: { letter: 'Q', color: '#16a34a' },
            bodian: { letter: '波', color: '#0d9488' },
            ytm: { letter: 'Y', color: '#e11d48' },
            spotify: { letter: 'S', color: '#22c55e' },
            qishui: { letter: '汽', color: '#19a58c' },
        });
    });

    it('its title and note, as text keys', () => {
        // The second lines a platform declares for single cases are pinned in loginView.test.ts.
        const texts = Object.fromEntries(listOnlineMusicProviders().map(provider => {
            const { title, note } = omni.getLoginTexts(provider.id)!;
            return [provider.id, { title, note }];
        }));
        expect(texts).toEqual({
            netease: { title: 'home.loginTitle', note: 'home.loginNote' },
            kugou: { title: 'home.loginTitleKugou', note: 'home.loginNoteKugou' },
            qq: { title: 'home.loginTitleQq', note: 'home.loginNoteQq' },
            bodian: { title: 'home.loginTitleBodian', note: 'home.loginNoteBodian' },
            // The test runs where no browser tells the system: the note is the one for Windows and Linux.
            ytm: { title: 'home.loginTitleYtm', note: 'home.loginNoteYtmBrowser' },
            spotify: { title: 'home.loginTitleSpotify', note: 'home.loginNoteSpotify' },
            qishui: { title: 'home.loginTitleQishui', note: 'home.loginNoteQishui' },
        });
    });

    it('answers null for a platform that declared nothing, and for one that is not there', () => {
        expect(omni.getProviderMark('a-mod-source')).toBeNull();
        expect(omni.getLoginTexts('a-mod-source')).toBeNull();
        expect(omni.getLoginLocalService('a-mod-source')).toBeNull();
    });

    it('a local service the window can restart: only the platform that has one', () => {
        const withService = listOnlineMusicProviders().filter(provider => omni.getLoginLocalService(provider.id)).map(provider => provider.id);
        expect(withService).toEqual(['netease']);
    });
});

describe('the local service of a platform, as the sign-in window sees it', () => {
    const service = omni.getLoginLocalService('netease')!;
    const store = useNeteaseApiStatusStore;

    it('is failed only in the desktop app, when the service reports an error; its own words come with it', () => {
        store.setState({ supported: false, status: { status: 'error', error: 'xeapi key missing' } as never, restarting: false });
        expect(service.getStatus()).toEqual({ failed: false, error: null, restarting: false });
        store.setState({ supported: true });
        expect(service.getStatus()).toEqual({ failed: true, error: 'xeapi key missing', restarting: false });
        store.setState({ status: { status: 'running', error: null } as never });
        expect(service.getStatus()).toEqual({ failed: false, error: null, restarting: false });
    });

    it('hands out the same object until something changes, and tells its listeners', () => {
        store.setState({ supported: true, status: { status: 'error', error: null } as never, restarting: false });
        const first = service.getStatus();
        expect(service.getStatus()).toBe(first);
        let told = 0;
        const stop = service.subscribe(() => { told += 1; });
        store.setState({ restarting: true });
        expect(told).toBe(1);
        expect(service.getStatus()).toEqual({ failed: true, error: null, restarting: true });
        stop();
        store.setState({ restarting: false });
        expect(told).toBe(1);
    });

    it('restarts, and says whether the service runs again', async () => {
        const restart = (next: string) => store.setState({
            restart: async () => { store.setState({ status: { status: next, error: null } as never }); },
        });
        restart('running');
        await expect(service.restart()).resolves.toBe(true);
        restart('error');
        await expect(service.restart()).resolves.toBe(false);
    });
});
