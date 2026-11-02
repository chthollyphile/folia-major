// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { COMMAND_PALETTE_COMMANDS } from '../../../src/components/command-palette/commandRegistry';
import {
    PLAYER_CONTROL_SLOT_COMMAND_IDS,
    playerControlSlotActionForCommand,
} from '../../../src/components/floating-player/playerControlSlotActions';
import {
    PLAYER_CONTROL_SLOT_SUGGESTION_MIN_USES,
    PLAYER_CONTROL_SLOT_SUGGESTION_STORAGE_KEY,
    resolvePlayerControlSlotSuggestion,
    usePlayerControlSlotSuggestionStore,
} from '../../../src/components/floating-player/playerControlSlotSuggestionStore';
import { usePlayerChromeSettingsStore } from '../../../src/stores/usePlayerChromeSettingsStore';
import { createSlotSuggestionCandidateTracker } from '../../../src/components/floating-player/slotSuggestionCandidateTracker';

// 进度条槽位的「常用命令放上来？」提议：哪条命令对应哪个槽位、什么时候提、每个动作只提一次。

describe('槽位动作和命令的对应', () => {
    it('表里的每条命令都真实存在于命令面板', () => {
        const ids = new Set(COMMAND_PALETTE_COMMANDS.map(command => command.id));
        Object.values(PLAYER_CONTROL_SLOT_COMMAND_IDS).forEach(commandId => {
            expect(ids.has(commandId)).toBe(true);
        });
    });

    it('命令 id 能反查回槽位动作，别的命令得 null', () => {
        expect(playerControlSlotActionForCommand('sleep-timer')).toBe('sleep-timer');
        expect(playerControlSlotActionForCommand('playback-shuffle')).toBe('shuffle');
        expect(playerControlSlotActionForCommand('visualizer-picker')).toBeNull();
    });
});

describe('resolvePlayerControlSlotSuggestion', () => {
    const base = {
        commandId: 'sleep-timer',
        useCount: PLAYER_CONTROL_SLOT_SUGGESTION_MIN_USES,
        slots: ['loop', 'lyrics-timeline'] as const,
        offered: [] as const,
    };

    it('用到门槛次数、不在槽位里、没提过的才提', () => {
        expect(resolvePlayerControlSlotSuggestion(base)).toBe('sleep-timer');
    });

    it('衰减后还没到门槛不提', () => {
        expect(resolvePlayerControlSlotSuggestion({ ...base, useCount: PLAYER_CONTROL_SLOT_SUGGESTION_MIN_USES - 0.1 })).toBeNull();
    });

    it('已经在槽位里、提过、或者不是槽位动作的命令都不提', () => {
        expect(resolvePlayerControlSlotSuggestion({ ...base, slots: ['sleep-timer', 'loop'] })).toBeNull();
        expect(resolvePlayerControlSlotSuggestion({ ...base, offered: ['sleep-timer'] })).toBeNull();
        expect(resolvePlayerControlSlotSuggestion({ ...base, commandId: 'visualizer-picker' })).toBeNull();
    });
});

describe('usePlayerControlSlotSuggestionStore', () => {
    beforeEach(() => {
        localStorage.removeItem(PLAYER_CONTROL_SLOT_SUGGESTION_STORAGE_KEY);
        usePlayerControlSlotSuggestionStore.setState({ pending: null, offered: [] });
        usePlayerChromeSettingsStore.getState().handleSetPlayerControlSlot('primary', 'loop');
        usePlayerChromeSettingsStore.getState().handleSetPlayerControlSlot('secondary', 'lyrics-timeline');
    });

    it('按当前槽位判断，攒成待提议', () => {
        const store = usePlayerControlSlotSuggestionStore.getState();
        store.noteCommandUse('sleep-timer', PLAYER_CONTROL_SLOT_SUGGESTION_MIN_USES);
        expect(usePlayerControlSlotSuggestionStore.getState().pending).toBe('sleep-timer');

        store.dismiss();
        store.noteCommandUse('playback-loop', 20);
        expect(usePlayerControlSlotSuggestionStore.getState().pending).toBeNull();
    });

    it('真正提过一次就记进存储，之后不再提', () => {
        const store = usePlayerControlSlotSuggestionStore.getState();
        store.markShown('sleep-timer');
        expect(JSON.parse(localStorage.getItem(PLAYER_CONTROL_SLOT_SUGGESTION_STORAGE_KEY) ?? '[]')).toEqual(['sleep-timer']);

        store.noteCommandUse('sleep-timer', 30);
        expect(usePlayerControlSlotSuggestionStore.getState().pending).toBeNull();
    });
});

describe('createSlotSuggestionCandidateTracker', () => {
    it('用户自己打开的面板里用的命令，面板收起后交出一次', () => {
        const tracker = createSlotSuggestionCandidateTracker();
        tracker.openSession('user');
        tracker.recordUse('sleep-timer');
        expect(tracker.takeCandidate(true)).toBeNull();
        tracker.closeSession();
        expect(tracker.takeCandidate(false)).toBe('sleep-timer');
        expect(tracker.takeCandidate(false)).toBeNull();
    });

    it('面板外的按钮借面板打开的 surface 里用的命令不算', () => {
        const tracker = createSlotSuggestionCandidateTracker();
        tracker.openSession('external');
        tracker.recordUse('playback-volume');
        tracker.closeSession();
        expect(tracker.takeCandidate(false)).toBeNull();
    });

    it('面板没开时直接执行的命令（快捷键、槽位、浮岛）不算', () => {
        const tracker = createSlotSuggestionCandidateTracker();
        tracker.recordUse('playback-like');
        expect(tracker.takeCandidate(false)).toBeNull();

        // 上一次会话关掉后也不会残留成「用户会话」。
        tracker.openSession('user');
        tracker.closeSession();
        tracker.recordUse('playback-shuffle');
        expect(tracker.takeCandidate(false)).toBeNull();
    });
});
