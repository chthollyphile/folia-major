import { COMMAND_PALETTE_COMMANDS, isCommandPaletteCommandEnabled } from '../components/command-palette/commandRegistry';
import type { CommandPaletteCommand, CommandPaletteContext } from '../components/command-palette/types';
import { errorMessage } from '../utils/errorText';
import { ControlError } from './errors';
import type { ControlEventStore } from './types';
import type { ControlEventType } from './types';

// src/control/palette.ts
// Command palette passthrough (PROTOCOL §2.5): list the live registry and execute a command by id
// through `command.execute(input, context)` — never through commandPalette.invokeCommandById.

export type PaletteListQuery = {
    query?: string;
    includeUnavailable?: boolean;
    includeHidden?: boolean;
};

export type PaletteCommandSummary = {
    id: string;
    group: string;
    title: string;
    description: string;
    keywords: string[];
    hidden: boolean;
    available: boolean;
    requiresInput: boolean;
    hasSurface: boolean;
    executeShortcut?: string;
    scope?: string;
};

const summarizePaletteCommand = (
    command: CommandPaletteCommand,
    context: CommandPaletteContext,
    available?: boolean,
): PaletteCommandSummary => ({
    id: command.id,
    group: command.group,
    title: command.title,
    description: command.description,
    keywords: command.keywords,
    hidden: command.hidden === true,
    available: available ?? isCommandPaletteCommandEnabled(command, context),
    requiresInput: command.requiresInput === true,
    hasSurface: Boolean(command.surface),
    ...(command.executeShortcut ? { executeShortcut: command.executeShortcut } : {}),
    ...(command.scope ? { scope: command.scope } : {}),
});

const matchesQuery = (command: CommandPaletteCommand, needle: string): boolean => {
    if (!needle) {
        return true;
    }
    const haystacks = [command.id, command.title, command.description, ...command.keywords];
    return haystacks.some(value => value.toLowerCase().includes(needle));
};

/** folia_palette_list: the capability index agents browse before running a command. */
export const listPaletteCommands = (
    { query, includeUnavailable = false, includeHidden = false }: PaletteListQuery,
    context: CommandPaletteContext,
): { commands: PaletteCommandSummary[]; total: number; available: number } => {
    const needle = (query ?? '').trim().toLowerCase();
    const commands: PaletteCommandSummary[] = [];
    let availableCount = 0;
    COMMAND_PALETTE_COMMANDS.forEach((command) => {
        if (command.hidden === true && !includeHidden) {
            return;
        }
        if (!matchesQuery(command, needle)) {
            return;
        }
        const available = isCommandPaletteCommandEnabled(command, context);
        if (!available && !includeUnavailable) {
            return;
        }
        if (available) {
            availableCount += 1;
        }
        commands.push(summarizePaletteCommand(command, context, available));
    });
    return { commands, total: commands.length, available: availableCount };
};

/**
 * folia_palette_run: the command runs exactly as if picked in the palette, including commands
 * that open an inline surface. `false` from execute means "nothing happened" → unavailable.
 */
export const runPaletteCommand = async (
    { id, input }: { id: string; input?: string },
    context: CommandPaletteContext,
    events?: ControlEventStore,
): Promise<{ ok: true; id: string; title: string }> => {
    const command = COMMAND_PALETTE_COMMANDS.find(entry => entry.id === id);
    if (!command) {
        throw new ControlError('bad_request', `Unknown command palette id "${id}"`, {
            hint: 'Use folia_palette_list to discover command ids.',
        });
    }
    if (!isCommandPaletteCommandEnabled(command, context)) {
        throw new ControlError('unavailable', `Command "${id}" is not available in the current app state`, {
            command: id,
        });
    }

    let executed: boolean;
    try {
        executed = await command.execute(input ?? '', context);
    } catch (error) {
        if (error instanceof ControlError) {
            throw error;
        }
        throw new ControlError('internal', `Command "${id}" failed: ${errorMessage(error)}`);
    }
    if (executed !== true) {
        throw new ControlError('unavailable', `Command "${id}" did not run in the current app state`, {
            command: id,
        });
    }

    const eventType: ControlEventType = 'palette.executed';
    events?.record(eventType, { id: command.id, title: command.title, ...(input ? { input } : {}) });
    return { ok: true, id: command.id, title: command.title };
};
