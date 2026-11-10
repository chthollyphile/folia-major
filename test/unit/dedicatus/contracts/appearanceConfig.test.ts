import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCodecShortKeys, readEncodedConfigFields, readImportedConfigFields } from '../../../../dev/dedicatus/appearanceCodecKeys.mjs';
import { APPEARANCE_DESTINATIONS, EXTRA_VISUAL_STORE_FILES } from '../../../../dev/dedicatus/appearanceDestinations.mjs';
import { APPEARANCE_SHORT_KEYS } from '../../../../dev/dedicatus/appearanceShortKeys.mjs';
import { storageKeysInFiles } from '../../../../dev/dedicatus/storageKeys/scanStorageKeys.mjs';

// test/unit/dedicatus/contracts/appearanceConfig.test.ts
// D512：外观配置码 / OBS 配置码只加不改：登记过的“字段 → 短键”不改名、不复用、不删（#1028）；新加的追加进登记表。
// D511：外观类 store 的每个持久化键都登记了去向（dev/dedicatus/appearanceDestinations.mjs）：进配置码的哪个字段，
// 或者不进和原因。新字段忘了接导入导出，换机、同步、OBS 都静默读不到它（#719 第 4 条）。另外配置码编码的字段和
// 导入时认的字段一一对应：只编码不导入，导入别人的码时这一项被静默丢掉；只导入不编码，自己导出的码里没有它。

const ROOT = path.resolve(__dirname, '../../../..');

describe('D512 appearance short codes only grow', () => {
    const current = readCodecShortKeys(ROOT);

    it('reads the codec, so the pattern still matches something', () => {
        expect(current).toContain('config.visualizerMode=vm');
        expect(current.length).toBeGreaterThan(200);
    });

    it('keeps every registered field on the short key it was published with', () => {
        const now = new Set(current);
        expect(APPEARANCE_SHORT_KEYS.filter(pair => !now.has(pair)), 'D512：已发布的短键不改名、不删（用户存的配置码和 OBS URL 会解出错值）').toEqual([]);
    });

    it('registers every short key in use', () => {
        const registered = new Set(APPEARANCE_SHORT_KEYS);
        expect(current.filter(pair => !registered.has(pair)), 'D512：新的短键追加进 dev/dedicatus/appearanceShortKeys.mjs').toEqual([]);
    });

    it('never gives one short key to two fields in the same scope', () => {
        const owner = new Map<string, string>();
        const reused: string[] = [];
        for (const pair of current) {
            const [left, short] = pair.split('=');
            const scope = left.slice(0, left.indexOf('.'));
            const key = `${scope}=${short}`;
            const field = left.slice(scope.length + 1);
            const previous = owner.get(key);
            if (previous && previous !== field) reused.push(`${scope}：${short} 同时是 ${previous} 和 ${field}`);
            owner.set(key, field);
        }
        expect(reused, 'D512：短键不复用').toEqual([]);
    });
});

const TRANSFER = 'src/components/modal/settings/pages/storage/visualConfigTransfer.ts';

describe('D511 every appearance setting says where it goes', () => {
    const transfer = readFileSync(path.join(ROOT, TRANSFER), 'utf8');
    const visualStores = [...transfer.matchAll(/from '(?:\.\.\/)+stores\/(use\w+Store)'/g)].map(match => `src/stores/${match[1]}.ts`);
    const keysByFile = storageKeysInFiles(ROOT, [...visualStores, ...EXTRA_VISUAL_STORE_FILES]);
    const current = new Map([...keysByFile].flatMap(([file, keys]) => keys.map(key => [key, file] as const)));

    it('reads the visual stores and their keys, so the patterns still match something', () => {
        expect(visualStores).toContain('src/stores/useVisualizerSettingsStore.ts');
        expect(visualStores.length).toBeGreaterThan(5);
        expect(current.has('visualizer_mode')).toBe(true);
        expect(current.has('library_wall_look')).toBe(true);
        expect(current.size).toBeGreaterThan(60);
    });

    it('registers where every persisted key of a visual store goes', () => {
        const missing = [...current].filter(([key]) => !Object.hasOwn(APPEARANCE_DESTINATIONS, key)).map(([key, file]) => `${file} ${key}`);
        expect(missing, 'D511：新的外观设置要接进配置导入导出（settings-feature-integration），在 appearanceDestinations.mjs 写明去向；不进必须是用户的决定').toEqual([]);
        expect(Object.keys(APPEARANCE_DESTINATIONS).filter(key => !current.has(key)), 'D511：登记表里有已经不用的键').toEqual([]);
    });

    it('sends each exported key to a field the config code carries', () => {
        const encoded = readEncodedConfigFields(ROOT);
        const wrong = Object.entries(APPEARANCE_DESTINATIONS)
            .filter(([, destination]) => destination.config !== null && !encoded.has(destination.config))
            .map(([key, destination]) => `${key} → ${destination.config}`);
        expect(wrong, 'D511：登记的配置码字段 compressConfig 没有编码').toEqual([]);
    });
});

describe('D511 the config code and the import agree on the fields', () => {
    it('imports every field the code carries, and carries every field it imports', () => {
        const encoded = readEncodedConfigFields(ROOT);
        const imported = readImportedConfigFields(ROOT);
        expect(encoded.size).toBeGreaterThan(30);
        expect([...encoded].filter(field => !imported.has(field)), 'D511：配置码带了，导入时却不认').toEqual([]);
        expect([...imported].filter(field => !encoded.has(field)), 'D511：导入时认，配置码里却没有').toEqual([]);
    });
});
