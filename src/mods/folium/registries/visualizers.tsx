import React, { useMemo } from 'react';
import { appendVisualizerEntry, removeVisualizerEntry } from '@/components/visualizer/registry';
import type { VisualizerRegistryEntry, VisualizerSharedProps } from '@/components/visualizer/definition';
import VisualizerShell from '@/components/visualizer/VisualizerShell';
import VisualizerSubtitleOverlay from '@/components/visualizer/VisualizerSubtitleOverlay';
import { resolveSubtitleFontSizes } from '@/components/visualizer/subtitleFontSizes';
import { useVisualizerRuntime } from '@/components/visualizer/runtime';
import { getLineRenderEndTime } from '@/utils/lyrics/renderHints';
import type { VisualizerMode } from '@/types';
import type { FoliumParam, FoliumParamAccess, FoliumVisualizerDef } from '../contract';
import { sanitizeFoliumParams } from '../params';
import { createFoliumParamAccess } from '../paramStore';
import { createFoliumRegistry } from '../registry';
import { useFoliumStageContext } from '../stageContext';
import { FoliumMountHost } from '../FoliumMountHost';
import { FoliumSettingsCard } from '../FoliumSettingsCard';

// src/mods/folium/registries/visualizers.tsx
// `folium.registries.visualizers`: mod lyric-animation modes. Each accepted
// entry becomes a VisualizerRegistryEntry, so a mod mode works everywhere a
// builtin one does (player, preview, ThemePark, export window).
//
// Host mode id is `mod:<modid>:<name>`. The `mod:` prefix keeps mod modes
// structurally distinct from builtin ids (see isBuiltinVisualizerMode) and
// keeps users' saved selections from the pre-Folium bridge valid.

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

/*
 * The shared bottom subtitle layer (translation / upcoming line) for mod modes.
 * Builtin modes wire this inside their own renderers; a mod has no React and no
 * access to the host's subtitle settings, so the host fills the gap here and
 * mod modes get the same font scaling, opacity, offset, blur and content mode
 * as every builtin mode. Font sizes come from subtitleFontSizes, so switching
 * from a builtin mode to a mod mode keeps the subtitles in place.
 */
const FoliumSubtitleOverlay: React.FC<VisualizerSharedProps> = (props) => {
    const {
        currentTime,
        currentLineIndex,
        lines,
        theme,
        subtitleTheme,
        showText = true,
        lyricsFontScale = 1,
        subtitleFontScale = 1,
        subtitleOverlayOpacity,
        subtitleOverlayBackground,
        subtitleUpcomingLyricsBlur,
        isPlayerChromeHidden,
        hideTranslationSubtitle,
        showSubtitleTranslation,
        subtitleContentMode,
    } = props;
    const { activeLine, recentCompletedLine, nextLines } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });
    const subtitleFontSizes = resolveSubtitleFontSizes(lyricsFontScale);
    return (
        <VisualizerSubtitleOverlay
            showText={showText}
            activeLine={activeLine}
            recentCompletedLine={recentCompletedLine}
            nextLines={nextLines}
            theme={theme}
            subtitleTheme={subtitleTheme}
            {...subtitleFontSizes}
            subtitleFontScale={subtitleFontScale}
            subtitleOverlayOpacity={subtitleOverlayOpacity}
            subtitleOverlayBackground={subtitleOverlayBackground}
            subtitleUpcomingLyricsBlur={subtitleUpcomingLyricsBlur}
            isPlayerChromeHidden={isPlayerChromeHidden}
            hideTranslationSubtitle={hideTranslationSubtitle}
            showSubtitleTranslation={showSubtitleTranslation}
            subtitleContentMode={subtitleContentMode}
        />
    );
};

const FoliumVisualizerStage: React.FC<{
    id: string;
    modId: string;
    stored: StoredFoliumVisualizer;
    props: VisualizerSharedProps;
}> = ({ id, modId, stored, props }) => {
    const transparent = Boolean(props.background?.transparent);
    const surface = useMemo(
        () => ({ transparent, hostBackground: stored.hostBackground && !transparent }),
        [transparent, stored.hostBackground],
    );
    const ctx = useFoliumStageContext({
        lines: props.lines,
        currentTime: props.currentTime,
        currentLineIndex: props.currentLineIndex,
        paused: Boolean(props.paused),
        theme: props.theme,
        isDaylight: Boolean(props.isDaylight),
        songTitle: props.songTitle ?? null,
        songArtist: props.songArtist ?? null,
        songAlbum: props.songAlbum ?? null,
        staticMode: Boolean(props.staticMode),
        surface,
        settings: stored.settingsAccess,
    });
    return (
        <FoliumMountHost
            modId={modId}
            where={`visualizer ${id}`}
            mount={stored.def.mount}
            ctx={ctx}
            className="absolute inset-0"
        />
    );
};

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
        render: (props) => (
            <VisualizerShell
                theme={props.theme}
                audioPower={props.audioPower}
                audioBands={props.audioBands}
                sharedProps={props}
                renderBackground={stored.hostBackground}
            >
                <FoliumVisualizerStage id={id} modId={modId} stored={stored} props={props} />
                {stored.hostSubtitles ? <FoliumSubtitleOverlay {...props} /> : null}
            </VisualizerShell>
        ),
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
