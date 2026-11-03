// src/library/core/shared/snapshotGate.ts
// 资源快照交给 renderer 之前的那道门：紧急更新立即提交；后台更新（大歌单的分页）走 transition，
// 并且在 hold() 为真时（例如正在拖拽网格）先暂存，只保留最新的一份，等 flush() 再提交。
// 不用 useSyncExternalStore：外部 store 的更新总是同步渲染，包 startTransition 也无效。
//
// 展示保持（holdPresentation / releasePresentation）：renderer 自己的动画要求界面暂时停在当前这一帧
// （例如网格删卡的退出动画），资源和变更控制器照常立即提交，门把这期间到达的一切更新（紧急的也算）
// 都暂存，只留最新的一份；最后一个 token 放开时再提交。数据与动画由此分开：谁也不用等谁。

export type GateSnapshot = { hint: 'urgent' | 'background' };
export type GateApplyMode = 'sync' | 'transition';

export type SnapshotGate<S extends GateSnapshot> = {
    /** 资源每次通知时调用。 */
    offer: (snapshot: S) => void;
    /** 放行暂存的后台更新（如果有）；展示保持期间什么都不做。 */
    flush: () => void;
    hasHeld: () => boolean;
    /** 按住展示，同一个 token 重复按住只算一次。 */
    holdPresentation: (token: string) => void;
    /** 放开一个 token；全部放开时提交暂存的最新快照。不认识的 token 忽略。 */
    releasePresentation: (token: string) => void;
    isPresentationHeld: () => boolean;
};

export const createSnapshotGate = <S extends GateSnapshot>({
    hold,
    apply,
}: {
    hold: () => boolean;
    apply: (snapshot: S, mode: GateApplyMode) => void;
}): SnapshotGate<S> => {
    let held: S | null = null;
    /** 暂存期间到过紧急更新：放行时同步提交（最新的那份已经包含它）。 */
    let heldUrgent = false;
    const presentationTokens = new Set<string>();

    const take = () => {
        const snapshot = held;
        const urgent = heldUrgent;
        held = null;
        heldUrgent = false;
        return { snapshot, urgent };
    };

    return {
        offer: (snapshot) => {
            if (presentationTokens.size > 0) {
                held = snapshot;
                heldUrgent = heldUrgent || snapshot.hint === 'urgent';
                return;
            }
            if (snapshot.hint === 'urgent') {
                // 紧急更新本身就是完整快照，暂存的旧页一并作废。
                take();
                apply(snapshot, 'sync');
                return;
            }
            if (hold()) {
                held = snapshot;
                return;
            }
            take();
            apply(snapshot, 'transition');
        },
        flush: () => {
            if (!held || presentationTokens.size > 0) return;
            const { snapshot, urgent } = take();
            apply(snapshot!, urgent ? 'sync' : 'transition');
        },
        hasHeld: () => held !== null,
        holdPresentation: (token) => {
            presentationTokens.add(token);
        },
        releasePresentation: (token) => {
            if (!presentationTokens.delete(token) || presentationTokens.size > 0 || !held) return;
            // 紧急更新不等拖拽（与平时一致）；只有后台页的话，拖拽中继续暂存，等 flush。
            if (!heldUrgent && hold()) return;
            const { snapshot, urgent } = take();
            apply(snapshot!, urgent ? 'sync' : 'transition');
        },
        isPresentationHeld: () => presentationTokens.size > 0,
    };
};
