import { buildStateSnapshot, buildStatusSnapshot, buildToolsList } from '../state';
import { evaluateControlExpression } from '../helpers';
import { requireString } from '../errors';
import type { ControlHandler, ControlStateQuery } from '../types';

// src/control/handlers/system.ts
// Introspection tools: status, the full state snapshot, the tool list, and the eval escape hatch.

export const systemHandlers: Record<string, ControlHandler> = {
    folia_status: async (_args, deps) => buildStatusSnapshot(deps.app),

    folia_state: (args, deps) => {
        const query: ControlStateQuery = {
            ...(args.includeQueue !== undefined ? { includeQueue: args.includeQueue as boolean } : {}),
            ...(args.includeLyrics !== undefined ? { includeLyrics: args.includeLyrics as boolean } : {}),
            ...(args.includeProviders !== undefined ? { includeProviders: args.includeProviders as boolean } : {}),
        };
        return buildStateSnapshot(query, deps.app);
    },

    folia_tools: (args) => {
        const group = typeof args.group === 'string' ? args.group : undefined;
        return { tools: buildToolsList(group) };
    },

    folia_eval: async (args) => {
        const expression = requireString(args.expression, 'expression');
        return evaluateControlExpression(expression);
    },
};
