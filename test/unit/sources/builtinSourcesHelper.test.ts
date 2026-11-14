// @vitest-environment jsdom
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// A source's lyrics would parse in the lyrics worker; nothing here reads lyrics, but omni loads the client.
vi.mock('@/utils/lyrics/workerClient', () => ({ parseLyricsAsync: vi.fn() }));

import i18n from '@/i18n/config';
import { omni } from '@/services/onlineMusic/omni';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import {
    BUILTIN_SOURCES_ROOT, listBuiltinSourceDirs, registerBuiltinSources, setBuiltinSourceRpc, type RegisteredBuiltinSource,
} from '../helpers/builtinSources';

// test/unit/sources/builtinSourcesHelper.test.ts
// test/unit/helpers/builtinSources.ts（vitest 的 setupFiles 之一）：发现音源目录就经适配层注册，没有就什么都不做；
// 有 core 的走 createSource(测试 env)，没有的走 client 的 activate；到 main 入口的调用由 setBuiltinSourceRpc 接住；
// 模组自己的语言表（含由 zh-CN 生成的 zh-TW）在注册前载入。用构建夹具 test/fixtures/folium-sources/ 证明。

const FIXTURES = path.resolve(__dirname, '../../fixtures/folium-sources');
const SOURCE = 'folium.fixture-source.probe';
const rows = (query: string) => [0, 1, 2].map((index) => ({ id: `${query}-${index}`, title: `${query} #${index}`, artist: 'probe' }));

let work: string;
beforeAll(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-builtin-helper-'));
});
afterAll(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

describe('the builtin sources of the repository', () => {
    it('are registered before each test file, every one of them (none while sources/ has none)', () => {
        const dirs = listBuiltinSourceDirs();
        for (const dir of dirs) {
            const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'mod.json'), 'utf8')) as { sources: { id: string }[] };
            for (const source of manifest.sources) expect(getOnlineMusicProvider(source.id), `${path.basename(dir)}: ${source.id}`).toBeDefined();
        }
        expect(BUILTIN_SOURCES_ROOT).toBe(path.resolve(__dirname, '../../../sources'));
    });

    it('registers nothing and loads nothing for a folder with no source directory', async () => {
        fs.mkdirSync(path.join(work, 'empty', 'not-a-source'), { recursive: true });
        expect(await registerBuiltinSources({ root: path.join(work, 'empty') })).toEqual([]);
        expect(await registerBuiltinSources({ root: path.join(work, 'no-such-folder') })).toEqual([]);
    });
});

describe('a source registered by the helper', () => {
    let registered: RegisteredBuiltinSource[] = [];
    let stopRpc: (() => void) | null = null;
    afterEach(() => {
        registered.forEach((source) => { source.unregister(); });
        registered = [];
        stopRpc?.();
        stopRpc = null;
    });

    it('goes through createSource with the test env, and omni searches it over the test rpc', async () => {
        const calls: unknown[][] = [];
        stopRpc = setBuiltinSourceRpc('fixture-source', {
            search: (query) => {
                calls.push(['search', query]);
                return rows(String(query));
            },
        });
        registered = await registerBuiltinSources({ root: FIXTURES });
        expect(registered.map((source) => [source.modId, source.sourceIds])).toEqual([['fixture-source', [SOURCE]]]);
        const page = await omni.searchProviderSongs(SOURCE, '晴天', { limit: 2, offset: 1 });
        expect(page.items.map((song) => song.name)).toEqual(['晴天 #1', '晴天 #2']);
        expect(page.items[0].sourceRef).toMatchObject({ kind: 'online', providerId: SOURCE, mediaId: '晴天-1' });
        expect(calls).toEqual([['search', '晴天']]);
    });

    it('names it from its own locale files, zh-TW generated from zh-CN', async () => {
        registered = await registerBuiltinSources({ root: FIXTURES });
        const summary = omni.getProviderSummaries().find((entry) => entry.providerId === SOURCE);
        expect(summary?.shortNameKey).toBeTruthy();
        const key = summary?.shortNameKey ?? '';
        expect(i18n.t(key, { lng: 'zh-CN' })).toBe('构建夹具');
        expect(i18n.t(key, { lng: 'zh-TW' })).toBe('構建夾具');
        expect(i18n.t(key, { lng: 'en' })).toBe('Build fixture');
    });

    it('fails a call to the main entry no test answers, saying how to answer it', async () => {
        registered = await registerBuiltinSources({ root: FIXTURES });
        await expect(omni.searchProviderSongs(SOURCE, 'x', { limit: 5, offset: 0 })).rejects.toThrow(/setBuiltinSourceRpc/);
    });

    it('takes it out again: provider, locale texts and all', async () => {
        registered = await registerBuiltinSources({ root: FIXTURES });
        expect(getOnlineMusicProvider(SOURCE)).toBeDefined();
        registered.forEach((source) => { source.unregister(); });
        registered = [];
        expect(getOnlineMusicProvider(SOURCE)).toBeNull();
        expect(i18n.hasResourceBundle('zh-TW', 'folium-mod/fixture-source')).toBe(false);
    });

    it('activates the client entry when the source has no core createSource', async () => {
        // test/fixtures/folium-sources/client-only: a source with only a client entry; its folium.rpc is answered by the test.
        stopRpc = setBuiltinSourceRpc('client-source', { song: (id) => ({ id, title: `song ${String(id)}` }) });
        registered = await registerBuiltinSources({ root: path.resolve(__dirname, '../../fixtures/folium-sources/client-only') });
        expect(registered.map((source) => [source.modId, source.sourceIds])).toEqual([['client-source', ['folium.client-source.plain']]]);
        const song = await omni.getSongDetail('folium.client-source.plain', 'a-1');
        expect(song?.name).toBe('song a-1');
    });
});
