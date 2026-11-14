import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '../../../../dev/dedicatus/storageKeys.mjs';
import { scanStorageKeys } from '../../../../dev/dedicatus/storageKeys/scanStorageKeys.mjs';

// test/unit/dedicatus/contracts/storageKeys.test.ts
// D507：持久化的键（渲染进程、平台会话、主进程 electron-store）都登记在 dev/dedicatus/storageKeys.mjs。
// 已经发布的键不改名、不删（改名只会让用户的设置或登录静默丢失）；新键追加进登记表，diff 里看得见。
// D501（src/stores 与 tuning.ts 的键快照，storeContract.test.ts）管经 helper 拼出来的 store 键。

const ROOT = path.resolve(__dirname, '../../../..');

describe('D507 every persisted key is registered', () => {
    const current = scanStorageKeys(ROOT);

    it('reads the keys, so the patterns still match something', () => {
        expect(current.some(key => key.startsWith('web:'))).toBe(true);
        expect(current.some(key => key.startsWith('main:'))).toBe(true);
        expect(current.length).toBeGreaterThan(250);
        // 这几个键是经各文件同名的常量（SESSION_KEY、STORAGE_KEY）或本地包装（storage()?.getItem、useOneTimeHint）读写的
        expect(current).toEqual(expect.arrayContaining([
            'main:BODIAN_SESSION_V2',
            'main:KUGOU_API_SESSION_V2',
            'web:lyric_timeline_offsets',
            'web:folia_recent_plays',
            'web:folia:gridPanelToggleHintSeen',
        ]));
    });

    it('still uses every registered key under the same name', () => {
        const now = new Set(current);
        expect(STORAGE_KEYS.filter(key => !now.has(key)), 'D507：已发布的键不改名、不删；确要废弃，做好迁移后再从登记表删掉').toEqual([]);
    });

    it('registers every key in use', () => {
        const registered = new Set(STORAGE_KEYS);
        expect(current.filter(key => !registered.has(key)), 'D507：新键追加进 dev/dedicatus/storageKeys.mjs').toEqual([]);
    });
});

describe('D507 scanner resolves constants per file', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'd507-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    const write = (file: string, text: string) => {
        mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        writeFileSync(path.join(dir, file), text);
    };
    write('electron/a/session.cjs', "const SESSION_KEY = 'A_SESSION';\nstore.get(SESSION_KEY);\n");
    write('electron/b/session.cjs', "const SESSION_KEY = 'B_SESSION';\nstore.set(SESSION_KEY, 1);\n");
    write('src/keys.ts', "export const SHARED_KEY = 'shared_key';\nexport const PREFIX = 'pre:';\n");
    write('src/use.ts', "import { SHARED_KEY as KEY, PREFIX } from './keys';\nlocalStorage.getItem(KEY);\nstorage()?.setItem(PREFIX + id, '1');\n");
    write('src/other.ts', "const SHARED_KEY = 'other_value';\n");
    write('src/settings.ts', "await window.electron?.saveSettings?.('CLOSE_TO_TRAY', true);\nwindow.electron.saveSettings(FLAG_KEY, 1);\nconst FLAG_KEY = 'SOME_FLAG';\n");

    it('keeps both keys when two files define the same constant name', () => {
        expect(scanStorageKeys(dir)).toEqual(expect.arrayContaining(['main:A_SESSION', 'main:B_SESSION']));
    });

    it('follows a renamed relative import, and a constant plus a variable becomes a prefix', () => {
        expect(scanStorageKeys(dir)).toEqual(expect.arrayContaining(['web:shared_key', 'web:pre:*']));
    });

    // 主进程那边是通用的 store.set(key, value)，键名只在渲染进程的 saveSettings 调用里（#668 演习）
    it('reads the main-process keys the renderer writes through saveSettings', () => {
        expect(scanStorageKeys(dir)).toEqual(expect.arrayContaining(['main:CLOSE_TO_TRAY', 'main:SOME_FLAG']));
    });

    // Folium 2.0：音源模组（sources/<id>/）的 main/ 算主进程（api.legacy.store），client/、core/ 算窗口；平台搬过去后照样查到。
    it('reads the keys of the source mods in sources/, main/ as the main process and the rest as the window', () => {
        write('sources/demo/main/session.ts', "const SESSION_KEY = 'DEMO_SESSION_V1';\napi.legacy.store.get(SESSION_KEY);\n");
        write('sources/demo/client/state.ts', "localStorage.getItem('demo_client_flag');\n");
        write('sources/demo/core/notMain.ts', "store.get('NOT_A_MAIN_KEY');\n");
        const keys = scanStorageKeys(dir);
        expect(keys).toEqual(expect.arrayContaining(['main:DEMO_SESSION_V1', 'web:demo_client_flag']));
        expect(keys).not.toContain('main:NOT_A_MAIN_KEY');
    });

    // S5：client 的 folium.sources.pageStore(id) 落在 providerStorage 的同一个键（online_provider:<id>:<键>）。
    it('reads the page-store keys of a source’s client, by the id given or by its folder', () => {
        write('sources/demo/client/session.ts', [
            "const TOKEN_KEY = 'token';",
            "folium.sources.pageStore('demo').set(TOKEN_KEY, value);",
            'const store = folium.sources.pageStore(sourceId);',
            "store.get('device_id');",
            "notAStore.set('not_a_key', 1);",
        ].join('\n'));
        const keys = scanStorageKeys(dir);
        expect(keys).toEqual(expect.arrayContaining(['provider:demo:token', 'provider:demo:device_id']));
        expect(keys.some(key => key.includes('not_a_key'))).toBe(false);
    });
});
