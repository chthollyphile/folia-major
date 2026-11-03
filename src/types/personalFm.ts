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
export type PersonalFmCatalog = {
    modes: PersonalFmModeEntry[];
    scenes: PersonalFmSceneEntry[];
    categories: { id: PersonalFmSceneCategory; labelKey: string; labelFallback: string }[];
};
