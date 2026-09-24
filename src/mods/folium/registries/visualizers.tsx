import React from 'react';
import { appendVisualizerEntry, removeVisualizerEntry } from '@/components/visualizer/registry';
import type { VisualizerRegistryEntry } from '@/components/visualizer/definition';
import type { VisualizerMode } from '@/types';
import type { FoliumParam, FoliumParamAccess, FoliumVisualizerDef } from '../contract';
import { sanitizeFoliumParams } from '../params';
import { createFoliumParamAccess } from '../paramStore';
import { createFoliumRegistry } from '../registry';
import { FoliumSettingsCard } from '../FoliumSettingsCard';

// src/mods/folium/registries/visualizers.tsx
// `folium.registries.visualizers`: mod lyric-animation modes. Each accepted
// entry becomes a VisualizerRegistryEntry, so a mod mode works everywhere a
// builtin one does (player, preview, ThemePark, export window).
//
// Host mode id is `mod:<modid>:<name>`. The `mod:` prefix keeps mod modes
// structurally distinct from builtin ids (see isBuiltinVisualizerMode) and
// keeps users' saved selections from the pre-Folium bridge valid.

const LazyFoliumVisualizerRender = React.lazy(() => import('./visualizerRender'));

export interface StoredFoliumVisualizer {
    def: FoliumVisualizerDef;
    mode: VisualizerMode;
    settings: FoliumParam[];
    settingsAccess: FoliumParamAccess | null;
    hostBackground: boolean;
    hostSubtitles: boolean;
}

export const foliumVisualizerMode = (id: string): VisualizerMode => `mod:${id}` as VisualizerMode;

const resolveLabelFallback = (label: Record<string, string | undefined>, id: string): string =>
    label['zh-CN'] ?? label.en ?? label[document?.documentElement?.lang] ?? id;

const buildRegistryEntry = (id: string, modId: string, stored: StoredFoliumVisualizer): VisualizerRegistryEntry => {
    const labelFallback = resolveLabelFallback(stored.def.label, id);
    const { settingsPanel } = stored.def;
    const { settingsAccess } = stored;
    return {
        mode: stored.mode,
        order: typeof stored.def.order === 'number' && Number.isFinite(stored.def.order) ? stored.def.order : 500,
        /*
         * Intentionally-unmapped key: getVisualizerModeLabel falls back to
         * labelFallback when the i18n dictionary has no entry, so mod labels work
         * in every locale without touching the locale files. The mode id must be
         * dot-joined here: i18next's default nsSeparator is ':', and a key like
         * `ui.modVisualizer.mod:<id>:<viz>` gets its namespace stripped before the
         * lookup *and* before parseMissingKeyHandler sees it, so the mangled
         * remainder ("<id>.<viz>") would come back as a "translation" and defeat
         * the fallback. Dots keep the key intact end-to-end.
         */
        labelKey: `ui.modVisualizer.${stored.mode.split(':').join('.')}`,
        labelFallback,
        previewSeed: stored.mode,
        previewStartOffset: 0,
        tuningKind: 'none',
        // Lazy like every builtin mode's renderer (callers provide Suspense): the
        // shell and subtitle layer pull in UI stores that registration alone —
        // e.g. in the export window's entry bundle — must not load.
        render: (props) => <LazyFoliumVisualizerRender id={id} modId={modId} stored={stored} props={props} />,
        renderSettingsPanel: settingsAccess
            ? (panelProps) => (
                <FoliumSettingsCard
                    modId={modId}
                    where={`visualizer ${id} settings`}
                    title={stored.def.label}
                    fallbackTitle={labelFallback}
                    access={settingsAccess}
                    customPanel={settingsPanel}
                    theme={panelProps.theme}
                    isDaylight={panelProps.isDaylight}
                    controlCardBg={panelProps.controlCardBg}
                    rangeInputClass={panelProps.rangeInputClass}
                />
            )
            : undefined,
    };
};

export const visualizersRegistry = createFoliumRegistry<FoliumVisualizerDef, StoredFoliumVisualizer>('visualizers', {
    validate: (def, { id }) => {
        if (typeof def.mount !== 'function') {
            throw new Error('visualizers.register: mount must be a function');
        }
        if (def.settingsPanel !== undefined && typeof def.settingsPanel !== 'function') {
            throw new Error('visualizers.register: settingsPanel must be a mount function');
        }
        const settings = sanitizeFoliumParams(def.settings);
        if (def.settingsPanel && settings.length === 0) {
            throw new Error('visualizers.register: settingsPanel needs a settings schema (it decides keys, defaults and validation)');
        }
        return {
            def,
            mode: foliumVisualizerMode(id),
            settings,
            settingsAccess: settings.length > 0 ? createFoliumParamAccess(`visualizer:${id}`, settings) : null,
            hostBackground: def.hostLayers?.background !== false,
            hostSubtitles: def.hostLayers?.subtitles !== false,
        };
    },
    onAdd: (entry) => {
        if (!appendVisualizerEntry(buildRegistryEntry(entry.id, entry.modId, entry.def))) {
            throw new Error(`visualizers.register: mode "${entry.def.mode}" already exists`);
        }
    },
    onRemove: (entry) => {
        removeVisualizerEntry(entry.def.mode);
    },
});
