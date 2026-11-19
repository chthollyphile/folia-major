// @vitest-environment jsdom
// @builtin-sources
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLyricMatchSources } from '@/hooks/useLyricMatchSources';
import { isLyricMatchSourceOffered } from '@/utils/lyrics/lyricMatchSources';
import { getLyricSource } from '@/utils/lyrics/lyricSources';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import type { LyricProviderSource } from '@/types';
import i18n from '@/i18n/config';

// Both manual choices and automatic matching offer Qishui while its source mod is registered: the mod runs in the
// desktop app only (the web build has no main entry for it), so there is no desktop bridge to look for any more.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

const offeredSources = (): LyricProviderSource[] => {
    let sources: LyricProviderSource[] = [];
    const Probe = () => { sources = useLyricMatchSources(); return null; };
    const container = document.body.appendChild(document.createElement('div'));
    const root = createRoot(container);
    try {
        act(() => root.render(createElement(Probe)));
    } finally {
        act(() => root.unmount());
        container.remove();
    }
    return sources;
};

describe('Qishui lyric source', () => {
    it('is offered for manual and automatic matching, with no account, in its place among the built-in sources', () => {
        useOnlineProviderAccountStore.setState({ accounts: {} });
        const sources = offeredSources();
        expect(sources).toContain('qishui');
        expect(isLyricMatchSourceOffered('qishui')).toBe(true);
        expect(sources).toEqual(expect.arrayContaining(['netease', 'qq', 'kugou', 'amll']));
        expect(sources).not.toContain('spotify');
        // Its place is the one the built-in table gave it: after KuGou.
        expect(sources.indexOf('qishui')).toBe(sources.indexOf('kugou') + 1);
    });
    it('is listed under its full name, as the built-in table named it', () => {
        expect(i18n.t(getLyricSource('qishui')!.labelKey)).toBe(i18n.language.startsWith('zh') ? '汽水音乐' : 'Qishui Music');
    });
});
