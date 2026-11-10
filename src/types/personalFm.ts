// Provider-neutral FM choices shared by adapters, persisted settings and the mode picker.
export type PersonalFmModeId = 'DEFAULT' | 'FAMILIAR' | 'EXPLORE' | 'SCENE_RCMD' | 'PUZZLE_MODE_RCMD';
export type PersonalFmSceneCategory = 'mood' | 'activity' | 'genre' | 'language' | (string & {});
export type PersonalFmModeEntry = {
    id: PersonalFmModeId;
    labelKey: string;
    labelFallback: string;
    /** Pinyin, full and initials, so the picker answers to a keyboard that types no Chinese. */
    keywords: string[];
};
export type PersonalFmSceneEntry = { id: string; category: PersonalFmSceneCategory; labelKey: string; labelFallback: string; keywords: string[] };
export type PersonalFmSelection = {
    mode: PersonalFmModeId;
    /** Only meaningful for SCENE_RCMD; every other mode rejects a submode. */
    scene: string | null;
};
/**
 * What a radio card starts: the selection of a provider's Personal FM, or of one of its extra radios
 * (a "station"). Only the selection is ever stored; the station is held in memory while it is on air.
 */
export type PersonalFmLaunch = PersonalFmSelection & {
    /** The provider's id for an extra radio; absent or null for the Personal FM itself. */
    station?: string | null;
};
export type PersonalFmCatalog = {
    /** The radio's own name, for a provider's extra radio: the picker is titled after it. Absent for the Personal FM. */
    name?: { labelKey: string; labelFallback: string };
    modes: PersonalFmModeEntry[];
    scenes: PersonalFmSceneEntry[];
    categories: { id: PersonalFmSceneCategory; labelKey: string; labelFallback: string }[];
};
