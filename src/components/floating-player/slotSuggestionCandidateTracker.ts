// src/components/floating-player/slotSuggestionCandidateTracker.ts
// 命令面板里哪一次使用算「在面板里常用」，以及什么时候拿去问要不要放上进度条。
//
// 只有用户自己打开的面板会话里执行的命令才算：面板外的按钮（槽位、墙面工具浮岛、设置页入口）
// 借面板打开的 surface、以及面板没开时由快捷键直接执行的命令，用户手边已经有入口了，不该再提议。
// 候选攒到面板收起后才交出去：面板开着时胶囊在遮罩底下，提示出来也看不见。

/** 面板这一次是谁打开的。 */
export type PaletteSessionSource = 'user' | 'external';

export const createSlotSuggestionCandidateTracker = () => {
    let session: PaletteSessionSource | null = null;
    let candidate: string | null = null;

    return {
        openSession: (source: PaletteSessionSource) => {
            session = source;
        },
        closeSession: () => {
            session = null;
        },
        /** 每次命令被记进最近和频次时调用；只在用户打开的会话里留作候选。 */
        recordUse: (commandId: string) => {
            if (session === 'user') {
                candidate = commandId;
            }
        },
        /** 面板收起后交出候选（只交一次）；面板还开着就先留着。 */
        takeCandidate: (isPaletteOpen: boolean): string | null => {
            if (isPaletteOpen || candidate === null) {
                return null;
            }
            const next = candidate;
            candidate = null;
            return next;
        },
    };
};

export type SlotSuggestionCandidateTracker = ReturnType<typeof createSlotSuggestionCandidateTracker>;
