import { describe, expect, it } from 'vitest';
import type { Line } from '@/types';
import { createCappellaAgentSenderResolver } from '@/components/visualizer/cappella/cappellaMessageSenders';

// test/unit/visualizer/cappellaMessageSenders.test.ts
// Covers TTML agent-to-chat-sender assignment for Cappella.
const createLine = (agentId?: string): Line => ({
    words: [],
    startTime: 0,
    endTime: 1,
    fullText: agentId ?? 'line',
    ...(agentId !== undefined ? { agentId } : {}),
});

describe('createCappellaAgentSenderResolver', () => {
    it('uses distinct TTML agents as stable Cappella senders', () => {
        const resolver = createCappellaAgentSenderResolver(
            [createLine('v1'), createLine('v2'), createLine('v1'), createLine('v3')],
            { rightAvatarIndex: 8, leftAvatarCount: 5 },
        );

        expect(resolver?.resolve(createLine('v1'))).toEqual({ side: 'right', avatarIndex: 8 });
        expect(resolver?.resolve(createLine('v2'))).toEqual({ side: 'left', avatarIndex: 0 });
        expect(resolver?.resolve(createLine('v3'))).toEqual({ side: 'left', avatarIndex: 1 });
        expect(resolver?.resolve(createLine('v1'))).toEqual({ side: 'right', avatarIndex: 8 });
    });

    it('falls back to the regular sender sequence without clear agent distinction', () => {
        expect(createCappellaAgentSenderResolver(
            [createLine('v1'), createLine('v1'), createLine()],
            { rightAvatarIndex: 8, leftAvatarCount: 5 },
        )).toBeNull();

        expect(createCappellaAgentSenderResolver(
            [createLine('  '), createLine()],
            { rightAvatarIndex: 8, leftAvatarCount: 5 },
        )).toBeNull();
    });

    it('ignores untagged lines when resolving agent senders', () => {
        const resolver = createCappellaAgentSenderResolver(
            [createLine(), createLine('v1'), createLine('v2')],
            { rightAvatarIndex: 8, leftAvatarCount: 5 },
        );

        expect(resolver?.resolve(createLine())).toBeNull();
        expect(resolver?.resolve(createLine('v2'))).toEqual({ side: 'left', avatarIndex: 0 });
    });
});
