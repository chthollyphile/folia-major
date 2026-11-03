import { describe, expect, it } from 'vitest';
import { option, type SettingsGroupDef } from '../../../src/components/modal/settings/kit/options';
import { buildSettingsNavGroups } from '../../../src/components/modal/settings/navigation/settingsNavModel';
import { buildSettingsSearchEntries, searchSettings } from '../../../src/components/modal/settings/navigation/settingsNavSearch';
import zhCN from '../../../src/i18n/locales/zh-CN';

// test/unit/settings/settingsNavSearch.test.ts
// The settings search matches the names of categories, groups and options, and borrows the settings
// commands' synonyms and pinyin. A hit has to say where to land.

const translate = (key: string): string => {
    const value = key.split('.').reduce<unknown>((node, part) => (
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
    ), zhCN);
    return typeof value === 'string' ? value : key;
};

// A page built with the kit declares its options; this stands in for one.
const GRID: SettingsGroupDef = { id: 'gridViewCardSettings', titleKey: 'options.gridViewCardSettings' };
const AI: SettingsGroupDef = { id: 'electronSettings', titleKey: 'options.electronSettings', electronOnly: true };
// A group the web has too, with one row only the desktop app draws.
const MEDIA: SettingsGroupDef = { id: 'mediaCache', titleKey: 'options.mediaCache' };
// A group whose id is a place a command names (settingsAnchorModel).
const TRANSITION: SettingsGroupDef = { id: 'transitionSettings', titleKey: 'options.transitionSettings' };
const PAGE_OPTIONS = {
    home: [option(GRID, 'gridViewSquareCard', 'options.gridViewSquareCard')],
    appearance: [option(AI, 'aiProvider', 'options.aiProvider')],
    playback: [option(TRANSITION, 'transitionEnable', 'options.transitionEnable')],
    storage: [
        option(MEDIA, 'enableMediaCache', 'options.enableMediaCache'),
        option(MEDIA, 'cacheDirectory', 'options.cacheDirectory', { electronOnly: true }),
    ],
};

const entriesFor = (isElectron: boolean) => buildSettingsSearchEntries(
    buildSettingsNavGroups(translate, { isElectron }),
    PAGE_OPTIONS,
    translate,
    { isElectron },
);
const desktopEntries = entriesFor(true);
const webEntries = entriesFor(false);

const hitsFor = (query: string, entries = desktopEntries) => searchSettings(entries, query, 'zh-CN');

describe('searchSettings', () => {
    it('finds nothing for an empty query', () => {
        expect(hitsFor('   ')).toEqual([]);
    });

    it('finds a single option and says where it is', () => {
        expect(hitsFor('正方形')).toEqual([{
            sectionId: 'home',
            targetId: 'gridViewSquareCard',
            groupId: 'gridViewCardSettings',
            label: '正方形卡片',
            path: '主页与歌单 › 网格卡片',
        }]);
    });

    it('lists a group before the options it holds, the group name matching first', () => {
        expect(hitsFor('网格卡片').map(hit => hit.targetId)).toEqual(['gridViewCardSettings', 'gridViewSquareCard']);
    });

    // The search lists what the pages declare and nothing else: a place a command names
    // (settingsAnchorModel) is found only as the group or the row of a page that carries its id.
    it('lists no place that no page declares', () => {
        expect(desktopEntries.map(entry => entry.targetId)).not.toContain('ponderHints');
        expect(hitsFor('思索')).toEqual([]);
    });

    it('finds a category through a command synonym no label spells out', () => {
        expect(hitsFor('fps')).toContainEqual({ sectionId: 'graphics', targetId: null, label: '性能与动效', path: '应用' });
    });

    it('finds a category by the name of its side-list group', () => {
        expect(hitsFor('高级')).toContainEqual({ sectionId: 'developer', targetId: null, label: '开发者', path: '高级' });
    });

    it('finds a category through generated pinyin', () => {
        expect(hitsFor('tuxing').map(hit => hit.sectionId)).toContain('graphics');
    });

    it('finds the place a command names by its anchor', () => {
        // "automix" is a keyword of the command that opens the transition group.
        expect(hitsFor('automix').map(hit => hit.targetId)).toContain('transitionSettings');
    });

    it('never surfaces what the platform does not show', () => {
        expect(hitsFor('模组').map(hit => hit.sectionId)).toContain('mods');
        expect(hitsFor('模组', webEntries).map(hit => hit.sectionId)).not.toContain('mods');

        expect(hitsFor('AI 供应商').map(hit => hit.targetId)).toContain('aiProvider');
        expect(hitsFor('AI 供应商', webEntries)).toEqual([]);
    });

    it('leaves a row only the desktop app draws out on the web, and keeps its group and the rows beside it', () => {
        const targets = (entries: typeof webEntries) => entries.filter(entry => entry.sectionId === 'storage').map(entry => entry.targetId);

        expect(targets(desktopEntries)).toEqual(expect.arrayContaining(['mediaCache', 'enableMediaCache', 'cacheDirectory']));
        expect(targets(webEntries)).toEqual(expect.arrayContaining(['mediaCache', 'enableMediaCache']));
        expect(targets(webEntries)).not.toContain('cacheDirectory');
        expect(hitsFor(translate('options.cacheDirectory'), webEntries).map(hit => hit.targetId)).not.toContain('cacheDirectory');
    });

    it('leaves out a group and a row the page does not draw on this machine', () => {
        const machine = { watchesFolders: false, isWindows: false };
        // The folder watch group: an anchor of the storage page (settingsAnchorModel) that only some browsers draw.
        const WATCH: SettingsGroupDef = { id: 'localLibraryWatch', titleKey: 'options.localLibraryWatch', available: () => machine.watchesFolders };
        const BEHAVIOR: SettingsGroupDef = { id: 'queueSettings', titleKey: 'options.settingsHeadingPlaybackBehavior' };
        const storageAndPlayback = () => buildSettingsSearchEntries(
            buildSettingsNavGroups(translate, { isElectron: true }),
            {
                storage: [option(MEDIA, 'enableMediaCache', 'options.enableMediaCache'), option(WATCH, 'localLibraryAutoScan', 'options.localLibraryAutoScan')],
                playback: [
                    option(BEHAVIOR, 'queueDefaultBehavior', 'options.queueDefaultBehavior'),
                    option(BEHAVIOR, 'voiceInputPause', 'options.voiceInputPause', { electronOnly: true, available: () => machine.isWindows }),
                ],
            },
            translate,
            { isElectron: true },
        ).filter(entry => entry.sectionId === 'storage' || entry.sectionId === 'playback').map(entry => entry.targetId);

        const without = storageAndPlayback();
        expect(without).toEqual(expect.arrayContaining(['mediaCache', 'enableMediaCache', 'queueSettings', 'queueDefaultBehavior']));
        expect(without).not.toContain('localLibraryWatch');
        expect(without).not.toContain('localLibraryAutoScan');
        expect(without).not.toContain('voiceInputPause');

        machine.watchesFolders = true;
        machine.isWindows = true;
        expect(storageAndPlayback()).toEqual(expect.arrayContaining(['localLibraryWatch', 'localLibraryAutoScan', 'voiceInputPause']));
    });

    it('lists a group once, by its first row that is drawn here, also when a row before it is not', () => {
        const SERVICES: SettingsGroupDef = { id: 'services', titleKey: 'options.settingsHeadingServices' };
        const targets = buildSettingsSearchEntries(
            buildSettingsNavGroups(translate, { isElectron: false }),
            { integration: [
                option(SERVICES, 'discordRichPresence', 'options.discordRichPresence', { electronOnly: true }),
                option(SERVICES, 'navidrome', 'navidrome.enable'),
                option(SERVICES, 'r2Sync', 'options.r2Sync'),
            ] },
            translate,
            { isElectron: false },
        ).map(entry => entry.targetId).filter(id => id !== null && ['services', 'discordRichPresence', 'navidrome', 'r2Sync'].includes(id));

        expect(targets).toEqual(['services', 'navidrome', 'r2Sync']);
    });

    it('returns nothing for a query nothing matches', () => {
        expect(hitsFor('qqqxxxzzz')).toEqual([]);
    });
});
