import { create } from 'zustand';
import { DEFAULT_NAVIDROME_HOME_SECTION, isNavidromeHomeSection, type NavidromeHomeSection } from './navidromeHomeModel';

// src/library/core/home/navidrome/useNavidromeHomeSectionStore.ts
// Navidrome 页签上次停在哪个 section（原先是 NavidromeGrid3DView 的组件状态，挂载时读一次 localStorage、
// 每次切换写回）。提到 store 后任何 suite 的首页读写同一份；localStorage 键与取值原样保留，旧的记忆不会丢。

const NAVIDROME_LAST_SECTION_KEY = 'folia_navidrome_last_section';

const readStoredSection = (): NavidromeHomeSection => {
    if (typeof window === 'undefined') return DEFAULT_NAVIDROME_HOME_SECTION;
    try {
        const saved = localStorage.getItem(NAVIDROME_LAST_SECTION_KEY);
        if (isNavidromeHomeSection(saved)) return saved;
    } catch (e) {
        console.warn('[NavidromeGrid3DView] Failed to restore navidrome last section:', e);
    }
    return DEFAULT_NAVIDROME_HOME_SECTION;
};

const writeStoredSection = (section: NavidromeHomeSection) => {
    try {
        localStorage.setItem(NAVIDROME_LAST_SECTION_KEY, section);
    } catch (e) {
        console.warn('[NavidromeGrid3DView] Failed to save navidrome last section:', e);
    }
};

type NavidromeHomeSectionState = {
    section: NavidromeHomeSection;
    setSection: (section: NavidromeHomeSection) => void;
    /** 从存储重新读一遍（探针模拟重启时用）。 */
    hydrate: () => void;
};

export const useNavidromeHomeSectionStore = create<NavidromeHomeSectionState>((set, get) => ({
    section: readStoredSection(),
    setSection: (section) => {
        writeStoredSection(section);
        if (get().section !== section) set({ section });
    },
    hydrate: () => set({ section: readStoredSection() }),
}));
