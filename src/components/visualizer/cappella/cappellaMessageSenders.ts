import type { Line } from '../../../types';

// src/components/visualizer/cappella/cappellaMessageSenders.ts
// Resolves TTML agent ids into stable Cappella chat senders.
export type CappellaChatSide = 'left' | 'right';

export interface CappellaMessageSender {
    side: CappellaChatSide;
    avatarIndex: number;
}

interface CappellaAgentSenderOptions {
    rightAvatarIndex: number;
    leftAvatarCount: number;
}

export interface CappellaAgentSenderResolver {
    resolve: (line: Pick<Line, 'agentId'>) => CappellaMessageSender | null;
}

const normalizeAgentId = (agentId: string | undefined): string | null => {
    const trimmed = agentId?.trim();
    return trimmed ? trimmed : null;
};

const collectDistinctAgentIds = (lines: Array<Pick<Line, 'agentId'>>): string[] => {
    const ids: string[] = [];
    const seen = new Set<string>();

    lines.forEach(line => {
        const agentId = normalizeAgentId(line.agentId);
        if (!agentId || seen.has(agentId)) {
            return;
        }

        seen.add(agentId);
        ids.push(agentId);
    });

    return ids;
};

export const createCappellaAgentSenderResolver = (
    lines: Array<Pick<Line, 'agentId'>>,
    options: CappellaAgentSenderOptions,
): CappellaAgentSenderResolver | null => {
    const agentIds = collectDistinctAgentIds(lines);
    if (agentIds.length < 2) {
        return null;
    }

    const rightAgentId = agentIds[0];
    const leftAvatarCount = Math.max(1, options.leftAvatarCount);
    const senderByAgentId = new Map<string, CappellaMessageSender>();

    agentIds.forEach((agentId, index) => {
        senderByAgentId.set(agentId, agentId === rightAgentId
            ? {
                side: 'right',
                avatarIndex: options.rightAvatarIndex,
            }
            : {
                side: 'left',
                avatarIndex: (index - 1) % leftAvatarCount,
            });
    });

    return {
        resolve: line => {
            const agentId = normalizeAgentId(line.agentId);
            return agentId ? senderByAgentId.get(agentId) ?? null : null;
        },
    };
};
