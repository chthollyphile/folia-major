import type { VisualizerBackgroundMode } from '../../../types';
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

export const DEFAULT_VISUALIZER_BACKGROUND_MODE: VisualizerBackgroundMode = 'latent';

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
