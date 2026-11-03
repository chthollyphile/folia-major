import { COMMAND_PALETTE_COMMANDS, isCommandPaletteCommandEnabled } from '../commandRegistry';
import type { CommandPaletteContext } from '../types';

// src/components/command-palette/globalShortcuts/runGlobalShortcutCommand.ts
// What a pressed system-wide shortcut does: run the bound command's palette entry, the same entry
// choosing it in the palette runs. A mod command is there too (mods/folium/registries/
// commandPaletteSync mirrors them), so its `run` gets its defaults and a throw is recorded against
// the mod by runFoliumCommand, without a notice; nothing of the result is shown here.

/**
 * Runs `commandId` from a global shortcut, asked against `context` at the press. Only a command that
 * neither takes input nor draws a panel can run without the palette on screen; anything else, or a
 * command that is gone or unavailable now, does nothing. Returns whether it was started.
 */
export const runGlobalShortcutCommand = (commandId: string, context: CommandPaletteContext): boolean => {
    const command = COMMAND_PALETTE_COMMANDS.find(entry => entry.id === commandId);
    if (!command || command.surface || command.requiresInput || !isCommandPaletteCommandEnabled(command, context)) {
        return false;
    }
    void command.execute('', context);
    return true;
};
