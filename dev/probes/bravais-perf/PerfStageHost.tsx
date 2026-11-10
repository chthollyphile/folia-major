import React, { Profiler, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_THEME } from '../../../src/services/baseThemes';
import type { LibrarySuiteStageProps } from '../../../src/library/core/suite/suite.contract';
import { useBravaisLayerRegistration } from '../../../src/library/suites/bravais/useBravaisLayerRegistration';
import BravaisStage from '../../../src/library/suites/bravais/BravaisStage';
import type { PerfJob } from './perfConfig';
import { buildCollectionLayers, buildHomeLayers, type PerfHomeTab } from './perfLayers';


/** 探针下面挂的 visualizer 自己决定画不画文字，不跟「墙后的画面」的报告。 */
const NOOP_BACKDROP = () => { };
// dev/probes/bravais-perf/PerfStageHost.tsx
// 挂一份真实的 BravaisStage（与宿主 GridViewOverlayHost 给的 props 同形），把合成的首页层 / 集合层推进 stage store，
// 并给测量循环一个驱动（PerfDriver）：滚轮平移走真实的 useWallPointerPan 滚轮处理；过滤进出、换页签就是换层描述
// （stage 按 decideDataUpdate / replace 自己决定怎么翻）；聚焦放大是点磁贴内容层（真实的 activate → expand）。
// stage 子树包在 React.Profiler 里，提交次数与耗时记进外面给的计数器。

export type PerfDriver = {
    /** stage 根节点（section[data-library-stage="bravais"]）。 */
    root: () => HTMLElement | null;
    /** 一次滚轮平移（屏幕像素；与触控板 / 滚轮同一条路径）。 */
    wheel: (dx: number, dy: number) => void;
    /** 集合层进 / 出过滤（有限态 ↔ 无限态）。 */
    toggleFilter: () => void;
    /** 首页换页签（歌单 ↔ 专辑）。 */
    switchTab: () => void;
    /** 点另一个块里一张完整可见的曲目磁贴（展开聚焦卡）；找不到可点的返回 false。 */
    expandNext: () => boolean;
};

export type PerfStageCounters = { commits: number; commitMs: number };

type PerfStageHostProps = {
    job: PerfJob;
    covers: readonly string[];
    counters: PerfStageCounters;
    onOcclusion: (occludes: boolean) => void;
    onDriver: (driver: PerfDriver | null) => void;
};

const blockOf = (slotKey: string | undefined) => slotKey?.split(',').slice(0, 2).join(',') ?? '';

/**
 * 下一张要点的曲目磁贴的内容层：中心在视口里（离四边至少 60px、底边让开播放条的 140px）、中心不在缝上、不在当前展开的
 * 块里，取离视口中心最近的。用 element.click() 派发（不做命中测试），所以只要求「在视口里」，展开后的相机 reveal 才不会
 * 走很远。
 */
const findExpandTarget = (root: HTMLElement): HTMLElement | null => {
    const view = root.getBoundingClientRect();
    const seam = root.querySelector('[data-bravais-seam]')?.getBoundingClientRect();
    const expandedBlock = blockOf(root.querySelector<HTMLElement>('[data-bravais-expanded]')?.dataset.bravaisSlot);
    const centerX = view.left + view.width / 2;
    const centerY = view.top + view.height / 2;
    let best: HTMLElement | null = null;
    let bestDistance = Infinity;
    root.querySelectorAll<HTMLElement>('.bravais-tile[data-library-entry]').forEach((tile) => {
        if (blockOf(tile.dataset.bravaisSlot) === expandedBlock) return;
        const rect = tile.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const inside = x > view.left + 60 && x < view.right - 60 && y > view.top + 60 && y < view.bottom - 140;
        // 只要求中心不在缝上：窄视口里大磁贴常常有一两像素压在缝边，按整块不相交算会一张都挑不出来。
        const clearOfSeam = !seam || seam.width < 1 || x < seam.left || x > seam.right;
        const distance = Math.hypot(x - centerX, y - centerY);
        if (inside && clearOfSeam && distance < bestDistance) {
            best = tile;
            bestDistance = distance;
        }
    });
    return (best as HTMLElement | null)?.querySelector<HTMLElement>('article') ?? null;
};

const PerfStageHost: React.FC<PerfStageHostProps> = ({ job, covers, counters, onOcclusion, onDriver }) => {
    const rootRef = useRef<HTMLDivElement>(null);
    const [filtered, setFiltered] = useState(false);
    const [tab, setTab] = useState<PerfHomeTab>('playlist');
    const onSelectTab = useCallback((key: string) => setTab(key === 'albums' ? 'albums' : 'playlist'), []);

    // 层描述只在条目数 / 封面变化时重建（真实 surface 也只在数据变化时换身份）。
    const home = useMemo(() => buildHomeLayers(job.items, covers, onSelectTab), [covers, job.items, onSelectTab]);
    const collection = useMemo(() => buildCollectionLayers(job.items, covers), [covers, job.items]);
    const onHome = job.scenario === 'tab';

    useBravaisLayerRegistration('home', home[tab]);
    useBravaisLayerRegistration('top', filtered ? collection.filtered : collection.all, !onHome);

    const navigation = useMemo<LibrarySuiteStageProps['navigation']>(() => (
        onHome ? { depth: 0, origin: null, activeType: null } : { depth: 1, origin: 'home', activeType: 'playlist' }
    ), [onHome]);

    useEffect(() => {
        const driver: PerfDriver = {
            root: () => rootRef.current?.querySelector<HTMLElement>('[data-library-stage="bravais"]') ?? null,
            wheel: (dx, dy) => {
                const field = rootRef.current?.querySelector('.bravais-field');
                field?.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, deltaY: dy, deltaMode: 0, bubbles: true, cancelable: true }));
            },
            toggleFilter: () => setFiltered(current => !current),
            switchTab: () => setTab(current => (current === 'playlist' ? 'albums' : 'playlist')),
            expandNext: () => {
                const root = driver.root();
                const target = root ? findExpandTarget(root) : null;
                target?.click();
                return Boolean(target);
            },
        };
        onDriver(driver);
        return () => onDriver(null);
    }, [onDriver]);

    const onRender = useCallback<React.ProfilerOnRenderCallback>((_id, _phase, actualDuration) => {
        counters.commits += 1;
        counters.commitMs += actualDuration;
    }, [counters]);

    return (
        <div ref={rootRef} className={`bperf-stage${job.seamBlur ? ' bperf-seam-blur' : ''}`}>
            <Profiler id="bravais-stage" onRender={onRender}>
                <BravaisStage
                    isInteractive
                    theme={DEFAULT_THEME}
                    isDaylight={false}
                    navigation={navigation}
                    reportPlayerOcclusion={onOcclusion}
                    reportPlayerBackdrop={NOOP_BACKDROP}
                />
            </Profiler>
        </div>
    );
};

// memo：探针自己的状态（进度文字等）变了不该让 stage 重渲染——否则 Profiler 量到的提交里混着探针的。
export default React.memo(PerfStageHost);
