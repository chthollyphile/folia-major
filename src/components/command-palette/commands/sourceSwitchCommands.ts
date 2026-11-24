import { Power } from 'lucide-react';
import i18n from '../../../i18n/config';
import type { ModSourceState } from '../../../mods/types';
import type { CommandPaletteCommand } from '../types';
import { defineCommand } from '../commandFactories';

// src/components/command-palette/commands/sourceSwitchCommands.ts
// The commands that switch one source, as "Settings → Sources" does (Folium 2.0 plan §5.3: the switches go into the
// command palette too). One command per state a source can move to now: enable, use only for matching (for a source
// that may), disable. Built from the main process's source states by sourceSwitchCommandsInstaller.ts, which puts
// them in again whenever the states, the registry or the mod list change; there are none on the web.

/** One source as the commands need it. */
export interface SourceSwitchTarget {
    sourceId: string;
    state: ModSourceState;
    /** May be used only for matching (the three states of its row on the Sources page). */
    threeStates: boolean;
    /** Its name now; read whenever the palette shows the command. */
    name: () => string;
}

/** What running a command does: switch `sourceId` to `state` (the installer reports how it went). */
export type SourceSwitchRun = (target: SourceSwitchTarget, state: ModSourceState) => Promise<void>;

const COMMAND_TEXT: Record<ModSourceState, { id: string; titleKey: string; title: string; descriptionKey: string; description: string; keywords: string[] }> = {
    enabled: {
        id: 'source-enable',
        titleKey: 'commandPalette.sourceEnableTitle',
        title: 'Enable {{source}}',
        descriptionKey: 'commandPalette.sourceEnableDescription',
        description: 'Turn {{source}} on: it shows in the switcher, sign-in and search again',
        keywords: ['enable source', 'turn on source', '启用音源', '打开音源', 'qiyong'],
    },
    matching: {
        id: 'source-matching',
        titleKey: 'commandPalette.sourceMatchingTitle',
        title: 'Use {{source}} only for matching',
        descriptionKey: 'commandPalette.sourceMatchingDescription',
        description: 'Keep {{source}} for lyric and song info matching only, out of the switcher and search',
        keywords: ['matching only', 'only for matching', '只用于匹配', '匹配', 'pipei'],
    },
    disabled: {
        id: 'source-disable',
        titleKey: 'commandPalette.sourceDisableTitle',
        title: 'Disable {{source}}',
        descriptionKey: 'commandPalette.sourceDisableDescription',
        description: 'Turn {{source}} off: nothing of it runs; its data and its songs in your lists stay',
        keywords: ['disable source', 'turn off source', '停用音源', '关闭音源', 'tingyong'],
    },
};

/** The states `target` can be switched to now, in the order of the Sources page. */
export const sourceSwitchStates = (target: Pick<SourceSwitchTarget, 'state' | 'threeStates'>): ModSourceState[] => (
    (['enabled', 'matching', 'disabled'] as const).filter(state => state !== target.state && (state !== 'matching' || target.threeStates))
);

/** The command id that switches `sourceId` to `state` (`source-enable-<id>`, …). */
export const sourceSwitchCommandId = (sourceId: string, state: ModSourceState): string => `${COMMAND_TEXT[state].id}-${sourceId}`;

/** The commands for `targets`, in their order: per source, one for each state it can move to now. */
export const buildSourceSwitchCommands = (targets: readonly SourceSwitchTarget[], run: SourceSwitchRun): CommandPaletteCommand[] => (
    targets.flatMap(target => sourceSwitchStates(target).map((state) => {
        const text = COMMAND_TEXT[state];
        const command = defineCommand({
            id: sourceSwitchCommandId(target.sourceId, state),
            group: 'settings',
            title: '',
            description: '',
            // The name as it is when the commands are built; the title carries the name of the moment.
            keywords: [...text.keywords, target.sourceId, target.name()],
            icon: Power,
            platform: ['electron'],
            textSource: 'runtime',
            execute: () => {
                void run(target, state);
                return true;
            },
        });
        return Object.defineProperties(command, {
            title: { get: () => i18n.t(text.titleKey, { source: target.name(), defaultValue: text.title }), enumerable: true },
            description: { get: () => i18n.t(text.descriptionKey, { source: target.name(), defaultValue: text.description }), enumerable: true },
        });
    }))
);
