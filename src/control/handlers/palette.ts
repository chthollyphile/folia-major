import { listPaletteCommands, runPaletteCommand } from '../palette';
import { requireString } from '../errors';
import type { ControlHandler } from '../types';

// src/control/handlers/palette.ts
// The command palette passthrough tools (PROTOCOL §2.5). The real work is in ../palette.ts.

export const paletteHandlers: Record<string, ControlHandler> = {
    folia_palette_list: (args, deps) => listPaletteCommands({
        ...(typeof args.query === 'string' ? { query: args.query } : {}),
        ...(typeof args.includeUnavailable === 'boolean' ? { includeUnavailable: args.includeUnavailable } : {}),
        ...(typeof args.includeHidden === 'boolean' ? { includeHidden: args.includeHidden } : {}),
    }, deps.context),

    folia_palette_run: async (args, deps) => {
        const id = requireString(args.id, 'id');
        const input = typeof args.input === 'string' ? args.input : undefined;
        return runPaletteCommand({ id, ...(input !== undefined ? { input } : {}) }, deps.context, deps.events);
    },
};
