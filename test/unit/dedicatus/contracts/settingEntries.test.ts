import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkSettingEntries, checkSettingEntriesInPrBody } from '../../../../dev/dedicatus/checks/settingEntries.mjs';
import {
    EXCLUDED_SETTING_STORES,
    EXTRA_SETTING_STORES,
    REGISTRY_FILE,
    findSettingStores,
    lostEntries,
    placeOf,
    readRegistry,
    scanSettingEntries,
    settersOf,
} from '../../../../dev/dedicatus/settingEntries.mjs';

// test/unit/dedicatus/contracts/settingEntries.test.ts
// D514：设置入口登记表（dev/dedicatus/settingEntries.json）和代码一致：每个设置函数在哪些文件里被调用。
// 表不对时跑 `npm run dedicatus:setting-entries` 重写；少了入口的，D515 / D516 要求写明原因（见 dev/dedicatus/settingEntries.mjs）。
// 另外核对 D515、D516 的判断：起因是 895471e85 把 Lattice「切歌时自动聚焦」从工具面板拿掉了，没有任何检查报出来。

const ROOT = path.resolve(__dirname, '../../../..');
const AUTO_FOCUS = 'useLatticeSettingsStore.handleToggleAutoFocusOnSongChange';

describe('D514 the setting entry registry matches the code', () => {
    const registry = readRegistry(ROOT);
    const current = scanSettingEntries(ROOT);

    it('reads the setting stores and their entries, so the patterns still match something', () => {
        const stores = findSettingStores(ROOT);
        expect(stores).toContain('src/stores/useLatticeSettingsStore.ts');
        expect(stores).not.toContain('src/stores/useSettingsModalStore.ts');
        expect(stores.length).toBeGreaterThan(15);
        expect(Object.keys(current).length).toBeGreaterThan(150);
        expect(current[AUTO_FOCUS]).toEqual(expect.arrayContaining([
            'src/components/app/lattice/LatticeFocusButton.tsx',
            'src/components/modal/settings/pages/PlayerPage.tsx',
            'src/components/app/command-palette-context/buildSettingsCommandContext.ts',
        ]));
    });

    it('names stores that exist in its extra and excluded lists', () => {
        expect([...EXTRA_SETTING_STORES, ...EXCLUDED_SETTING_STORES].filter(file => !existsSync(path.join(ROOT, file))), 'D514：登记的 store 文件不在了').toEqual([]);
    });

    it('registers where every setting is switched', () => {
        expect(registry.entries, `D514：${REGISTRY_FILE} 和代码对不上：跑 npm run dedicatus:setting-entries 重写；拿掉了入口的，在 removed 里写明原因（D515）`).toEqual(current);
    });

    it('gives every removed entry a reason and a date, and drops the record once the entry is back', () => {
        const malformed = registry.removed.filter(record => !record.entry || !record.place || !record.why?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(record.date ?? ''));
        expect(malformed, 'D514：removed 的每条要有 entry、place、why、date（YYYY-MM-DD）').toEqual([]);
        const back = registry.removed.filter(record => (current[record.entry] ?? []).some(file => placeOf(file) === record.place));
        expect(back, 'D514：这些入口又回来了，删掉 removed 里对应的记录').toEqual([]);
    });
});

describe('where an entry is', () => {
    it('groups files by the place a person meets the setting', () => {
        expect(placeOf('src/components/modal/SettingsModal.tsx')).toBe('settings-page');
        expect(placeOf('src/components/modal/settings/pages/PlayerPage.tsx')).toBe('settings-page');
        expect(placeOf('src/components/app/command-palette-context/buildSettingsCommandContext.ts')).toBe('command-palette');
        expect(placeOf('src/components/command-palette/commands/settingsCommands.ts')).toBe('command-palette');
        expect(placeOf('src/services/sync/settingsSnapshot.ts')).toBe('sync');
        expect(placeOf('src/components/app/lattice/LatticeFocusButton.tsx')).toBe('src/components/app/lattice');
        expect(placeOf('src/components/app/lattice/radio/RadioWall.tsx')).toBe('src/components/app/lattice');
        expect(placeOf('src/components/panelTab/controls/VolumeRow.tsx')).toBe('src/components/panelTab');
        expect(placeOf('src/hooks/useAppPreferences.ts')).toBe('src/hooks');
        expect(placeOf('src/mods/folium/hostActions.ts')).toBe('src/mods/folium');
        expect(placeOf('src/App.tsx')).toBe('src/App.tsx');
    });

    it('reads setters from both the state type and the implementation', () => {
        const text = [
            'type State = {',
            '    autoFocus: boolean;',
            '    handleToggleAutoFocus: (enabled: boolean) => void;',
            '    setLook?: (look: string) => void;',
            '    focusCurrentSong: () => void;',
            '};',
            'const store = create<State>(set => ({',
            '    resetAll: () => set({}),',
            '}));',
        ].join('\n');
        expect(settersOf(text)).toEqual(['handleToggleAutoFocus', 'resetAll', 'setLook']);
    });
});

describe('D515 / D516 a removed entry has to be explained', () => {
    const registryText = (entries: Record<string, string[]>, removed: unknown[] = []) => JSON.stringify({ entries, removed });
    const before = registryText({
        [AUTO_FOCUS]: [
            'src/components/app/command-palette-context/buildSettingsCommandContext.ts',
            'src/components/app/lattice/LatticeFocusButton.tsx',
        ],
        'useLatticeSettingsStore.handleToggleLatticeVignette': ['src/components/modal/settings/LatticeSettingsSection.tsx'],
    });
    // 895471e85 那样：工具面板的开关没了，命令面板的还在；同一个提交里设置页的行换了文件（重组设置页），不算拿掉。
    const afterEntries = {
        [AUTO_FOCUS]: ['src/components/app/command-palette-context/buildSettingsCommandContext.ts'],
        'useLatticeSettingsStore.handleToggleLatticeVignette': ['src/components/modal/settings/pages/PlayerPage.tsx'],
    };
    const io = (after: string) => ({ readBase: () => before, readCurrent: () => after });

    it('finds the place a setting is no longer switched from, and only that one', () => {
        const lost = lostEntries(JSON.parse(before), { entries: afterEntries, removed: [] });
        expect(lost).toEqual([{ entry: AUTO_FOCUS, place: 'src/components/app/lattice', files: ['src/components/app/lattice/LatticeFocusButton.tsx'] }]);
    });

    it('does not count a renamed file', () => {
        const renamed = { entries: { ...afterEntries, [AUTO_FOCUS]: [...afterEntries[AUTO_FOCUS], 'src/components/wallTools/LatticeTools.tsx'] }, removed: [] };
        expect(lostEntries(JSON.parse(before), renamed, new Map([['src/components/app/lattice/LatticeFocusButton.tsx', 'src/components/wallTools/LatticeTools.tsx']]))).toEqual([]);
    });

    it('counts a setter that is gone altogether as gone from every place it had', () => {
        // 拿掉最后一个开关后顺手删了设置函数：状态和存储键还在，D507 拦不住。
        const { [AUTO_FOCUS]: _gone, ...withoutSetter } = afterEntries;
        expect(lostEntries(JSON.parse(before), { entries: withoutSetter, removed: [] }).map(loss => loss.place)).toEqual(['command-palette', 'src/components/app/lattice']);
    });

    it('reports D515 until the removal is recorded with a reason', () => {
        expect(checkSettingEntries(io(registryText(afterEntries))).map(finding => finding.key)).toEqual([`D515:${AUTO_FOCUS}@src/components/app/lattice`]);
        const recorded = registryText(afterEntries, [{ entry: AUTO_FOCUS, place: 'src/components/app/lattice', why: '维护者定：开关只留在命令面板', date: '2026-10-17' }]);
        expect(checkSettingEntries(io(recorded))).toEqual([]);
    });

    it('reports D516 until the PR description names the setter, recorded or not', () => {
        const recorded = registryText(afterEntries, [{ entry: AUTO_FOCUS, place: 'src/components/app/lattice', why: '维护者定', date: '2026-10-17' }]);
        expect(checkSettingEntriesInPrBody(io(recorded), '重构账号、播放、歌词样式、设置与模组').map(finding => finding.code)).toEqual(['D516']);
        expect(checkSettingEntriesInPrBody(io(recorded), null).map(finding => finding.code)).toEqual(['D516']);
        expect(checkSettingEntriesInPrBody(io(recorded), '拿掉了工具面板里的 handleToggleAutoFocusOnSongChange 开关，维护者定的')).toEqual([]);
        // 只是名字的一部分不算提到了。
        expect(checkSettingEntriesInPrBody(io(recorded), '改了 handleToggleAutoFocusOnSongChangeLater').map(finding => finding.code)).toEqual(['D516']);
    });

    it('says nothing while the base has no registry yet', () => {
        expect(checkSettingEntries({ readBase: () => null, readCurrent: () => registryText(afterEntries) })).toEqual([]);
        expect(checkSettingEntriesInPrBody({ readBase: () => null, readCurrent: () => registryText(afterEntries) }, '')).toEqual([]);
    });
});
