import React from 'react';
import GridView from '../../src/library/suites/grid/collection/GridView';
import { createStaticCollectionResource } from '../../src/library/core/collection/resource/staticCollectionResource.service';
import type { CollectionResource } from '../../src/library/core/shared/resource.contract';
import { createScriptedPagingResource } from './gridEntrancePerf/scriptedPagingResource';
import type { CollectionMorphPlan } from '../../src/library/suites/grid/transitions/morphGeometry';
import { probeCentredCard } from '../../src/library/suites/grid/transitions/morphProbes';
import { picturesLookAlike } from '../../src/library/suites/grid/transitions/samePicture';
import { handOverStandIn } from '../../src/library/suites/grid/transitions/standInHandover';
import type { ProbeDefinition } from './definition';
// dev/probes/gridEntrancePerf.probe.tsx

/**
 * 大歌单打开时的**真实**代价：挂的是真正的 GridView（外部提供 tracks，所以它不会去请求
 * provider），按按钮时把网格挂上去（入场计划由 morphPlan 这个 prop 给），然后用 PerformanceObserver +
 * rAF 采样这一个窗口：
 *
 * - longtask：主线程被占住超过 50ms 的块（帧掉在这里）
 * - 帧间隔的最差值与超过 32ms 的帧数（肉眼能看到的顿）
 *
 * 观感相关的东西一个都不要改（曲线、时长、位移全保留），这个探针只负责给出「还有多少
 * 主线程时间被吃掉」的答案。数字直接写在 data-probe-reading 上，由 component 用例断言。
 *
 * 注意：这里的卡片是真实 PolaroidCard（有封面、按钮、阴影），所以 mount 成本是可信的；
 * 但它不经过首页的 morph 合成层，只量「网格挂载 + 级联入场」这一段 —— 那正是大歌单打开时
 * 和动画抢主线程的部分。
 */

const PLAYLIST = {
    source: 'online',
    providerId: 'netease',
    id: 'perf-playlist',
    name: 'Perf Playlist',
    type: 'playlist',
    coverUrl: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#3b5bdb"/></svg>')}`,
} as never;

/**
 * 生成一首歌：字段形状与 omni 返回的一致，封面用 data URI（把网络/解码排除在测量之外）。
 * `picture` is a cover the card does show: the grid reads a track's cover off its album, so a
 * track made without one is drawn with the empty plate (which is what the measurements here
 * have always been taken with).
 */
const makeTrack = (index: number, picture?: string) => ({
    id: 1_000_000 + index,
    name: `Track ${index}`,
    artists: [{ id: 7, name: 'Probe Artist' }],
    album: { id: 9, name: 'Probe Album', ...(picture ? { coverUrl: picture } : {}) },
    duration: 180000,
    coverUrl: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#2f9e44"/><text x="32" y="40" font-size="20" text-anchor="middle" fill="#fff">${index % 10}</text></svg>`)}`,
}) as never;

const THEME = { primaryColor: '#4f8cf7', secondaryColor: '#4f8cf7', accentColor: '#4f8cf7' } as never;
const ENTRANCE_PLAN = { kind: 'cascade' } as const;
const LANDING_COVER = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#3b5bdb"/></svg>')}`;

type PerfReading = {
    longTaskTotal: number;
    longTaskMax: number;
    longTaskCount: number;
    frames: number;
    worstFrame: number;
    slowFrames: number;
    /** 挂载了多少张卡片：渲染环是「视口附近的卡」，大歌单不该改变它。 */
    cards: number;
};

/**
 * What the handover of the stand-in to the centred card is tested with
 * (test/component/standInHandover.spec.ts). All absent, the page is as it always was.
 */
interface GridEntrancePerfProbeProps {
    /** The picture of the first track (the card the page is centred on): a URL the test serves, late or never. */
    firstCover?: string;
    /** Every track carries the picture that flies in, as the tracks of an album do. */
    albumCover?: boolean;
    /** How long after "open-landing" the flight has landed (its plan is taken back). */
    landingMs?: number;
    /** How many tracks the page opens with; 0 is a page that has stopped reading with none. */
    tracksAtFirst?: number;
    /** The tracks come this long after "open-landing"; the page is reading until then. Absent, they are there from the start. */
    tracksAfterMs?: number;
    /** The picture that flies in, where it is not to be the probe's own blue one: a URL the test serves. */
    flownCover?: string;
}

/** A resource that is still reading, with no track yet (`tracksAfterMs`): the stand-in is then the page's loading card. */
const createReadingResource = (key: string): CollectionResource => {
    const resource = createStaticCollectionResource(key, []);
    const reading = { ...resource.getSnapshot(), status: 'loading' as const };
    return { ...resource, getSnapshot: () => reading };
};

/** One commit of the grid: when React began to render for it, and how long it worked on that. */
type GridCommit = { startedAt: number; renderMs: number };

const GridEntrancePerfProbe: React.FC<GridEntrancePerfProbeProps> = ({
    firstCover, albumCover = false, landingMs = 500, tracksAtFirst = 2000, tracksAfterMs, flownCover = LANDING_COVER,
}) => {
    const [trackCount, setTrackCount] = React.useState(tracksAtFirst);
    // For a test: what a host measures before it backs out of a page (to measure in
    // mid-handover), and the comparison of two pictures and the handover itself (to put
    // pictures and cards of its own to).
    React.useEffect(() => {
        const hooks = window as unknown as {
            __probeCentredCard?: typeof probeCentredCard;
            __picturesLookAlike?: typeof picturesLookAlike;
            __handOverStandIn?: typeof handOverStandIn;
        };
        hooks.__probeCentredCard = probeCentredCard;
        hooks.__picturesLookAlike = picturesLookAlike;
        hooks.__handOverStandIn = handOverStandIn;
    }, []);
    // The tracks have not come yet (`tracksAfterMs`).
    const [isReading, setIsReading] = React.useState(false);
    // Every commit of the grid since it was last opened, for a test to read.
    const noteCommit = React.useCallback<React.ProfilerOnRenderCallback>((_id, _phase, actualDuration, _baseDuration, startTime) => {
        ((window as unknown as { __gridCommits?: GridCommit[] }).__gridCommits ??= []).push({ startedAt: startTime, renderMs: actualDuration });
    }, []);
    const [runId, setRunId] = React.useState(0);
    const [entrance, setEntrance] = React.useState(true);
    const [running, setRunning] = React.useState(false);
    const [reading, setReading] = React.useState<PerfReading | null>(null);
    // 分页模式：曲目像在线大歌单那样分页到达（见 scriptedPagingResource），量分页过程中的帧成本。
    const [paging, setPaging] = React.useState(false);
    const [pagingResource, setPagingResource] = React.useState<CollectionResource | null>(null);
    const tracks = React.useMemo(
        () => Array.from({ length: trackCount }, (_, index) => makeTrack(index, albumCover ? LANDING_COVER : index === 0 ? firstCover : undefined)),
        [albumCover, firstCover, trackCount],
    );
    // 曲目从静态资源来（不发请求），与真实宿主给网格的形态一致；还没读到时是一个读着的资源。
    const staticResource = React.useMemo(() => createStaticCollectionResource('probe:perf', tracks), [tracks]);
    const readingResource = React.useMemo(() => createReadingResource('probe:perf'), []);
    const resource = paging ? pagingResource : isReading ? readingResource : staticResource;
    React.useEffect(() => () => pagingResource?.dispose(), [pagingResource]);

    // 「有封面飞来」的那种打开：计划是 'morph'、带着飞来的那张图，半秒后计划收回（真实转场落地
    // 时就是这样）。undefined = 不是这种打开。
    const [landingPlan, setLandingPlan] = React.useState<CollectionMorphPlan | null | undefined>(undefined);

    const start = () => {
        setReading(null);
        setRunning(false);
        setLandingPlan(undefined);
        // 分页资源在每次打开时新建：分页从打开那一刻开始，正好落在测量窗口里。
        setPagingResource(paging ? createScriptedPagingResource(`probe:paging:${runId + 1}`, tracks) : null);
        // 每次换 key 重新挂载，模拟一次「打开」
        setRunId(current => current + 1);
    };

    // When the page was told that the flight had landed, on the page's own clock: in the commit
    // that takes the plan back, right after the grid's own effects of that commit. A test times
    // the handover from here (the click that opens the page is not on the page's clock).
    React.useLayoutEffect(() => {
        if (landingPlan === null) {
            (window as unknown as { __landedAt?: number }).__landedAt ??= performance.now();
        }
    }, [landingPlan]);

    const startLanding = () => {
        start();
        (window as unknown as { __gridCommits?: GridCommit[] }).__gridCommits = [];
        (window as unknown as { __landedAt?: number }).__landedAt = undefined;
        setLandingPlan({ kind: 'morph', coverUrl: flownCover, title: 'Clicked Card' });
        setTimeout(() => setLandingPlan(current => (current ? null : current)), landingMs);
        if (tracksAfterMs !== undefined) {
            setIsReading(true);
            setTimeout(() => setIsReading(false), tracksAfterMs);
        }
    };

    // 开着测量的窗口：网格挂载 + 级联入场的前 1.6 秒。
    React.useEffect(() => {
        if (runId === 0) return;
        setRunning(true);

        const longTasks: number[] = [];
        const observer = typeof PerformanceObserver === 'function'
            ? new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    longTasks.push(entry.duration);
                }
            })
            : null;
        try {
            observer?.observe({ entryTypes: ['longtask'] });
        } catch {
            // longtask 不被支持时退化成只看帧
        }

        const frameGaps: number[] = [];
        let last = performance.now();
        let raf = 0;
        const startedAt = last;
        const tick = (now: number) => {
            frameGaps.push(now - last);
            last = now;
            if (now - startedAt < 1600) {
                raf = requestAnimationFrame(tick);
                return;
            }
            observer?.disconnect();
            const sorted = [...frameGaps].sort((a, b) => a - b);
            setReading({
                longTaskTotal: longTasks.reduce((sum, value) => sum + value, 0),
                longTaskMax: longTasks.length > 0 ? Math.max(...longTasks) : 0,
                longTaskCount: longTasks.length,
                frames: frameGaps.length,
                worstFrame: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
                // 32ms ≈ 两帧：低于这个数的抖动肉眼基本看不出来
                slowFrames: frameGaps.filter(gap => gap > 32).length,
                cards: document.querySelectorAll('[data-folia-grid-item-id]').length,
            });
            setRunning(false);
        };
        raf = requestAnimationFrame(tick);
        return () => {
            cancelAnimationFrame(raf);
            observer?.disconnect();
        };
    }, [entrance, runId]);

    const buttonClass = 'rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/10';

    return (
        <div className="min-h-screen bg-zinc-900 text-zinc-200">
            {/* 工具条必须在网格之上：GridView 是 fixed inset-0 z-[110]，否则连按钮都点不到。 */}
            <div className="flex flex-wrap items-center gap-2 p-4" style={{ position: 'relative', zIndex: 200 }}>
                <button type="button" data-probe-action="open" className={buttonClass} onClick={start} disabled={running}>
                    打开 {trackCount} 首的歌单并测量
                </button>
                <button type="button" data-probe-action="open-landing" className={buttonClass} onClick={startLanding} disabled={running}>
                    按「有封面飞来」打开（放出替身卡）
                </button>
                {/* 对照组：同样的网格、同样的挂载成本，但不给入场计划（卡片走网格自带的入场：原地翻进来）。
                    两者的差就是「级联入场」比它多吃掉的主线程时间。 */}
                <button
                    type="button"
                    data-probe-entrance={entrance ? 'on' : 'off'}
                    className={buttonClass}
                    onClick={() => setEntrance(current => !current)}
                >
                    入场动画：{entrance ? '开' : '关（对照组）'}
                </button>
                <button
                    type="button"
                    data-probe-paging={paging ? 'on' : 'off'}
                    className={buttonClass}
                    onClick={() => { setPaging(current => !current); setReading(null); }}
                >
                    曲目到达：{paging ? '分页（150 + 每 100ms 1000 首）' : '一次给全'}
                </button>
                {[500, 2000, 5000].map(count => (
                    <button
                        key={count}
                        type="button"
                        data-probe-size={count}
                        className={buttonClass}
                        onClick={() => { setTrackCount(count); setReading(null); }}
                    >
                        {count} 首
                    </button>
                ))}
                <span className="text-xs text-zinc-400" data-probe-reading={reading ? JSON.stringify(reading) : ''}>
                    {reading
                        ? `longtask ${reading.longTaskTotal.toFixed(0)}ms / 最大 ${reading.longTaskMax.toFixed(0)}ms ×${reading.longTaskCount}；掉帧 ${reading.slowFrames} 帧，最差 ${reading.worstFrame.toFixed(0)}ms；卡片 ${reading.cards}`
                        : (running ? '测量中…' : '待测量')}
                </span>
            </div>

            {/* 高度固定，让网格有一块稳定的视口 */}
            <div style={{ position: 'relative', height: 'calc(100vh - 64px)' }}>
                {runId > 0 ? (
                    <React.Profiler id="grid" onRender={noteCommit}>
                        <GridView
                            key={runId}
                            title="Perf Playlist"
                            mode="tracks"
                            collection={PLAYLIST}
                            resource={resource}
                            theme={THEME}
                            isDaylight={false}
                            isInteractive
                            onBack={() => {}}
                            onDone={() => {}}
                            // "open": the cards' entrance is what is measured, by a plan of kind
                            // 'cascade' (no cover flies to the page, so it puts up no stand-in);
                            // the control group gets no plan at all.
                            // "open-landing": the plan of a page a cover flies to ('morph'), and
                            // none once the flight has landed.
                            morphPlan={landingPlan === undefined ? (entrance ? ENTRANCE_PLAN : null) : landingPlan}
                        />
                    </React.Profiler>
                ) : null}
            </div>
        </div>
    );
};

const definition: ProbeDefinition = {
    id: 'gridEntrancePerf',
    title: '大歌单打开的帧预算（真实 GridView）',
    description: '挂真实的 GridView + 2000/5000 首外部 tracks，测 longtask 与掉帧，用于判断级联入场的单帧成本。',
    Component: GridEntrancePerfProbe,
};

export default definition;
