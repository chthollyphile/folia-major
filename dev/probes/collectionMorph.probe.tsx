import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CollectionMorphOverlay } from '../../src/library/suites/grid/transitions/CollectionMorphOverlay';
import { planForOpening, useCollectionMorphStore, useMorphPageExit } from '../../src/library/suites/grid/transitions/collectionMorphStore';
import { cardOf, probeCentredCard } from '../../src/library/suites/grid/transitions/morphProbes';
import ActiveGridMarker from '../../src/library/suites/grid/shared/ActiveGridMarker';
import {
    ARTIST_INTRO_ATTR,
    CARD_TITLE_ATTR,
    GRID3D_CARD_INDEX_ATTR,
    GRID_CARD_ITEM_ID_ATTR,
    MORPH_FRAME_ATTR,
    MORPH_SOURCE_ATTR,
    MORPH_TARGET_ATTR,
} from '../../src/library/suites/grid/transitions/gridMorphContract';
import { useReducedMotionFor } from '../../src/hooks/useReducedMotionFor';
import { useCollectionNavigationStore } from '../../src/stores/useCollectionNavigationStore';
import { useMotionSettingsStore } from '../../src/stores/useMotionSettingsStore';
import type { GridViewCollectionDescriptor } from '../../src/components/app/home/gridViewCollectionAdapters';
import type { ProbeDefinition } from './definition';
// dev/probes/collectionMorph.probe.tsx

/**
 * 歌单展开的「移形换影」转场。挂的是真的 store、真的测量、真的 overlay；首页、详情页和
 * 宿主的三个动作（打开、压栈、返回）是手写的，做的事和 GridViewOverlayHost / GridView 一样：
 * 打开之前先提交入场计划，详情页在第一次渲染就放出替身卡，返回之前先量好中间那张卡，
 * 离开的那一页像真的那样先淡出再卸载。
 *
 * 要看的：
 * 1. 被点的卡片（外框、封面、标题）飞到详情页的替身卡上：第一帧就在卡片的位置，一路只动
 *    transform，落点和替身卡重合；
 * 2. 落点取的是**活动**那一页的：这里另放一个「正在退出的旧页」，它没有
 *    data-folia-active-grid，却有自己的落点标记，而且排在前面；
 * 3. 曲目晚到时替身卡一直留着，到了才换成真正的卡片，中途不再飞第二次；
 * 4. 返回时中间那张卡飞回被点的卡，这一页其余的卡片向外散开；歌手页（圆形）来回都收成圆；
 * 5. 降级时完全不出现，飞行途中拨上开关也立刻收掉。
 */

const cover = (label: string, color: string, width = 200, height = 200) => `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${color}"/>
  <text x="${width / 2}" y="${height / 2 + 10}" font-size="34" text-anchor="middle" fill="#fff">${label}</text>
</svg>`)}`;

const HOME_COVER = cover('home', '#3b5bdb');
const WIDE_COVER = cover('wide', '#e8590c', 320, 180);
const DETAIL_COVER = cover('detail', '#2f9e44');
const OTHER_COVER = cover('other', '#495057');
const STALE_COVER = cover('stale', '#c92a2a');
const AVATAR_COVER = cover('avatar', '#7048e8');

const collectionOf = (type: 'playlist' | 'artist') => ({
    source: 'navidrome',
    type,
    id: `probe-${type}`,
    name: type === 'artist' ? 'Probe Artist' : 'Probe Playlist',
}) as unknown as GridViewCollectionDescriptor;

const fill = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' } as React.CSSProperties;
// A card's frame: 12px (a border of 1 and 11 of padding) around a 200px cover, so that a frame at
// 608 / 408 has its cover at 620 / 420.
const frame = {
    position: 'absolute', width: 224, padding: 11, boxSizing: 'border-box', borderRadius: 14,
    background: '#27272a', border: '1px solid rgba(255, 255, 255, 0.08)', boxShadow: '0 10px 24px rgba(0, 0, 0, 0.35)',
} as React.CSSProperties;
const coverBox = { position: 'relative', width: 200, height: 200, borderRadius: 8, overflow: 'hidden' } as React.CSSProperties;
const titleLine = { marginTop: 8, height: 20, fontSize: 14, fontWeight: 700, lineHeight: '20px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as React.CSSProperties;

// The other cards of the playlist's page, around the centred one.
const OTHERS = [{ id: 'b-1', left: 328, top: 408 }, { id: 'b-2', left: 888, top: 408 }, { id: 'b-3', left: 608, top: 120 }, { id: 'b-4', left: 888, top: 700 }];

/** The playlist's page, as GridView does it: a stand-in from the first render when a card flies
 * to it, the cards when the tracks have come. */
const PlaylistPage: React.FC<{ tracksAfterMs: number; onPush: () => void }> = ({ tracksAfterMs, onPush }) => {
    const plan = useCollectionMorphStore(state => state.plan);
    const pageExit = useMorphPageExit();
    const [standIn, setStandIn] = React.useState(() => (plan?.kind === 'morph' ? { coverUrl: plan.coverUrl ?? null, title: plan.title ?? null } : null));
    const [hasTracks, setHasTracks] = React.useState(false);
    React.useEffect(() => {
        const timer = setTimeout(() => setHasTracks(true), tracksAfterMs);
        return () => clearTimeout(timer);
    }, [tracksAfterMs]);
    React.useEffect(() => {
        if (standIn && !plan && hasTracks) setStandIn(null);
    }, [hasTracks, plan, standIn]);
    return (
        <motion.div data-probe-detail-grid initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={pageExit} style={{ position: 'fixed', inset: 0 }}>
            <ActiveGridMarker />
            {hasTracks && (
                <>
                    <div {...{ [GRID_CARD_ITEM_ID_ATTR]: 'a-1' }} data-probe-detail-card onClick={onPush} style={{ position: 'absolute', left: 608, top: 408, cursor: 'pointer' }}>
                        <div {...{ [MORPH_FRAME_ATTR]: '' }} style={{ ...frame, position: 'relative' }}>
                            <div style={coverBox}>
                                <img src={DETAIL_COVER} alt="" style={fill} data-probe-detail-cover />
                            </div>
                            <div {...{ [CARD_TITLE_ATTR]: '' }} style={titleLine}>Detail Song</div>
                        </div>
                    </div>
                    {OTHERS.map(other => (
                        <div key={other.id} {...{ [GRID_CARD_ITEM_ID_ATTR]: other.id }} data-probe-other-card={other.id} style={{ position: 'absolute', left: other.left, top: other.top }}>
                            <div {...{ [MORPH_FRAME_ATTR]: '' }} style={{ ...frame, position: 'relative' }}>
                                <div style={coverBox}><img src={OTHER_COVER} alt="" style={fill} /></div>
                                <div {...{ [CARD_TITLE_ATTR]: '' }} style={titleLine}>Other Song</div>
                            </div>
                        </div>
                    ))}
                </>
            )}
            {standIn && (
                <div data-probe-stand-in {...{ [MORPH_FRAME_ATTR]: '' }} style={{ ...frame, left: 608, top: 408, pointerEvents: 'none' }}>
                    <div {...{ [MORPH_TARGET_ATTR]: '' }} style={coverBox}>
                        {standIn.coverUrl && <img src={standIn.coverUrl} alt="" style={fill} data-probe-stand-in-cover />}
                    </div>
                    <div {...{ [CARD_TITLE_ATTR]: '' }} data-probe-stand-in-title style={titleLine}>{standIn.title ?? 'Probe Playlist'}</div>
                </div>
            )}
        </motion.div>
    );
};

/** The artist's page, as ArtistGridView does it: the round picture is where a card lands, and
 * it is not on the page until the artist has been read. */
const ArtistPage: React.FC<{ pictureAfterMs: number }> = ({ pictureAfterMs }) => {
    const pageExit = useMorphPageExit();
    const [isRead, setIsRead] = React.useState(false);
    React.useEffect(() => {
        const timer = setTimeout(() => setIsRead(true), pictureAfterMs);
        return () => clearTimeout(timer);
    }, [pictureAfterMs]);
    return (
        <motion.div data-probe-artist-grid initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={pageExit} style={{ position: 'fixed', inset: 0 }}>
            <ActiveGridMarker />
            {isRead && (
                <div {...{ [ARTIST_INTRO_ATTR]: 'avatar' }} style={{ position: 'absolute', left: 600, top: 430 }}>
                    <div
                        {...{ [MORPH_TARGET_ATTR]: '' }}
                        data-probe-artist-avatar
                        style={{ width: 240, height: 240, borderRadius: '50%', overflow: 'hidden', border: '4px solid rgba(255,255,255,0.1)', boxSizing: 'border-box' }}
                    >
                        <img src={AVATAR_COVER} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    </div>
                </div>
            )}
        </motion.div>
    );
};

const CollectionMorphProbe: React.FC = () => {
    const snapshot = useCollectionNavigationStore(state => state.snapshot);
    const plan = useCollectionMorphStore(state => state.plan);
    const morphEnabled = !useReducedMotionFor('collectionMorph');
    // 目标页面：歌单（替身卡落点）还是歌手（圆形头像落点）。
    const [destination, setDestination] = React.useState<'playlist' | 'artist'>('playlist');
    // 「上一页」：退出动画期间它还在 DOM 里，带着自己的落点标记。
    const [withStalePage, setWithStalePage] = React.useState(true);
    // 曲目多久之后到。
    const [tracksAfterMs, setTracksAfterMs] = React.useState(60);
    const active = snapshot?.stack[snapshot.stack.length - 1] ?? null;

    // What GridViewOverlayHost does: the plan before the navigation.
    const open = () => {
        const next = planForOpening();
        if (morphEnabled && next.kind === 'morph') useCollectionMorphStore.getState().commitPlan(next, 1);
        useCollectionNavigationStore.getState().openRoot(collectionOf(destination), 'home');
    };
    const push = () => {
        if (morphEnabled) useCollectionMorphStore.getState().commitPlan(planForOpening(), 2);
        useCollectionNavigationStore.getState().push(collectionOf('artist'));
    };
    // The card at the middle is measured while the page is there; the navigation moves a
    // moment later, as it does through the browser's history.
    const back = () => {
        const navigation = useCollectionNavigationStore.getState();
        const stack = navigation.snapshot?.stack ?? [];
        const centred = morphEnabled ? probeCentredCard() : null;
        if (centred) {
            if (stack.length <= 1) useCollectionMorphStore.getState().armExit(cardOf(centred));
            else useCollectionMorphStore.getState().armNestedExit(cardOf(centred));
        }
        setTimeout(() => {
            if (stack.length > 1 && navigation.snapshot) navigation.restore({ ...navigation.snapshot, stack: stack.slice(0, -1) });
            else navigation.clear();
        }, 20);
    };
    const reset = () => {
        useCollectionMorphStore.getState().clear();
        useCollectionNavigationStore.getState().clear();
    };

    const buttonClass = 'rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/10';

    return (
        <div
            className="min-h-screen bg-zinc-900 p-8 text-zinc-200"
            style={{ ['--bg-color' as string]: '#18181b', ['--text-primary' as string]: '#fafafa' }}
        >
            <div className="relative z-[200] flex flex-wrap gap-2">
                <button type="button" data-probe-action="back" className={buttonClass} onClick={back}>返回（先量卡片，再改导航）</button>
                <button type="button" data-probe-action="close-navigation" className={buttonClass} onClick={() => useCollectionNavigationStore.getState().clear()}>
                    通过历史返回关闭（不经过宿主）
                </button>
                <button type="button" data-probe-action="close" className={buttonClass} onClick={reset}>清空导航与计划</button>
                <button type="button" data-probe-action="destination" className={buttonClass} onClick={() => { reset(); setDestination(current => (current === 'artist' ? 'playlist' : 'artist')); }}>
                    目标：{destination === 'artist' ? '歌手页（圆形头像）' : '歌单（替身卡）'}
                </button>
                <button type="button" data-probe-action="slow-tracks" className={buttonClass} onClick={() => { reset(); setTracksAfterMs(current => (current === 60 ? 1500 : 60)); }}>
                    曲目：{tracksAfterMs} ms 后到
                </button>
                <button type="button" data-probe-action="toggle-stale" className={buttonClass} onClick={() => setWithStalePage(value => !value)}>
                    旧页：{withStalePage ? '在 DOM 里' : '已卸载'}
                </button>
                <button type="button" data-probe-action="reduce" className={buttonClass} onClick={() => useMotionSettingsStore.getState().handleToggleReducedMotionSurface('collectionMorph', true)}>
                    强制降级
                </button>
            </div>
            <p className="relative z-[200] mt-3 text-xs text-zinc-400">
                点下面的卡片开始。计划：
                <span data-probe-plan={plan?.kind ?? 'none'}>{plan?.kind ?? 'none'}</span>
                {' · '}转场启用：<span data-probe-enabled={String(morphEnabled)}>{String(morphEnabled)}</span>
                {' · '}层数：<span data-probe-depth={snapshot?.stack.length ?? 0}>{snapshot?.stack.length ?? 0}</span>
                {' · '}目标：<span data-probe-destination={destination}>{destination}</span>
            </p>

            {/* 首页。真实首页在详情页打开后过一会儿才 visibility: hidden（仍然可测量），这里照做。 */}
            <div style={{ visibility: snapshot ? 'hidden' : 'visible', transition: `visibility 0s linear ${snapshot ? 0.45 : 0}s` }}>
                {/* 首页滑条那样的卡片：外框里一张封面、一行标题。 */}
                <div {...{ [GRID3D_CARD_INDEX_ATTR]: '2' }} data-probe-home-card onClick={open} style={{ position: 'fixed', left: 40, top: 300, cursor: 'pointer' }}>
                    <div {...{ [MORPH_FRAME_ATTR]: '' }} data-probe-home-frame style={{ ...frame, position: 'relative' }}>
                        <div style={{ ...coverBox, borderRadius: 12 }}>
                            <img src={HOME_COVER} alt="" style={fill} />
                        </div>
                        <div {...{ [CARD_TITLE_ATTR]: '' }} data-probe-home-title style={{ ...titleLine, fontSize: 16 }}>Home Playlist</div>
                    </div>
                </div>
                {/* 探索页那样的卡片：宽图，没有外框，自己报名字。 */}
                <div {...{ [MORPH_SOURCE_ATTR]: 'playlist:wide' }} data-probe-wide-card onClick={open} style={{ position: 'fixed', left: 40, top: 640, width: 288, cursor: 'pointer' }}>
                    <div style={{ position: 'relative', width: 288, height: 162, borderRadius: 16, overflow: 'hidden' }}>
                        <img src={WIDE_COVER} alt="" style={fill} />
                    </div>
                    <div {...{ [CARD_TITLE_ATTR]: '' }} style={titleLine}>Wide Playlist</div>
                </div>
            </div>

            {/* 正在退出的旧页：刻意不带 data-folia-active-grid，排在活动页之前，带着自己的落点。 */}
            {active && withStalePage && (
                <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}>
                    <div {...{ [MORPH_TARGET_ATTR]: '' }} data-probe-stale-target style={{ position: 'absolute', left: 1000, top: 120, width: 120, height: 120, overflow: 'hidden' }}>
                        <img src={STALE_COVER} alt="" style={fill} />
                    </div>
                </div>
            )}

            <AnimatePresence initial={false}>
                {active && (active.type === 'artist'
                    ? <ArtistPage key={active.id} pictureAfterMs={tracksAfterMs === 60 ? 150 : 5000} />
                    : <PlaylistPage key={`${active.id}-${snapshot?.stack.length}`} tracksAfterMs={tracksAfterMs} onPush={push} />)}
            </AnimatePresence>

            <CollectionMorphOverlay enabled={morphEnabled} />
        </div>
    );
};

const definition: ProbeDefinition = {
    id: 'collectionMorph',
    title: '歌单展开的移形换影转场',
    description: '被点的卡片（外框、封面、标题）→ 详情页替身卡（含歌手圆形头像落点）、返回时其余卡片散开、活动页限定、曲目晚到与降级。',
    Component: CollectionMorphProbe,
};

export default definition;
