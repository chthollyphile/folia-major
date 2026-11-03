// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLyricMatchSources } from '@/hooks/useLyricMatchSources';
import { isLyricMatchSourceOffered } from '@/utils/lyrics/lyricMatchSources';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import type { LyricProviderSource } from '@/types';

// Both manual choices and automatic matching must respect the actual desktop bridge availability.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

describe('Qishui lyric source runtime availability', () => {
    it.each([
        { label: 'browser', bridge: undefined, offered: false },
        { label: 'desktop without Qishui IPC', bridge: {}, offered: false },
        { label: 'desktop with Qishui IPC', bridge: { qishuiRequest: vi.fn() }, offered: true },
    ])('offers manual and automatic matching only in $label', ({ bridge, offered }) => {
        vi.stubGlobal('electron', bridge);
        useOnlineProviderAccountStore.setState({ accounts: {} });
        let sources: LyricProviderSource[] = [];
        const Probe = () => { sources = useLyricMatchSources(); return null; };
        const container = document.body.appendChild(document.createElement('div'));
        const root = createRoot(container);
        try {
            act(() => root.render(createElement(Probe)));
            expect(sources.includes('qishui')).toBe(offered);
            expect(isLyricMatchSourceOffered('qishui')).toBe(offered);
            expect(sources).toEqual(expect.arrayContaining(['netease', 'qq', 'kugou', 'amll']));
            expect(sources).not.toContain('spotify');
        } finally {
            act(() => root.unmount());
            container.remove();
        }
    });
});
