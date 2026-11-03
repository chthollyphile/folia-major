import React, { useEffect, useMemo, useRef } from 'react';
import {
    appendVisualizerBackgroundEntry,
    removeVisualizerBackgroundEntry,
} from '@/components/visualizer/backgrounds/registry';
import type {
    VisualizerBackgroundRegistryEntry,
    VisualizerBackgroundRenderProps,
} from '@/components/visualizer/backgrounds/definition';
import type { Theme, VisualizerBackgroundMode } from '@/types';
import type { FoliumBackgroundContext, FoliumBackgroundDef, FoliumSetting, FoliumSettingAccess, FoliumSettingValues } from '../contract';
import { toFoliumTheme } from '../dto';
import { createFoliumAudio } from '../audio';
import { sanitizeFoliumParams } from '../../params/params';
import { createFoliumParamAccess } from '../../params/paramStore';
import { createFoliumRegistry } from '../../runtime/registry';
import { FoliumMountHost } from '../../runtime/FoliumMountHost';
import type { FoliumHostContext } from '../helpers';
import { useFoliumListeners, useFoliumNotifyOnChange } from '../../runtime/listeners';
import { FoliumSettingsCard } from '../../params/FoliumSettingsCard';
import { foliumMountName } from '../kinds';

// src/mods/folium/registries/backgrounds.tsx
// `folium.registries.backgrounds`: mod background types. Each becomes a
// VisualizerBackgroundRegistryEntry, so it shows up in the background picker
// and renders under every visualizer mode (previews and exports included). A
// background has no lyrics or clock; its context is theme, cover, pause, the
// audio analyser and its own settings.

export interface StoredFoliumBackground {
    def: FoliumBackgroundDef;
    mode: VisualizerBackgroundMode;
    settings: FoliumSetting[];
    settingsAccess: FoliumSettingAccess | null;
}

const EMPTY_SETTINGS: FoliumSettingValues = Object.freeze({});

const BACKGROUND = foliumMountName('backgrounds', 'background');
const BACKGROUND_SETTINGS = foliumMountName('backgrounds', 'settings');

const resolveLabelFallback = (label: Record<string, string | undefined>, id: string): string =>
    label['zh-CN'] ?? label.en ?? id;

/*
 * Background context: fixed per mount on staticMode only; theme, cover, pause
 * and settings are getters, and onChange fires when any of them changes.
 */
const useBackgroundContext = (
    props: VisualizerBackgroundRenderProps,
    settings: FoliumSettingAccess | null,
): FoliumHostContext<FoliumBackgroundContext> => {
    const propsRef = useRef(props);
    propsRef.current = props;
    const listeners = useFoliumListeners('background subscriber');

    const ctx = useMemo<FoliumHostContext<FoliumBackgroundContext>>(() => {
        const themeCache = { source: null as Theme | null, daylight: false, value: toFoliumTheme(null, false) };
        return Object.freeze({
            staticMode: props.staticMode,
            isPaused: () => propsRef.current.paused,
            getTheme: () => {
                const { theme, isDaylight } = propsRef.current;
                if (themeCache.source !== theme || themeCache.daylight !== isDaylight) {
                    themeCache.source = theme;
                    themeCache.daylight = isDaylight;
                    themeCache.value = Object.freeze(toFoliumTheme(theme, isDaylight));
                }
                return themeCache.value;
            },
            getSettings: () => settings?.get() ?? EMPTY_SETTINGS,
            getCoverUrl: () => propsRef.current.coverUrl ?? null,
            subscribe: listeners.subscribe,
            audio: createFoliumAudio(() => propsRef.current),
        });
    }, [props.staticMode, settings]);

    useFoliumNotifyOnChange(listeners, [props.paused, props.theme, props.isDaylight, props.coverUrl]);
    useEffect(() => settings?.onChange(listeners.notify), [settings]);
    return ctx;
};

const FoliumBackgroundStage: React.FC<{
    id: string;
    modId: string;
    stored: StoredFoliumBackground;
    props: VisualizerBackgroundRenderProps;
}> = ({ id, modId, stored, props }) => {
    const ctx = useBackgroundContext(props, stored.settingsAccess);
    // A transparent surface has nothing to paint behind: same rule the builtin renderer follows.
    if (props.config?.transparent) return null;
    return (
        <FoliumMountHost
            modId={modId}
            where={`background ${id}`}
            entryKind={BACKGROUND}
            entryId={id}
            mount={stored.def.mount}
            ctx={ctx}
            className="absolute inset-0 pointer-events-none"
        />
    );
};

const buildRegistryEntry = (id: string, modId: string, stored: StoredFoliumBackground): VisualizerBackgroundRegistryEntry => {
    const labelFallback = resolveLabelFallback(stored.def.label, id);
    const { settingsAccess } = stored;
    return {
        mode: stored.mode,
        order: typeof stored.def.order === 'number' && Number.isFinite(stored.def.order) ? stored.def.order : 500,
        // Intentionally-unmapped key; see the visualizers registry for why ':' becomes '.'.
        labelKey: `ui.modBackground.${stored.mode.split(':').join('.')}`,
        labelFallback,
        render: (props) => <FoliumBackgroundStage id={id} modId={modId} stored={stored} props={props} />,
        renderSettingsPanel: settingsAccess
            ? (panelProps) => (
                <FoliumSettingsCard
                    modId={modId}
                    where={`background ${id} settings`}
                    entryKind={BACKGROUND_SETTINGS}
                    entryId={id}
                    title={stored.def.label}
                    fallbackTitle={labelFallback}
                    access={settingsAccess}
                    customPanel={stored.def.settingsPanel}
                    theme={panelProps.theme}
                    isDaylight={panelProps.isDaylight}
                    controlCardBg={panelProps.controlCardBg}
                    rangeInputClass={panelProps.rangeInputClass}
                />
            )
            : undefined,
        resetSettings: settingsAccess ? () => settingsAccess.reset() : undefined,
    };
};

export const foliumBackgroundMode = (id: string): VisualizerBackgroundMode => `mod:${id}`;

export const backgroundsRegistry = createFoliumRegistry<FoliumBackgroundDef, StoredFoliumBackground>('backgrounds', {
    validate: (def, { id, modId }) => {
        if (typeof def.mount !== 'function') {
            throw new Error('backgrounds.register: mount must be a function');
        }
        const settings = sanitizeFoliumParams(def.settings, modId);
        if (def.settingsPanel && settings.length === 0) {
            throw new Error('backgrounds.register: settingsPanel needs a settings schema');
        }
        return {
            def,
            mode: foliumBackgroundMode(id),
            settings,
            settingsAccess: settings.length > 0 ? createFoliumParamAccess(`background:${id}`, settings) : null,
        };
    },
    onAdd: (entry) => {
        if (!appendVisualizerBackgroundEntry(buildRegistryEntry(entry.id, entry.modId, entry.def))) {
            throw new Error(`backgrounds.register: mode "${entry.def.mode}" already exists`);
        }
    },
    onRemove: (entry) => {
        removeVisualizerBackgroundEntry(entry.def.mode);
    },
});
