import type { ControlEventsQuery } from '../types';
import type { ControlHandler } from '../types';

// src/control/handlers/events.ts
// folia_events: page the ring buffer, optionally long-polling (the wait itself lives in events.ts).

export const eventHandlers: Record<string, ControlHandler> = {
    folia_events: (args, deps) => {
        const query: ControlEventsQuery = {
            ...(typeof args.since === 'number' ? { since: args.since } : {}),
            ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
            ...(typeof args.waitMs === 'number' ? { waitMs: args.waitMs } : {}),
        };
        return deps.events.read(query);
    },
};
