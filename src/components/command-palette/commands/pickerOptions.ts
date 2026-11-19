import { VISUALIZER_REGISTRY } from '../../visualizer/registry';
import { VISUALIZER_BACKGROUND_REGISTRY } from '../../visualizer/backgrounds/registry';
import type { VisualizerBackgroundMode, VisualizerMode } from '../../../types';
import type { CommandPaletteCommand, CommandPaletteContext, CommandPaletteMatch } from '../types';

// src/components/command-palette/commands/pickerOptions.ts
// Turns the glob-discovered visualizer and background registries into palette matches, so the
// pickers stay in sync with whatever modes exist without a hand-maintained list. Both registries
// are already in the app's eager graph via VisualizerRenderer, so importing them costs nothing.

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

const PICKER_ID_PREFIX = { visualizer: 'visualizer-pick-', background: 'background-pick-' } as const;

// The grid renders each tile's mode glyph, and matches only carry a command. Reading the mode
// back out of the id keeps that private to this module and its view.
export const readPickerMode = (kind: 'visualizer' | 'background', commandId: string) => (
    commandId.startsWith(PICKER_ID_PREFIX[kind]) ? commandId.slice(PICKER_ID_PREFIX[kind].length) : ''
);

// The picker header states the mode that is live right now, which may well be filtered out of the
// visible grid, so the label is read from the registry rather than from the match list.
export const getPickerModeLabel = (
    kind: 'visualizer' | 'background',
    mode: string,
    t: (key: string, fallback?: string) => string,
): string => {
    const entry = kind === 'visualizer'
        ? VISUALIZER_REGISTRY.find(candidate => candidate.mode === mode)
        : VISUALIZER_BACKGROUND_REGISTRY.find(candidate => String(candidate.mode) === mode);
    return entry ? t(entry.labelKey, entry.labelFallback) : mode;
};

type PickerOption = {
    id: string;
    mode: string;
    label: string;
    description: string;
    apply: (mode: string, context: CommandPaletteContext) => void;
};

/**
 * A picker row gets its own sentence about how the mode looks, which is longer and more visual
 * than the one-line description its flat switch command carries. A mode with no picker copy yet
 * falls back to that command description, then to the bare label — ids follow `<kind>-<mode>`
 * except Monet's background, whose only command is its full-overlay variant.
 */
const MODE_COMMAND_ID_OVERRIDES: Record<string, string> = { 'background-monet': 'background-monet-full-overlay' };

const readModeDescription = (
    kind: 'visualizer' | 'background',
    mode: string,
    label: string,
    t: (key: string, fallback?: string) => string,
) => {
    const commandId = MODE_COMMAND_ID_OVERRIDES[`${kind}-${mode}`] ?? `${kind}-${mode}`;
    const commandDescription = t(`commandPalette.commands.${commandId}.description`, label);
    return t(`commandPalette.pickerDescription.${kind}.${mode}`, commandDescription);
};

const buildOptions = (kind: 'visualizer' | 'background', context: CommandPaletteContext): PickerOption[] => (
    kind === 'visualizer'
        ? VISUALIZER_REGISTRY.map(entry => {
            const label = context.shared.t(entry.labelKey, entry.labelFallback);
            return {
                id: `${PICKER_ID_PREFIX.visualizer}${entry.mode}`,
                mode: entry.mode,
                label,
                description: readModeDescription('visualizer', entry.mode, label, context.shared.t),
                apply: (mode: string, ctx: CommandPaletteContext) => ctx.visualizer.setVisualizerMode(mode as VisualizerMode),
            };
        })
        : VISUALIZER_BACKGROUND_REGISTRY.map(entry => {
            const label = context.shared.t(entry.labelKey, entry.labelFallback);
            return {
                id: `${PICKER_ID_PREFIX.background}${entry.mode}`,
                mode: String(entry.mode),
                label,
                description: readModeDescription('background', String(entry.mode), label, context.shared.t),
                apply: (mode: string, ctx: CommandPaletteContext) => ctx.visualizer.setVisualizerBackgroundMode(mode as VisualizerBackgroundMode),
            };
        })
);

const toCommand = (
    option: PickerOption,
    kind: 'visualizer' | 'background',
    context: CommandPaletteContext,
): CommandPaletteCommand => ({
    id: option.id,
    group: 'visualizer',
    title: option.label,
    // Labels come from the visualizer registry, not from commandPalette.commands.<id>.
    textSource: 'runtime',
    description: option.description,
    keywords: [option.mode],
    closeAfterExecute: kind === 'visualizer' ? !context.visualizer.visualizerPickerKeepOpen : undefined,
    execute: (_input, context) => {
        option.apply(option.mode, context);
        return true;
    },
});

// Matches are ranked by how early the query hits the label or the mode id; an empty query keeps
// registry order so the grid is stable while the user is just looking.
export const buildPickerMatches = (
    kind: 'visualizer' | 'background',
    context: CommandPaletteContext,
    query: string,
): CommandPaletteMatch[] => {
    const normalizedQuery = normalize(query);
    return buildOptions(kind, context)
        .map((option, index) => {
            const haystacks = [normalize(option.label), normalize(option.mode)];
            if (!normalizedQuery) {
                return { option, score: 100 - index };
            }
            const best = haystacks
                .map(haystack => haystack.indexOf(normalizedQuery))
                .filter(position => position >= 0)
                .sort((left, right) => left - right)[0];
            return best === undefined ? null : { option, score: 100 - best };
        })
        .filter((entry): entry is { option: PickerOption; score: number } => entry !== null)
        .map(entry => ({ command: toCommand(entry.option, kind, context), score: entry.score, input: '' }));
};
