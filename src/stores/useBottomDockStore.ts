import { create } from 'zustand';
import type { BottomLayout } from '../utils/playerBottomBarLayout';

// src/stores/useBottomDockStore.ts
// 底部那一排（进度条胶囊、面板按钮、墙工具按钮、歌曲卡片、字幕）共用的离散状态，progress-bar v3：
// 现在是紧凑档还是桌面档、胶囊收着还是展开、有几颗按钮挂在胶囊右端、它们的面板开着没有、哪面墙能定位当前歌。
// 只放离散值，不放几何：位置由 CSS 按 <html data-bottom-layout / data-capsule> 摆，没人量元素。

/** 胶囊此刻的样子；none 是胶囊不在（没在放歌、控制条被关掉、Lattice 上海报盖着）。 */
export type DockCapsuleState = 'none' | 'rest' | 'expanded' | 'quick';

/** 墙（Lattice、bravais）上「定位正在播放的歌」那一下，紧凑档里由胶囊的封面按。 */
export type WallLocateAction = {
    run: () => void;
    /** 正在播放的歌在这面墙上有封面。 */
    isHere: boolean;
    /** 已经问过墙、墙还没答。 */
    isSeeking: boolean;
    title: string;
};

type BottomDockState = {
    layout: BottomLayout;
    /** 最近一次换档的时刻（performance.now）；卡片据此判断自己是不是因为换档才出现的。 */
    layoutChangedAt: number;
    /** 换档追踪开着（只在主窗口）；没开时不往 <html> 写属性，OBS 之类的页面不受影响。 */
    isTracking: boolean;
    capsule: DockCapsuleState;
    /** 挂在胶囊右端的按钮，按登记者记：同一时刻可能有两份（换页的交接里）。 */
    companions: Record<string, true>;
    /** 指针在挂着的按钮上：胶囊当作还在悬停，免得指针从胶囊挪到按钮上那一下胶囊收起来。 */
    companionHovered: boolean;
    /** 挂着的按钮的面板开着：胶囊不再悬停展开，两块玻璃不叠在一起。 */
    openCompanions: Record<string, true>;
    /** 登记了定位动作的墙，按登记先后排，最后登记的生效（进 Lattice 时 Lattice 盖在资料库墙上面）。 */
    wallLocates: ReadonlyArray<{ owner: string; action: WallLocateAction }>;
    setLayout: (layout: BottomLayout) => void;
    setTracking: (isTracking: boolean) => void;
    setCapsule: (capsule: DockCapsuleState) => void;
    setCompanion: (id: string, attached: boolean) => void;
    setCompanionHovered: (hovered: boolean) => void;
    setCompanionOpen: (id: string, open: boolean) => void;
    setWallLocate: (owner: string, action: WallLocateAction | null) => void;
};

const withKey = (record: Record<string, true>, id: string, on: boolean): Record<string, true> => {
    if (on === id in record) return record;
    if (on) return { ...record, [id]: true };
    return Object.fromEntries(Object.entries(record).filter(([key]) => key !== id));
};

export const useBottomDockStore = create<BottomDockState>(set => ({
    layout: 'desktop',
    layoutChangedAt: 0,
    isTracking: false,
    capsule: 'none',
    companions: {},
    companionHovered: false,
    openCompanions: {},
    wallLocates: [],
    setLayout: layout => set(state => (state.layout === layout
        ? state
        : { layout, layoutChangedAt: typeof performance === 'undefined' ? 0 : performance.now() })),
    setTracking: isTracking => set(state => (state.isTracking === isTracking ? state : { isTracking })),
    setCapsule: capsule => set(state => (state.capsule === capsule ? state : { capsule })),
    setCompanion: (id, attached) => set(state => {
        const companions = withKey(state.companions, id, attached);
        return companions === state.companions ? state : { companions };
    }),
    setCompanionHovered: companionHovered => set(state => (state.companionHovered === companionHovered ? state : { companionHovered })),
    setCompanionOpen: (id, open) => set(state => {
        const openCompanions = withKey(state.openCompanions, id, open);
        return openCompanions === state.openCompanions ? state : { openCompanions };
    }),
    setWallLocate: (owner, action) => set(state => {
        const index = state.wallLocates.findIndex(entry => entry.owner === owner);
        if (!action) {
            return index < 0 ? state : { wallLocates: state.wallLocates.filter(entry => entry.owner !== owner) };
        }
        if (index >= 0) {
            const next = [...state.wallLocates];
            next[index] = { owner, action };
            return { wallLocates: next };
        }
        return { wallLocates: [...state.wallLocates, { owner, action }] };
    }),
}));

/**
 * 指针离开挂件后多留这么久才算离开：从挂件挪回胶囊时，胶囊自己的悬停要过 20ms 才接上，
 * 中间不留这段余量的话胶囊会先收一下再展开。
 */
const COMPANION_HOVER_RELEASE_MS = 120;
let companionHoverReleaseTimer: ReturnType<typeof setTimeout> | undefined;

/** 鼠标或笔进了挂件（面板按钮、墙工具按钮）：胶囊当作还在悬停。手指不调它，补发的 mouseenter 不算。 */
export const holdCompanionHover = (): void => {
    clearTimeout(companionHoverReleaseTimer);
    useBottomDockStore.getState().setCompanionHovered(true);
};

/** 指针离开挂件；immediate 用在挂件卸载时，不等余量。 */
export const releaseCompanionHover = (immediate = false): void => {
    clearTimeout(companionHoverReleaseTimer);
    if (immediate) {
        useBottomDockStore.getState().setCompanionHovered(false);
        return;
    }
    companionHoverReleaseTimer = setTimeout(() => useBottomDockStore.getState().setCompanionHovered(false), COMPANION_HOVER_RELEASE_MS);
};

/** 此刻生效的墙定位动作（最后登记的那面墙）。 */
export const selectWallLocate = (state: Pick<BottomDockState, 'wallLocates'>): WallLocateAction | null => (
    state.wallLocates.length > 0 ? state.wallLocates[state.wallLocates.length - 1].action : null
);

/** 紧凑档、而且胶囊在：挂件（面板按钮、墙工具按钮）这时才缩进胶囊右端。 */
export const useIsDockCompactWithCapsule = (): boolean => useBottomDockStore(
    state => state.layout === 'compact' && state.capsule !== 'none',
);

export const useIsBottomLayoutCompact = (): boolean => useBottomDockStore(state => state.layout === 'compact');

// 把档位和胶囊状态写到 <html> 上，CSS 照着摆位置。只在主窗口开着追踪时写；值不变不写。
if (typeof document !== 'undefined') {
    const sync = (state: BottomDockState) => {
        const root = document.documentElement;
        if (!state.isTracking) {
            root.removeAttribute('data-bottom-layout');
            root.removeAttribute('data-capsule');
            return;
        }
        if (root.getAttribute('data-bottom-layout') !== state.layout) root.setAttribute('data-bottom-layout', state.layout);
        if (root.getAttribute('data-capsule') !== state.capsule) root.setAttribute('data-capsule', state.capsule);
    };
    useBottomDockStore.subscribe(sync);
}
