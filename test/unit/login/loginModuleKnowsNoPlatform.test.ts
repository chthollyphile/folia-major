// @builtin-sources
import { readdir, readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { omni } from '@/services/onlineMusic/omni';
import { listOnlineMusicProviders } from '@/services/onlineMusic/providerRegistry';
import { noteNeteaseBackendStatus } from '../../../sources/netease/core';
import { answerNeteaseBackend } from '../helpers/neteaseSource';

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
            fnmusic: { letter: '飞', color: '#0891b2' },
            ytm: { letter: 'Y', color: '#e11d48' },
            spotify: { letter: 'S', color: '#22c55e' },
            qishui: { letter: '汽', color: '#19a58c' },
            appleMusic: { letter: 'A', color: '#fa243c' },
            lxmusic: { letter: '洛', color: '#2f9e6e' },
        });
    });

    it('its title and note, as text keys', () => {
        // The second lines a platform declares for single cases are pinned in loginView.test.ts.
        // A source without a sign-in (the LX source: it has no account) declares no texts and is not in the list.
        const texts = Object.fromEntries(listOnlineMusicProviders().flatMap(provider => {
            const declared = omni.getLoginTexts(provider.id);
            return declared ? [[provider.id, { title: declared.title, note: declared.note }]] : [];
        }));
        expect(omni.getLoginTexts('lxmusic')).toBeNull();
        expect(texts).toEqual({
            netease: { title: 'folium-mod/netease:login.title', note: 'folium-mod/netease:login.note' },
            kugou: { title: 'folium-mod/kugou:login.title', note: 'folium-mod/kugou:login.note' },
            qq: { title: 'folium-mod/qq:login.title', note: 'folium-mod/qq:login.note' },
            // Folium 2.0 S5: a source mod's texts are keys of its own locale files (folium-mod/<mod id>).
            bodian: { title: 'folium-mod/bodian:login.title', note: 'folium-mod/bodian:login.note' },
            fnmusic: { title: 'folium-mod/fnmusic:login.title', note: 'folium-mod/fnmusic:login.note' },
            // The test runs where no browser tells the system: the note is the one for Windows and Linux.
            ytm: { title: 'folium-mod/ytm:login.title', note: 'folium-mod/ytm:login.note' },
            spotify: { title: 'folium-mod/spotify:login.title', note: 'folium-mod/spotify:login.note' },
            qishui: { title: 'folium-mod/qishui:login.title', note: 'folium-mod/qishui:login.note' },
            appleMusic: { title: 'folium-mod/apple-music:login.title', note: 'folium-mod/apple-music:login.note' },
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

// NetEase's local service is the API in its main entry's worker (sources/netease/main): its state comes from the main
// entry, pushed on every change (noteNeteaseBackendStatus) or asked through rpc `status` / `restart`.
describe('the local service of a platform, as the sign-in window sees it', () => {
    const service = () => omni.getLoginLocalService('netease')!;
    let off: (() => void) | null = null;
    afterEach(() => {
        off?.();
        off = null;
        noteNeteaseBackendStatus(null);
    });

    it('is failed when the service reports an error; its own words come with it', () => {
        noteNeteaseBackendStatus({ status: 'error', port: null, error: 'xeapi key missing', updatedAt: 1 });
        expect(service().getStatus()).toEqual({ failed: true, error: 'xeapi key missing', restarting: false });
        noteNeteaseBackendStatus({ status: 'running', port: 3000, error: null, updatedAt: 2 });
        expect(service().getStatus()).toEqual({ failed: false, error: null, restarting: false });
    });

    it('hands out the same object until something changes, asks the state when first watched, and tells its listeners', async () => {
        const backend = answerNeteaseBackend({ status: 'error', port: null, error: null });
        off = backend.off;
        noteNeteaseBackendStatus({ status: 'error', port: null, error: null, updatedAt: 3 });
        const first = service().getStatus();
        expect(service().getStatus()).toBe(first);
        let told = 0;
        const stop = service().subscribe(() => { told += 1; });
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(backend.status).toHaveBeenCalledTimes(1);
        const before = told;
        noteNeteaseBackendStatus({ status: 'running', port: 3000, error: null, updatedAt: 4 });
        expect(told).toBe(before + 1);
        stop();
        noteNeteaseBackendStatus({ status: 'error', port: null, error: null, updatedAt: 5 });
        expect(told).toBe(before + 1);
    });

    it('restarts, and says whether the service runs again', async () => {
        const backend = answerNeteaseBackend();
        off = backend.off;
        await expect(service().restart()).resolves.toBe(true);
        backend.restart.mockReturnValue({ status: 'error', port: null, error: 'port in use', updatedAt: 6 });
        await expect(service().restart()).resolves.toBe(false);
        expect(service().getStatus()).toEqual({ failed: true, error: 'port in use', restarting: false });
    });
});
