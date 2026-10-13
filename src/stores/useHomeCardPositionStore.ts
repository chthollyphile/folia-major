import { create } from 'zustand';

// src/stores/useHomeCardPositionStore.ts
// Session-only home card bookmarks survive view unmounts without persisting library data.

export type HomeCardPosition = { id: string; index: number };

type HomeCardPositionState = {
    positions: Record<string, HomeCardPosition>;
    remember: (scope: string, position: HomeCardPosition) => void;
    /** 换一批时用：整批内容替换后旧位置已无意义（新批第 30 张不是旧批第 30 张），应回到头部。 */
    forget: (scope: string) => void;
    clear: () => void;
};

export const useHomeCardPositionStore = create<HomeCardPositionState>(set => ({
    positions: {},
    remember: (scope, position) => set(state => {
        const previous = state.positions[scope];
        if (previous?.id === position.id && previous.index === position.index) return state;
        return { positions: { ...state.positions, [scope]: position } };
    }),
    forget: (scope) => set(state => {
        if (!(scope in state.positions)) return state;
        const next = { ...state.positions };
        delete next[scope];
        return { positions: next };
    }),
    clear: () => set({ positions: {} }),
}));
