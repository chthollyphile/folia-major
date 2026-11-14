import i18n from '../../i18n/config';
import type { PersonalFmRequestOptions } from '../../types/onlineMusic';
import type { PersonalFmCatalog, PersonalFmModeId, PersonalFmModeEntry, PersonalFmSceneCategory, PersonalFmSceneEntry, PersonalFmSelection } from '../../types/personalFm';
export type { PersonalFmCatalog, PersonalFmModeId, PersonalFmModeEntry, PersonalFmSceneCategory, PersonalFmSceneEntry, PersonalFmSelection } from '../../types/personalFm';

// src/services/onlineMusic/fmModes.ts
// Personal FM mode catalogue, shared by the command palette surface and the request layer so a
// mode looks and behaves the same wherever it is offered. Default ids mirror NetEase's `/personal/fm/mode`
// parameters verbatim; a provider can supply its own scene catalogue through Omni.

export const DEFAULT_PERSONAL_FM_SELECTION: PersonalFmSelection = { mode: 'DEFAULT', scene: null };

const mode = (id: PersonalFmModeId, labelFallback: string, ...keywords: string[]): PersonalFmModeEntry => ({
    id,
    labelKey: `personalFmMode.mode.${id}`,
    labelFallback,
    keywords,
});

// SCENE_RCMD sits last: it is the only mode the scene row can select on the user's behalf, so the
// row below it reads as its continuation.
export const PERSONAL_FM_MODES: PersonalFmModeEntry[] = [
    mode('DEFAULT', 'Default', 'moren', 'mr'),
    mode('FAMILIAR', 'Familiar', 'shuxi', 'sx'),
    mode('EXPLORE', 'Explore', 'tansuo', 'ts'),
    mode('PUZZLE_MODE_RCMD', 'Puzzle', 'pintu', 'pt'),
    mode('SCENE_RCMD', 'Scene', 'changjing', 'cj'),
];

const scene = (
    id: string,
    category: PersonalFmSceneCategory,
    labelFallback: string,
    ...keywords: string[]
): PersonalFmSceneEntry => ({
    id,
    category,
    labelKey: `personalFmMode.scene.${id}`,
    labelFallback,
    keywords,
});

export const PERSONAL_FM_SCENE_CATEGORIES: { id: PersonalFmSceneCategory; labelKey: string; labelFallback: string }[] = [
    { id: 'mood', labelKey: 'personalFmMode.category.mood', labelFallback: 'Mood' },
    { id: 'activity', labelKey: 'personalFmMode.category.activity', labelFallback: 'Moment' },
    { id: 'genre', labelKey: 'personalFmMode.category.genre', labelFallback: 'Genre' },
    { id: 'language', labelKey: 'personalFmMode.category.language', labelFallback: 'Language' },
];

export const PERSONAL_FM_SCENES: PersonalFmSceneEntry[] = [
    scene('NIGHT_EMO', 'mood', 'Melancholy', 'shanggan', 'sg'),
    scene('CURE', 'mood', 'Healing', 'zhiyu', 'zy'),
    scene('CHEERFUL', 'mood', 'Cheerful', 'huankuai', 'hk'),
    scene('LYRICAL', 'mood', 'Lyrical', 'shuqing', 'sq'),
    scene('INSPIRATIONAL', 'mood', 'Inspirational', 'lizhi', 'lz'),
    scene('RELAX', 'mood', 'Relax', 'fangsong', 'fs'),
    scene('SWEET', 'mood', 'Love Songs', 'qingge', 'qg'),

    scene('EXERCISE', 'activity', 'Workout', 'yundong', 'yd'),
    scene('FOCUS', 'activity', 'Focus', 'zhuanzhu', 'zz'),
    scene('SLEEP_HELP', 'activity', 'Sleep', 'zhumian', 'zm'),
    scene('TAKE_SHOWER', 'activity', 'Shower', 'xizao', 'xz'),
    scene('COMMUTE', 'activity', 'Commute', 'chuxing', 'cx'),
    scene('COFFEE_SHOP', 'activity', 'Coffee Shop', 'kafeiguan', 'kfg'),
    scene('GAMES', 'activity', 'Gaming', 'youxi', 'yx'),
    scene('DANCE', 'activity', 'Dance', 'wudao', 'wd'),
    scene('RAINY', 'activity', 'Rainy Day', 'yutian', 'yt'),

    scene('RHYTHM_BLUES', 'genre', 'R&B', 'rb', 'randb'),
    scene('RAP', 'genre', 'Rap', 'shuochang', 'sc'),
    scene('K_POP', 'genre', 'K-Pop', 'kpop'),
    scene('ELECTRONIC', 'genre', 'Electronic', 'dianyin', 'dy'),
    scene('ROCK', 'genre', 'Rock', 'yaogun', 'yg'),
    scene('FOLK', 'genre', 'Folk', 'minyao', 'my'),
    scene('GUDIAN', 'genre', 'Classical', 'gudian', 'gd'),
    scene('JAZZ', 'genre', 'Jazz', 'jueshi', 'js'),
    scene('BLUE', 'genre', 'Blues', 'landiao', 'ld'),
    scene('PUNK', 'genre', 'Funk', 'fangke', 'fk'),
    scene('COUNTRY', 'genre', 'Country', 'xiangcunyue', 'xcy'),
    scene('LIGHT', 'genre', 'Light Music', 'qingyinyue', 'qyy'),
    scene('GUOFENG', 'genre', 'Guofeng', 'guofeng', 'gf'),
    scene('MANYAO', 'genre', 'Slow DJ', 'manyao', 'manyaodj', 'my'),
    scene('MUSICAL', 'genre', 'Musical', 'yinyueju', 'yyj'),
    scene('ACG', 'genre', 'ACG', 'erciyuan', 'ecy'),
    scene('JINGDIAN', 'genre', 'Classics', 'jingdian', 'jd'),
    scene('ORIGINAL_MUSICIAL', 'genre', 'Indie Original', 'baozangyuanchuang', 'bzyc'),
    scene('YINGSHI', 'genre', 'Soundtrack', 'yingshi', 'ys'),

    scene('CHINESE', 'language', 'Mandarin', 'huayu', 'hy'),
    scene('ENGLISH', 'language', 'Western', 'oumei', 'om'),
    scene('YUEYU', 'language', 'Cantonese', 'yueyu', 'yy'),
    scene('JAPANESE', 'language', 'Japanese', 'riyu', 'ry'),
    scene('FRANCH', 'language', 'French', 'fayu', 'fy'),
    scene('LATIN', 'language', 'Latin', 'lading', 'ld'),
    scene('GLOBAL', 'language', 'Global', 'quanqiu', 'qq'),
];

// The full table of modes and scenes: the catalogue of the platform whose radio it describes, which that
// platform's provider answers with (getPersonalFmCatalog); other platforms build theirs from its modes. It stays
// here, not in that platform's folder, while the host reads it too: the stored mode choice is normalised against
// it, and the command palette shows it until a catalogue has loaded. Folium 2.0 S4 moves the shared mode list
// into the source kit.
export const DEFAULT_PERSONAL_FM_CATALOG: PersonalFmCatalog = {
    modes: PERSONAL_FM_MODES, scenes: PERSONAL_FM_SCENES, categories: PERSONAL_FM_SCENE_CATEGORIES,
};

/**
 * What a platform without a catalogue of its own offers: no modes, no scenes. omni answers with it for such a
 * platform (Folium 2.0 S1); before, it answered with the full table above for every platform.
 */
export const EMPTY_PERSONAL_FM_CATALOG: PersonalFmCatalog = Object.freeze({ modes: [], scenes: [], categories: [] });
export const personalFmEntryLabel = (entry: { labelKey: string; labelFallback: string }, t: (key: string, fallback?: string) => string): string => (
    entry.labelKey ? t(entry.labelKey, entry.labelFallback) : entry.labelFallback
);

export const getPersonalFmSceneEntry = (id: string | null | undefined, catalog = DEFAULT_PERSONAL_FM_CATALOG): PersonalFmSceneEntry | null => (
    catalog.scenes.find(entry => entry.id === id) ?? null
);

/** Drops a scene that no longer exists, and a scene attached to a mode that cannot carry one. */
export const normalizePersonalFmSelection = (raw: unknown, catalog = DEFAULT_PERSONAL_FM_CATALOG): PersonalFmSelection => {
    const candidate = raw as Partial<PersonalFmSelection> | null | undefined;
    const modeId = typeof candidate?.mode === 'string' && catalog.modes.some(entry => entry.id === candidate.mode)
        ? candidate.mode as PersonalFmModeId
        : DEFAULT_PERSONAL_FM_SELECTION.mode;
    if (modeId !== 'SCENE_RCMD') {
        return { mode: modeId, scene: null };
    }
    const sceneId = typeof candidate?.scene === 'string' && catalog.scenes.some(entry => entry.id === candidate.scene) ? candidate.scene : null;
    // SCENE_RCMD without a submode is rejected by the API, so it degrades to the default mode.
    return sceneId ? { mode: 'SCENE_RCMD', scene: sceneId } : DEFAULT_PERSONAL_FM_SELECTION;
};

export const isSamePersonalFmSelection = (left: PersonalFmSelection, right: PersonalFmSelection) => (
    left.mode === right.mode && left.scene === right.scene
);

export const isDefaultPersonalFmSelection = (selection: PersonalFmSelection) => (
    isSamePersonalFmSelection(selection, DEFAULT_PERSONAL_FM_SELECTION)
);

export const toPersonalFmRequestOptions = (selection: PersonalFmSelection, station?: string | null): PersonalFmRequestOptions => ({
    mode: selection.mode,
    submode: selection.scene,
    ...(station ? { station } : {}),
});

/** "Scene · Sleep" for SCENE_RCMD, the plain mode name otherwise. */
export const getPersonalFmSelectionLabel = (
    selection: PersonalFmSelection,
    t: (key: string, fallback?: string) => string,
    catalog = DEFAULT_PERSONAL_FM_CATALOG,
): string => {
    const modeEntry = catalog.modes.find(entry => entry.id === selection.mode) ?? PERSONAL_FM_MODES[0];
    const modeLabel = personalFmEntryLabel(modeEntry, t);
    const sceneEntry = getPersonalFmSceneEntry(selection.scene, catalog);
    return sceneEntry ? `${modeLabel} · ${personalFmEntryLabel(sceneEntry, t)}` : modeLabel;
};

/**
 * The picker's title, and the name of its command while it is open: after the radio on air where its catalogue
 * names it ("Guess You Like mode"), "Personal FM mode" otherwise. One place, so the two always say the same.
 */
export const getPersonalFmPickerTitle = (catalog?: PersonalFmCatalog): string => (
    catalog?.name
        ? i18n.t('commandPalette.fmModeTitleOf', { name: catalogName(catalog.name), defaultValue: '{{name}} mode' })
        : i18n.t('commandPalette.fmModeTitle', { defaultValue: 'Personal FM mode' })
);

/** The hint on the button that opens the picker, naming the same thing the picker's title does. */
export const getPersonalFmOpenPickerLabel = (catalog?: PersonalFmCatalog): string => (
    catalog?.name
        ? i18n.t('personalFmMode.openPickerOf', { name: catalogName(catalog.name), defaultValue: 'Switch the {{name}} mode' })
        : i18n.t('personalFmMode.openPicker', { defaultValue: 'Switch the Personal FM mode' })
);

const STATUS_KEYS = {
    applied: ['statusApplied', 'Personal FM switched to', 'statusAppliedOf', '{{name}} switched to'],
    empty: ['statusEmpty', 'This Personal FM mode returned nothing', 'statusEmptyOf', 'This {{name}} mode returned nothing'],
    failed: ['statusFailed', 'Failed to switch the Personal FM mode', 'statusFailedOf', 'Failed to switch the {{name}} mode'],
} as const;

/**
 * The status line of a mode switch, naming the radio on air where its catalogue names it ("Guess You Like
 * switched to"), the Personal FM otherwise, like the picker's title.
 */
export const getPersonalFmStatusText = (kind: keyof typeof STATUS_KEYS, catalog?: PersonalFmCatalog | null): string => {
    const [key, fallback, keyOf, fallbackOf] = STATUS_KEYS[kind];
    return catalog?.name
        ? i18n.t(`personalFmMode.${keyOf}`, { name: catalogName(catalog.name), defaultValue: fallbackOf })
        : i18n.t(`personalFmMode.${key}`, { defaultValue: fallback });
};

function catalogName(name: NonNullable<PersonalFmCatalog['name']>): string {
    return name.labelKey ? i18n.t(name.labelKey, { defaultValue: name.labelFallback }) : name.labelFallback;
}
