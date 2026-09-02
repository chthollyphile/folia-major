import { type VisualizerMode } from '../../types';
import { BUILTIN_VISUALIZER_MODES, DEFAULT_VISUALIZER_MODE, assertBuiltinModeList } from '../../types/visualizerModes';
import {
    type VisualizerEntryModule,
    type VisualizerRegistryEntry,
} from './definition';

export type {
    VisualizerRegistryEntry,
    VisualizerSettingsPanelProps,
    VisualizerSettingsResetProps,
    VisualizerSharedProps,
    VisualizerTuningKind,
} from './definition';

// Central mode registry. Entries are discovered from each visualizer's local entry file.
const visualizerEntryModules = import.meta.glob<VisualizerEntryModule>('./*/entry.tsx', { eager: true });

const buildVisualizerRegistry = (modules: Record<string, VisualizerEntryModule>) => {
    const entries = Object.entries(modules).map(([path, module]) => {
        if (!module.default) {
            throw new Error(`[VisualizerRegistry] Missing default export in ${path}`);
        }

        return module.default;
    });
    const byMode: Partial<Record<VisualizerMode, VisualizerRegistryEntry>> = {};

    entries.forEach(entry => {
        if (byMode[entry.mode]) {
            throw new Error(`[VisualizerRegistry] Duplicate visualizer mode "${entry.mode}"`);
        }

        byMode[entry.mode] = entry;
    });

    return {
        entries: [...entries].sort((left, right) => left.order - right.order),
        byMode,
    };
};

const { entries: VISUALIZER_REGISTRY, byMode: VISUALIZER_REGISTRY_BY_MODE } =
    buildVisualizerRegistry(visualizerEntryModules);

export { VISUALIZER_REGISTRY };

// 只有走 glob 的这一侧知道目录里真正有什么，所以自检放在这里：清单漏了或多了一个模式，
// 应用启动时就炸，而不是等到某个 store 悄悄把用户的模式重置成 classic。
assertBuiltinModeList('VisualizerRegistry', VISUALIZER_REGISTRY.map(entry => entry.mode), BUILTIN_VISUALIZER_MODES);

// 权威定义在 types/visualizerModes.ts —— 那里不含 UI，store 和 OBS 短码可以直接用。
// 这里再导出一次，是为了不打断已经从 registry 取它的 16 个模块。
export { DEFAULT_VISUALIZER_MODE };

export const hasVisualizerMode = (mode: string | null | undefined): mode is VisualizerMode =>
    Boolean(mode && VISUALIZER_REGISTRY_BY_MODE[mode as VisualizerMode]);

export const getVisualizerRegistryEntry = (mode: VisualizerMode) =>
    VISUALIZER_REGISTRY_BY_MODE[mode] ?? VISUALIZER_REGISTRY_BY_MODE[DEFAULT_VISUALIZER_MODE]!;

export const getVisualizerModeLabel = (mode: VisualizerMode, t: (key: string) => string) => {
    const entry = getVisualizerRegistryEntry(mode);
    const translated = t(entry.labelKey);
    return !translated || translated === entry.labelKey ? entry.labelFallback : translated;
};

export const getVisualizerPreviewStartOffset = (mode: VisualizerMode, loopDuration: number) => {
    if (loopDuration <= 0) {
        return 0;
    }

    return getVisualizerRegistryEntry(mode).previewStartOffset % loopDuration;
};

export const getVisualizerScopedSeed = (mode: VisualizerMode, scope: string) =>
    `${scope}-${getVisualizerRegistryEntry(mode).previewSeed}`;

/*
 * Runtime contribution channel for mod visualizers (src/mods/modVisualizers).
 * Appends entries to the live registry so every consumer that iterates
 * VISUALIZER_REGISTRY or queries by mode picks them up without a rebuild.
 * Mode ids are prefixed (`mod:<modId>:<id>`) by the loader so a mod can never
 * shadow a builtin mode; duplicates are rejected.
 */
export const appendVisualizerEntry = (entry: VisualizerRegistryEntry): boolean => {
    if (VISUALIZER_REGISTRY_BY_MODE[entry.mode]) {
        return false;
    }
    VISUALIZER_REGISTRY_BY_MODE[entry.mode] = entry;
    VISUALIZER_REGISTRY.push(entry);
    return true;
};

/*
 * Removes a runtime-contributed mode (appended via appendVisualizerEntry).
 * Used when a mod is disabled/uninstalled or reloaded without the contribution:
 * the mode must disappear from both the ordered list and the by-mode lookup so
 * consumers no longer see it. Builtin modes have no removal path (and never
 * need one) because they only ever live in the initial registry.
 */
export const removeVisualizerEntry = (mode: VisualizerMode): boolean => {
    if (!VISUALIZER_REGISTRY_BY_MODE[mode]) {
        return false;
    }
    delete VISUALIZER_REGISTRY_BY_MODE[mode];
    const index = VISUALIZER_REGISTRY.findIndex((entry) => entry.mode === mode);
    if (index >= 0) {
        VISUALIZER_REGISTRY.splice(index, 1);
    }
    return true;
};
