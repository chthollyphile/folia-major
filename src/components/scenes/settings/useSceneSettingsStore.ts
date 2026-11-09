import { create } from 'zustand';
import { getStoredString, removeStoredKey, setStoredString } from '../../../stores/storagePrimitives';
import { isSceneId } from '../../../types/sceneIds';
import type { SceneQualityPreset } from '../definition';

// src/components/scenes/settings/useSceneSettingsStore.ts
// 场景的设置：现在选的是哪个场景（null = 普通播放页），每个场景各自的画质档、座位和设置值。
// 声线追踪的开关和耳机/音箱在 useSoundTracingStore.ts。
// 存储键发布后不改名：`scene_id`、`scene_options`。

export const SCENE_ID_KEY = 'scene_id';
export const SCENE_OPTIONS_KEY = 'scene_options';

export interface SceneOptions {
    quality?: SceneQualityPreset;
    /** The seat anchor's id. */
    viewpoint?: string;
    /** The values of the manifest's settings table, by key. */
    values?: Record<string, string | number | boolean>;
}

export type SceneOptionsById = Record<string, SceneOptions>;

/** What import, export and the store keep of the scene settings. */
export interface SceneConfig {
    sceneId: string | null;
    sceneOptions: SceneOptionsById;
}

const QUALITIES: readonly string[] = ['low', 'medium', 'high'];
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export const sanitizeSceneId = (value: unknown): string | null => (isSceneId(value) ? value : null);

/** Keeps only what the store understands from a stored or imported options object. */
export const sanitizeSceneOptions = (value: unknown): SceneOptionsById => {
    if (!isRecord(value)) return {};
    const result: SceneOptionsById = {};
    for (const [id, raw] of Object.entries(value)) {
        if (!isSceneId(id) || !isRecord(raw)) continue;
        const options: SceneOptions = {};
        if (typeof raw.quality === 'string' && QUALITIES.includes(raw.quality)) options.quality = raw.quality as SceneQualityPreset;
        if (typeof raw.viewpoint === 'string' && raw.viewpoint !== '') options.viewpoint = raw.viewpoint;
        if (isRecord(raw.values)) {
            const values = Object.entries(raw.values).filter(([, entry]) => ['string', 'number', 'boolean'].includes(typeof entry));
            if (values.length > 0) options.values = Object.fromEntries(values) as SceneOptions['values'];
        }
        result[id] = options;
    }
    return result;
};

/**
 * The options after an import: each scene the import carries takes its options (sanitized), every
 * other scene keeps its own. The import plan and the apply both go through this.
 */
export const mergeImportedSceneOptions = (current: SceneOptionsById, imported: unknown): SceneOptionsById => ({
    ...current,
    ...sanitizeSceneOptions(imported),
});

const readStoredOptions = (): SceneOptionsById => {
    try {
        return sanitizeSceneOptions(JSON.parse(getStoredString(SCENE_OPTIONS_KEY, '{}')));
    } catch {
        return {};
    }
};

const saveSceneId = (sceneId: string | null) => (sceneId ? setStoredString(SCENE_ID_KEY, sceneId) : removeStoredKey(SCENE_ID_KEY));
const saveOptions = (options: SceneOptionsById) => setStoredString(SCENE_OPTIONS_KEY, JSON.stringify(options));

interface SceneSettingsState extends SceneConfig {
    /** Bumped by the scene-reload command: the host loads the scene again. Not stored. */
    reloadToken: number;
    setSceneId: (sceneId: string | null) => void;
    setSceneOptions: (sceneId: string, patch: Partial<SceneOptions>) => void;
    /** Takes the parts of an imported config that are present; options merge by scene id. */
    importSceneConfig: (config: Partial<SceneConfig>) => void;
    reloadScene: () => void;
}

export const useSceneSettingsStore = create<SceneSettingsState>((set, get) => ({
    sceneId: sanitizeSceneId(getStoredString(SCENE_ID_KEY, '')),
    sceneOptions: readStoredOptions(),
    reloadToken: 0,
    setSceneId: (value) => {
        const sceneId = sanitizeSceneId(value);
        saveSceneId(sceneId);
        set({ sceneId });
    },
    setSceneOptions: (sceneId, patch) => {
        if (!isSceneId(sceneId)) return;
        const current = get().sceneOptions;
        const next = sanitizeSceneOptions({ ...current, [sceneId]: { ...current[sceneId], ...patch } });
        saveOptions(next);
        set({ sceneOptions: next });
    },
    importSceneConfig: (config) => {
        if ('sceneId' in config) get().setSceneId(config.sceneId ?? null);
        if ('sceneOptions' in config) {
            const sceneOptions = mergeImportedSceneOptions(get().sceneOptions, config.sceneOptions);
            saveOptions(sceneOptions);
            set({ sceneOptions });
        }
    },
    reloadScene: () => set(state => ({ reloadToken: state.reloadToken + 1 })),
}));

/** The scene settings as an exported config carries them. */
export const readSceneConfig = (): SceneConfig => {
    const { sceneId, sceneOptions } = useSceneSettingsStore.getState();
    return { sceneId, sceneOptions };
};
