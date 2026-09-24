import type { VisualizerBackgroundMode } from '../../../types';
import { BUILTIN_VISUALIZER_BACKGROUND_MODES, DEFAULT_VISUALIZER_BACKGROUND_MODE, assertBuiltinModeList } from '../../../types/visualizerModes';
import type {
    VisualizerBackgroundEntryModule,
    VisualizerBackgroundRegistryEntry,
} from './definition';

// src/components/visualizer/backgrounds/registry.tsx
// Discovers shell-level background modes from their local entry modules.

const backgroundEntryModules = import.meta.glob<VisualizerBackgroundEntryModule>('./*/entry.tsx', { eager: true });

const buildBackgroundRegistry = (modules: Record<string, VisualizerBackgroundEntryModule>) => {
    const entries = Object.entries(modules).map(([path, module]) => {
        if (!module.default) {
            throw new Error(`[VisualizerBackgroundRegistry] Missing default export in ${path}`);
        }
        return module.default;
    });
    const byMode: Partial<Record<string, VisualizerBackgroundRegistryEntry>> = {};

    entries.forEach(entry => {
        if (byMode[entry.mode]) {
            throw new Error(`[VisualizerBackgroundRegistry] Duplicate background mode "${entry.mode}"`);
        }
        byMode[entry.mode] = entry;
    });

    return {
        entries: [...entries].sort((left, right) => left.order - right.order),
        byMode,
    };
};

const {
    entries: VISUALIZER_BACKGROUND_REGISTRY,
    byMode: VISUALIZER_BACKGROUND_REGISTRY_BY_MODE,
} = buildBackgroundRegistry(backgroundEntryModules);

export { VISUALIZER_BACKGROUND_REGISTRY };

assertBuiltinModeList(
    'VisualizerBackgroundRegistry',
    VISUALIZER_BACKGROUND_REGISTRY.map(entry => entry.mode),
    BUILTIN_VISUALIZER_BACKGROUND_MODES,
);

export { DEFAULT_VISUALIZER_BACKGROUND_MODE };

export const hasVisualizerBackgroundMode = (mode: unknown): mode is VisualizerBackgroundMode => (
    typeof mode === 'string' && Boolean(VISUALIZER_BACKGROUND_REGISTRY_BY_MODE[mode])
);

export const getVisualizerBackgroundRegistryEntry = (mode: VisualizerBackgroundMode) => (
    VISUALIZER_BACKGROUND_REGISTRY_BY_MODE[mode]
    ?? VISUALIZER_BACKGROUND_REGISTRY_BY_MODE[DEFAULT_VISUALIZER_BACKGROUND_MODE]!
);

export const getVisualizerBackgroundModeLabel = (
    mode: VisualizerBackgroundMode,
    t: (key: string) => string,
) => {
    const entry = getVisualizerBackgroundRegistryEntry(mode);
    const translated = t(entry.labelKey);
    return !translated || translated === entry.labelKey ? entry.labelFallback : translated;
};

/*
 * Runtime contribution channel for mod background types
 * (src/mods/folium/registries/backgrounds). Mode ids are prefixed
 * (`mod:<modId>:<id>`) so a mod can never shadow a builtin mode; duplicates are
 * rejected. The ordered list is kept sorted so pickers show mod types by order.
 */
export const appendVisualizerBackgroundEntry = (entry: VisualizerBackgroundRegistryEntry): boolean => {
    if (VISUALIZER_BACKGROUND_REGISTRY_BY_MODE[entry.mode]) {
        return false;
    }
    VISUALIZER_BACKGROUND_REGISTRY_BY_MODE[entry.mode] = entry;
    VISUALIZER_BACKGROUND_REGISTRY.push(entry);
    VISUALIZER_BACKGROUND_REGISTRY.sort((left, right) => left.order - right.order);
    return true;
};

/** Removes a runtime-contributed background type; builtin types have no removal path. */
export const removeVisualizerBackgroundEntry = (mode: VisualizerBackgroundMode): boolean => {
    if (!VISUALIZER_BACKGROUND_REGISTRY_BY_MODE[mode]) {
        return false;
    }
    delete VISUALIZER_BACKGROUND_REGISTRY_BY_MODE[mode];
    const index = VISUALIZER_BACKGROUND_REGISTRY.findIndex((entry) => entry.mode === mode);
    if (index >= 0) {
        VISUALIZER_BACKGROUND_REGISTRY.splice(index, 1);
    }
    return true;
};
