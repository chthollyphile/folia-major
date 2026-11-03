import type { FoliumRegistries } from './contract';
import type { FoliumPermissionId } from './shared';

// src/mods/folium/kinds.ts
// The one table of the kinds of thing a mod can register: one row per registry
// of `folium.registries`. Read from it:
//   - api.ts builds `folium.registries` (which kinds do nothing outside the
//     main window, which need a permission);
//   - FoliumMountHost.tsx takes the names a mod's container can be marked with
//     (`data-folium-kind`; each mount site reads its name with foliumMountName),
//     and faultNotice.ts the words of the notice when a piece of that name fails;
//   - `npm run folium:api` writes the table of kinds in docs/folium/api.md,
//     and `npm run folium:check` knows the registries and their permissions.
//
// This file has only facts and imports nothing at run time. That is on
// purpose: the failure notice loads with the app, while the registries
// themselves (and everything they draw with) load only once a mod starts, and
// the tools under dev/folium/ import this file straight into Node.
//
// Adding a kind: its types in contract.ts, its registry and what draws it in
// registries/, one row here, its registry in api.ts (the compiler asks for it),
// and the place in the app that shows it.

/** The words a failure notice uses for a piece of a mod: a key under `mods.faultNotice` in the locales. */
export type FoliumNoticeWords = 'visualizer' | 'background' | 'stageLayer' | 'panelTab' | 'homeTab' | 'progressButton' | 'progressLayer' | 'settings';

export interface FoliumKind {
    /** What the kind is for, as the docs table says it. */
    use: string;
    /** Takes registrations and does nothing outside the main window: there is no app UI to put it in there. */
    uiOnly: boolean;
    /** The permission a mod must declare in mod.json to register this kind (an id in foliumShared.json's permissions), or null. */
    permission: FoliumPermissionId | null;
    /**
     * What this kind's containers are marked with (`data-folium-kind`), each with the words of the
     * notice shown when a piece of that name fails. Empty for a kind that mounts nothing.
     */
    mounts: Readonly<Record<string, FoliumNoticeWords>>;
}

export const FOLIUM_KINDS = {
    visualizers: { use: '歌词动画模式', uiOnly: false, permission: null, mounts: { visualizer: 'visualizer', 'visualizer-settings': 'settings' } },
    tunings: { use: '给声明了 Folium 可调键的内置模式调参', uiOnly: false, permission: null, mounts: { tuning: 'settings' } },
    commands: { use: '命令：出现在模组面板与命令面板', uiOnly: true, permission: null, mounts: {} },
    backgrounds: { use: '背景类型（出现在背景选择器，预览与导出同样生效）', uiOnly: false, permission: null, mounts: { background: 'background', 'background-settings': 'settings' } },
    stageLayers: { use: '播放页图层', uiOnly: true, permission: 'stageLayers', mounts: { 'stage-layer': 'stageLayer' } },
    settingsSections: { use: '模组自己的设置，显示在模组面板里该模组展开后的区域', uiOnly: false, permission: null, mounts: { 'settings-section': 'settings' } },
    playerPanelTabs: { use: '播放器面板的标签页', uiOnly: true, permission: null, mounts: { 'panel-tab': 'panelTab' } },
    homeTabs: { use: '首页导航末尾的整页（网格与 Bravais 首页都有），用 `folium.ui.openHomeTab` 打开', uiOnly: true, permission: null, mounts: { 'home-tab': 'homeTab' } },
    progressButtons: { use: '进度条左右的按钮（`progress.leading` / `progress.trailing`）', uiOnly: true, permission: null, mounts: { 'progress-button': 'progressButton' } },
    progressLayers: { use: '叠在进度条轨道上的图层', uiOnly: true, permission: null, mounts: { 'progress-layer': 'progressLayer' } },
    styles: { use: '模组 CSS，只针对公开 part', uiOnly: true, permission: null, mounts: {} },
} as const satisfies Record<keyof FoliumRegistries, FoliumKind>;

type Kinds = typeof FOLIUM_KINDS;

/** The name of a kind: a member of `folium.registries`. */
export type FoliumKindName = keyof Kinds;

/** The kind names in the order `folium.registries` lists them. */
export const FOLIUM_KIND_NAMES = Object.freeze(Object.keys(FOLIUM_KINDS)) as readonly FoliumKindName[];

/**
 * What a host container holds, for `data-folium-kind`. Together with
 * `data-folium-entry` (the namespaced registry id) it lets a Ponder target's
 * hoverSelector or `dom` anchor pick out one entry of a mod — the markup
 * inside is out of reach in a ShadowRoot, the container is not.
 */
export type FoliumEntryKind = { [Name in FoliumKindName]: keyof Kinds[Name]['mounts'] }[FoliumKindName];

/** For each name a container can be marked with, the words of the notice when a piece of that name fails. */
export const FOLIUM_ENTRY_NOTICE_WORDS = Object.freeze(
    Object.assign({}, ...FOLIUM_KIND_NAMES.map((name) => FOLIUM_KINDS[name].mounts)),
) as Readonly<Record<FoliumEntryKind, FoliumNoticeWords>>;

/** The notice words of one kind's containers. */
type MountWords<Name extends FoliumKindName> = Kinds[Name]['mounts'][keyof Kinds[Name]['mounts']];

/**
 * The name a container of `kind` is marked with, read from the table so that a mount site never spells
 * it: the kind's mount whose notice words are `words` (within one kind no two mounts share them; a test
 * holds the table to that). `foliumMountName('progressButtons', 'progressButton')` is 'progress-button',
 * `foliumMountName('visualizers', 'settings')` is 'visualizer-settings'.
 */
export const foliumMountName = <Name extends FoliumKindName>(kind: Name, words: MountWords<Name>): FoliumEntryKind => {
    const mounts: Readonly<Record<string, FoliumNoticeWords>> = FOLIUM_KINDS[kind].mounts;
    const name = Object.keys(mounts).find((mount) => mounts[mount] === words);
    if (name === undefined) throw new Error(`kinds.ts: ${kind} has no container with the words "${String(words)}"`);
    return name as FoliumEntryKind;
};
