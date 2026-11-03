import type { PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/settings/settingsPage.target.ts

const settingsAnchor = {
    page: {
        kind: 'synthetic' as const,
        rect: { left: 0.5, top: 0.14, width: 0.62, height: 0.54, anchorX: 'center' as const },
        role: 'surface' as const,
        surfaceKind: 'settings-page' as const,
        labelKey: 'ponder.anchors.pages.settings',
    },
};

export default {
    id: 'settings-page',
    titleKey: 'ponder.targets.settingsPage',
    category: 'basics',
    summaryKey: 'ponder.summaries.settings_page',
    hoverSelector: null,
    relatedTargetIds: [],
    scenes: [
        {
            id: 'settings-page-overview',
            titleKey: 'ponder.scenes.settingsPageOverview',
            anchors: settingsAnchor,
            steps: [
                { kind: 'highlight', id: 'showSettings', anchor: 'page', intensity: [0, 0.7], durationMs: 520 },
                { kind: 'caption', id: 'overview', textKey: 'ponder.captions.pages.settings', pointTo: { anchor: 'page' }, durationMs: 4300, withPrevious: true },
                { kind: 'pause', id: 'readOverview' },
            ],
        },
        {
            id: 'settings-page-direct-navigation',
            titleKey: 'ponder.scenes.settingsPageDirectNavigation',
            anchors: {
                palette: {
                    kind: 'synthetic',
                    rect: { left: 0.5, top: 0.2, width: 0.42, height: 0.28, anchorX: 'center' },
                    role: 'surface',
                    surfaceKind: 'palette',
                    labelKey: 'ponder.anchors.pages.commandPalette',
                    // 按下 S 才打开，不是一进场就摆在那里。
                    startsHidden: true,
                },
            },
            steps: [
                { kind: 'keypress', id: 'openPalette', keys: ['Mod K'], at: 'bottom', durationMs: 1200, keyframe: true },
                { kind: 'reveal', id: 'showPalette', anchor: 'palette', transition: 'zoom', durationMs: 520 },
                { kind: 'caption', id: 'directNavigation', textKey: 'ponder.captions.pages.settingsDirectNavigation', pointTo: { anchor: 'palette' }, durationMs: 4300, withPrevious: true },
                { kind: 'pause', id: 'readDirectNavigation' },
            ],
        },
    ],
} satisfies PonderTargetDefinition;
