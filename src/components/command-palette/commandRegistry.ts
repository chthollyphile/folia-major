import { ALL_COMMAND_PALETTE_COMMANDS } from './commands';
import { matchesCommandPlatform, matchesCommandScope } from './availability';
import { assertExecuteShortcutsArePrefixFree } from './executeShortcuts';
import { getQueueSongMatches, getQueueSongMatchesFromEvaluation } from './queueSongMatches';
import type { CommandPaletteCommand, CommandPaletteContext } from './types';

// src/components/command-palette/commandRegistry.ts
// Public entry point for the command list. Definitions live in ./commands/<group>Commands.ts
// and ranking lives in ./search/; this file only assembles and filters.

export { getQueueSongMatches, getQueueSongMatchesFromEvaluation };
export { getCommandPaletteMatches, matchCommandsExactly, rankCommands } from './search/rankCommands';

export const COMMAND_PALETTE_COMMANDS: CommandPaletteCommand[] = ALL_COMMAND_PALETTE_COMMANDS;

// The slices installed into the list at run time, each replaced whole by its setter.
const installedSlices: Record<'suite-chrome' | 'provider-search', readonly CommandPaletteCommand[]> = {
    'suite-chrome': [],
    'provider-search': [],
};

// Replaces one installed slice, re-checking the static list's invariants over the combined list: a duplicate id
// or an execute shortcut that is not prefix-free throws, and the list is left as it was.
const installSlice = (slice: keyof typeof installedSlices, commands: readonly CommandPaletteCommand[]) => {
    const rest = COMMAND_PALETTE_COMMANDS.filter(command => !installedSlices[slice].includes(command));
    const taken = new Set(rest.map(command => command.id));
    commands.forEach(command => {
        if (taken.has(command.id)) {
            throw new Error(`[CommandPalette] Duplicate command id "${command.id}"`);
        }
        taken.add(command.id);
    });
    assertExecuteShortcutsArePrefixFree([...rest, ...commands]);

    COMMAND_PALETTE_COMMANDS.splice(0, COMMAND_PALETTE_COMMANDS.length, ...rest, ...commands);
    installedSlices[slice] = [...commands];
};

/**
 * Puts the library suites' chrome commands (B2, built by commands/suiteChromeCommands from the manifests'
 * `chromeActions`) into the list, replacing whatever an earlier call put there — so a second call (HMR,
 * tests) does not duplicate them.
 *
 * They cannot be part of the static list: the manifests live behind the library registry, which this
 * module must not import. The app installs them once at startup (library/app/installLibrarySuiteChromeCommands),
 * before anything renders. The static list's invariants are re-checked over the combined list here, the
 * same way commands/index.ts checks them at module load: a duplicate id or an execute shortcut that is
 * not prefix-free against everything it can be offered with throws, and the list is left as it was.
 *
 * Mutated in place rather than reassigned, because every consumer imported the array itself (mod
 * commands are mirrored in the same way, see mods/folium/commandPaletteSync.ts).
 */
export const setSuiteChromeCommands = (commands: readonly CommandPaletteCommand[]) => {
    installSlice('suite-chrome', commands);
};

/**
 * Puts the online sources' search commands (commands/searchCommands buildProviderSearchCommands) into the list,
 * replacing the ones an earlier call put there. Installed by providerSearchCommandsInstaller.ts whenever the
 * registered sources change, with the same checks as the suite chrome slice.
 */
export const setProviderSearchCommands = (commands: readonly CommandPaletteCommand[]) => {
    installSlice('provider-search', commands);
};

// Availability is declared on each command: `platform` gates the environment, `scope` gates the
// surroundings, `isAvailable` gates the current state, and `hidden` keeps mode-carrier commands out
// of every listing. `hidden` is about listing only, so key-driven entry points check enablement
// without it — execute mode's `:` carrier is hidden yet must still answer its key.
export const isCommandPaletteCommandEnabled = (
    command: CommandPaletteCommand,
    context?: CommandPaletteContext,
) => (
    matchesCommandPlatform(command.platform)
    && matchesCommandScope(command.scope, context)
    && (command.isAvailable?.(context) ?? true)
);

// Deliberately NOT memoized here.
//
// `isAvailable` is documented to be asked afresh every time the palette opens, precisely because
// some predicates read a getter whose answer changes with nothing re-rendering the app — see
// `canUseTransitionPerformance` in ./types.ts, which flips when a model download finishes. A
// module-level cache keyed on context identity would serve those a stale answer, which is the one
// bug this whole gating design exists to avoid.
//
// The cost this used to carry — two full passes per rank cycle — is gone anyway: the palette hook
// now hands its already-filtered list to `rankCommands`, so the pass below runs once, inside one
// React memo. Identity stabilization lives there too, next to the `isOpen` key that invalidates it.
export const getAvailableCommandPaletteCommands = (context?: CommandPaletteContext) => (
    COMMAND_PALETTE_COMMANDS.filter(command => (
        !command.hidden && isCommandPaletteCommandEnabled(command, context)
    ))
);
