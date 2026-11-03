import React, { useEffect } from 'react';
import '../../src/i18n/config';
import PonderHost from '../../src/components/ponder/PonderHost';
import { usePonderStore } from '../../src/stores/usePonderStore';
import type { Theme } from '../../src/types';
import type { PonderTargetId } from '../../src/types/ponder';
import type { ProbeDefinition } from './definition';

// dev/probes/ponderPageSurfaces.probe.tsx
// One button per lesson scene the component spec opens. For pictures: ?open=<target id>&scene=<n>
// opens any lesson directly, and ?light=1 shows the stage in the light theme.

const PROBE_THEME = { accentColor: '#f43f5e' } as Theme;

const ENTRIES: Array<{ id: string; target: PonderTargetId; scene: number }> = [
    { id: 'grid-card-result', target: 'grid-page', scene: 2 },
    { id: 'grid-map-result', target: 'grid-page', scene: 3 },
    { id: 'grid-view-info', target: 'grid-view-page', scene: 2 },
    { id: 'lattice-poster', target: 'lattice-page', scene: 2 },
    { id: 'lattice-tools', target: 'lattice-page', scene: 3 },
    { id: 'bravais-wall-structure', target: 'bravais-wall', scene: 0 },
    { id: 'bravais-wall-pan', target: 'bravais-wall', scene: 1 },
    { id: 'bravais-wall-tiles', target: 'bravais-wall', scene: 2 },
    { id: 'bravais-wall-open', target: 'bravais-wall', scene: 3 },
    { id: 'bravais-wall-focus', target: 'bravais-wall', scene: 4 },
    { id: 'bravais-wall-look', target: 'bravais-wall', scene: 5 },
    { id: 'player-page-layout', target: 'player-page', scene: 0 },
    { id: 'player-page-palette', target: 'player-page', scene: 1 },
    { id: 'player-page-commands', target: 'player-page', scene: 2 },
    { id: 'player-page-shuffle', target: 'player-page', scene: 3 },
    { id: 'command-palette-execute', target: 'command-palette', scene: 2 },
    { id: 'side-panel-structure', target: 'side-panel', scene: 0 },
    { id: 'side-panel-tabs', target: 'side-panel', scene: 1 },
    { id: 'panel-cover-actions', target: 'panel-cover-actions', scene: 0 },
    { id: 'panel-cover-actions-right', target: 'panel-cover-actions', scene: 1 },
    { id: 'panel-cover-tab', target: 'panel-cover-tab', scene: 0 },
    { id: 'panel-source-tab', target: 'panel-source-tab', scene: 0 },
    { id: 'panel-source-contents', target: 'panel-source-tab', scene: 1 },
    { id: 'panel-controls-tab', target: 'panel-controls-tab', scene: 0 },
    { id: 'panel-queue-tab', target: 'panel-queue-tab', scene: 0 },
    { id: 'panel-account-tab', target: 'panel-account-tab', scene: 0 },
    { id: 'lattice-chrome-slots', target: 'lattice-chrome', scene: 1 },
    { id: 'lattice-chrome-bar', target: 'lattice-chrome', scene: 2 },
    { id: 'lyrics-animation', target: 'lyrics-animation-settings', scene: 0 },
    { id: 'grid-action-slide', target: 'grid-action-button', scene: 1 },
    { id: 'grid-view-edit-cards', target: 'grid-view-edit-mode', scene: 0 },
    { id: 'local-metadata-match', target: 'local-metadata-match', scene: 0 },
    { id: 'local-folder-delete', target: 'local-folder-actions', scene: 2 },
    { id: 'local-grid-controls-sources', target: 'local-grid-controls', scene: 0 },
    { id: 'online-collection-provider', target: 'online-collection-actions', scene: 1 },
    { id: 'local-grid-map-batch', target: 'local-grid-map-page', scene: 1 },
    { id: 'local-grid-map-tree', target: 'local-grid-map-directory-tree', scene: 1 },
    { id: 'local-track-sorting', target: 'local-track-sorting', scene: 0 },
    { id: 'queue-command-facets', target: 'queue-command-surface', scene: 0 },
    { id: 'queue-command-batch', target: 'queue-command-surface', scene: 1 },
    { id: 'transition-fallback', target: 'transition-settings', scene: 1 },
    { id: 'library-watch', target: 'local-library-watch', scene: 0 },
    { id: 'lyrics-settings', target: 'lyrics-settings', scene: 0 },
    { id: 'grid-hotkey', target: 'grid-palette-hotkey', scene: 0 },
    { id: 'grid3d-card-style', target: 'grid3d-card-style', scene: 0 },
    { id: 'grid-view-card-cover', target: 'grid-view-card-settings', scene: 0 },
    { id: 'grid-view-card-falloff', target: 'grid-view-card-settings', scene: 1 },
    { id: 'lattice-style-tint', target: 'lattice-style-settings', scene: 0 },
    { id: 'lattice-style-color', target: 'lattice-style-settings', scene: 1 },
    { id: 'onboarding-overview', target: 'help-page', scene: 0 },
    { id: 'onboarding-command-examples', target: 'help-page', scene: 2 },
    { id: 'ponder-basics', target: 'ponder-basics', scene: 0 },
    { id: 'desktop-wallpaper', target: 'folia-desktop', scene: 0 },
    { id: 'desktop-tray', target: 'folia-desktop', scene: 1 },
    { id: 'desktop-remote', target: 'folia-desktop', scene: 2 },
    { id: 'onboarding-shortcuts', target: 'folia-shortcuts', scene: 0 },
    { id: 'theme-settings', target: 'theme-settings', scene: 0 },
    { id: 'theme-settings-park', target: 'theme-settings', scene: 1 },
    { id: 'theme-settings-auto', target: 'theme-settings', scene: 2 },
    { id: 'player-bar-basics', target: 'player-bar', scene: 0 },
    { id: 'player-bar-height', target: 'player-bar', scene: 2 },
    { id: 'player-bar-shuffle', target: 'player-bar', scene: 4 },
    { id: 'player-bar-volume', target: 'player-bar', scene: 5 },
    { id: 'custom-shortcut-key', target: 'custom-shortcut-settings', scene: 0 },
    { id: 'custom-shortcut-command', target: 'custom-shortcut-settings', scene: 1 },
    { id: 'pinned-commands-slots', target: 'pinned-commands', scene: 0 },
    { id: 'pinned-commands-palette', target: 'pinned-commands', scene: 1 },
    { id: 'replay-gain-modes', target: 'replay-gain-settings', scene: 0 },
    { id: 'replay-gain-mirror', target: 'replay-gain-settings', scene: 1 },
    { id: 'import-export-scope', target: 'import-export-settings', scene: 0 },
    { id: 'import-export-confirm', target: 'import-export-settings', scene: 2 },
    { id: 'audio-equalizer-presets', target: 'audio-equalizer', scene: 0 },
    { id: 'audio-equalizer-write', target: 'audio-equalizer', scene: 1 },
    { id: 'vis-playground-layout', target: 'vis-playground', scene: 0 },
    { id: 'vis-playground-hotspots', target: 'vis-playground', scene: 1 },
    { id: 'vis-playground-common', target: 'vis-playground', scene: 2 },
    { id: 'vis-playground-visuals', target: 'vis-playground', scene: 3 },
    { id: 'vis-playground-subtitle', target: 'vis-playground', scene: 4 },
    { id: 'lyric-style-per-style', target: 'lyric-style', scene: 0 },
    { id: 'lyric-style-monet', target: 'lyric-style', scene: 1 },
    { id: 'lyric-style-combine', target: 'lyric-style', scene: 2 },
    { id: 'lyric-style-subtitle', target: 'lyric-style', scene: 3 },
    { id: 'theme-park-target', target: 'theme-park', scene: 0 },
    { id: 'theme-park-saving', target: 'theme-park', scene: 2 },
    { id: 'panel-controls-mode-list', target: 'panel-controls-tab', scene: 1 },
    { id: 'panel-queue-radio', target: 'panel-queue-tab', scene: 1 },
];

const ProbeBody: React.FC = () => {
    const query = new URLSearchParams(window.location.search);
    const isLight = query.get('light') === '1';
    const openTarget = query.get('open') as PonderTargetId | null;
    const openScene = Number(query.get('scene') ?? 0);

    useEffect(() => {
        if (openTarget) {
            usePonderStore.getState().openPonder(openTarget, openScene);
        }
    }, [openTarget, openScene]);

    return (
        <div className={`min-h-screen p-6 ${isLight ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-950 text-zinc-100'}`}>
            <div className="flex flex-wrap gap-2">
                {ENTRIES.map(entry => (
                    <button
                        key={entry.id}
                        type="button"
                        data-probe-open={entry.id}
                        onClick={() => usePonderStore.getState().openPonder(entry.target, entry.scene)}
                        className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs"
                    >
                        {entry.id}
                    </button>
                ))}
            </div>
            <PonderHost theme={PROBE_THEME} isDaylight={isLight} />
        </div>
    );
};

const probe: ProbeDefinition = {
    id: 'ponderPageSurfaces',
    title: 'Ponder page surfaces and operation results',
    description: 'Real page silhouettes plus animated Grid3D, GridView, and Lattice outcomes',
    Component: ProbeBody,
};

export default probe;
