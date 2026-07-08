import { create } from 'zustand';
import type { DualTheme, SongResult, ThemeMode } from '../types';
import type { ThemeCacheSongKey } from '../services/themeCache';

// src/stores/useThemeQuickEditorStore.ts
// Holds the quick editor's open state and the latest editable theme snapshots.

export type ThemeQuickEditorKind = 'ai' | 'custom';

type ThemeQuickEditorContext = {
    aiTheme: DualTheme | null;
    customTheme: DualTheme | null;
    bgMode: ThemeMode;
    coverUrl: string | null;
    song: SongResult | null;
    songKey: ThemeCacheSongKey | null;
    isDaylight: boolean;
    promptSourceText: string | null;
    isPureMusic: boolean;
    songTitle: string | undefined;
};

type ThemeQuickEditorState = ThemeQuickEditorContext & {
    isOpen: boolean;
    editorKind: ThemeQuickEditorKind | null;
    canOpenEditor: boolean;
    setContext: (context: ThemeQuickEditorContext) => void;
    openEditor: (kind?: ThemeQuickEditorKind) => void;
    closeEditor: () => void;
};

const canOpenKind = (state: ThemeQuickEditorContext, kind: ThemeQuickEditorKind) => (
    kind === 'ai' ? true : Boolean(state.customTheme)
);

const resolveDefaultEditorKind = (state: ThemeQuickEditorContext): ThemeQuickEditorKind | null => {
    if (state.bgMode === 'custom' && state.customTheme) {
        return 'custom';
    }

    if (state.bgMode === 'ai') {
        return 'ai';
    }

    if (state.aiTheme) {
        return 'ai';
    }

    if (state.customTheme) {
        return 'custom';
    }

    return 'ai';
};

export const useThemeQuickEditorStore = create<ThemeQuickEditorState>((set, get) => ({
    aiTheme: null,
    customTheme: null,
    bgMode: 'default',
    coverUrl: null,
    song: null,
    songKey: null,
    isDaylight: false,
    promptSourceText: null,
    isPureMusic: false,
    songTitle: undefined,
    isOpen: false,
    editorKind: null,
    canOpenEditor: false,
    setContext: (context) => set(state => {
        const nextKind = state.editorKind && canOpenKind(context, state.editorKind)
            ? state.editorKind
            : null;

        return {
            ...context,
            isOpen: state.isOpen && Boolean(nextKind),
            editorKind: nextKind,
            canOpenEditor: true,
        };
    }),
    openEditor: (kind) => {
        const state = get();
        const nextKind = kind ?? resolveDefaultEditorKind(state);
        if (!nextKind || !canOpenKind(state, nextKind)) {
            return;
        }
        set({ isOpen: true, editorKind: nextKind });
    },
    closeEditor: () => set({ isOpen: false, editorKind: null }),
}));
