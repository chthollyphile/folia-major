import React, { useState, type MouseEvent } from 'react';
import { Check, Maximize2, MoreHorizontal, Pause, Play, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { WallTitle } from '../../../components/wall/WallTitle';
import { PlayerState } from '../../../types';
import { selectDisplayPlayerState, usePlaybackStore } from '../../../stores/usePlaybackStore';
import { resolvePlaybackSurface, usePlaybackEntryViewStore } from '../../../stores/usePlaybackEntryViewStore';
import type { BravaisItem } from './bravaisLayer';
import type { BravaisEntryMenuItem } from './bravaisSeamModels';
import BravaisTileQuickActions from './BravaisTileQuickActions';

// src/library/suites/bravais/BravaisFocusCardBody.tsx
// 聚焦卡（6×6 就地展开的歌曲卡，设计稿 §7「聚焦卡」）的文字区：大标题，可点的歌手 / 专辑链接与时长，底部两个按钮
// 「立即播放」「加入队列」（已在队列时是「✓ 已在队列」）。立即播放之后去哪由 folia 的「播放进入视图」决定
// （宿主的播放端口），这里不另做原地播放。链接能不能点由 surface 判定（core 的 trackLinks 规则）。
// 实测反馈 1：「立即播放」改成与 Lattice 展开海报同样的纯图标按钮（无文字，可访问名与 title 仍是「立即播放」）；
// 队列按钮在「已在队列」时悬停 / 键盘聚焦显示「插入队列」——点它走的是应用的入队规则（applyQueueAddBehavior），
// 已在队列里的歌会被挪到队尾或下一首（按播放设置里的「加入队列的默认位置」），并不是什么都不做。正在播放的那首点了不动，不换文案。
// 实测反馈 fb3：正在播放的那张卡上，播放键变成暂停 / 继续（宿主的播放开关，同一个纯图标按钮；Enter 同样），旁边多一个
// 同族的纯图标「进入」按钮——按「播放后进入的视图」去 Lattice 或播放页（「留在原处」时去播放页）。只有展开的这一张订阅
// 播放状态与那项设置（离散值，暂停 / 继续时才重渲染）。

export type BravaisFocusCardActions = {
    play: (slotKey: string) => void;
    enqueue: (slotKey: string) => void;
    /** 歌曲卡片上悬浮的两颗（BravaisTileQuickActions）：能不能做、做。 */
    canCollect: (itemKey: string) => boolean;
    collect: (slotKey: string) => void;
    canSaveToPlaylist: (itemKey: string) => boolean;
    saveToPlaylist: (slotKey: string) => void;
    canOpenAlbum: (itemKey: string) => boolean;
    openAlbum: (slotKey: string) => void;
    canOpenArtist: (itemKey: string, index: number) => boolean;
    openArtist: (slotKey: string, index: number) => void;
    /** B7：卡片右上角「⋯」里的条目动作（移出歌单 / 不喜欢、手动匹配、加入歌单）。 */
    menuFor: (itemKey: string) => readonly BravaisEntryMenuItem[];
    runMenu: (slotKey: string, actionId: string) => void;
    /** 悬停磁贴（列表面板开着时联动高亮列表行）。 */
    hover: (slotKey: string | null) => void;
    /** fb3：宿主给了播放开关——正在播放的那首上，play 是暂停 / 继续（按钮按播放状态画）。 */
    togglesCurrent: boolean;
    /** fb3：进入播放视图（宿主给了才有）；只画在正在播放的那张卡上。 */
    enterPlayback?: () => void;
};

type BravaisFocusCardBodyProps = {
    slotKey: string;
    item: BravaisItem;
    queued: boolean;
    /** 这张是正在播放的那首（它在队列里，但入队对它不起作用）。 */
    current: boolean;
    titleWidth: number;
    actions: BravaisFocusCardActions;
};

/** 按钮上的点击不冒泡到磁贴（磁贴的点击是「展开 / 打开」）。 */
const handled = (run: () => void) => (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    run();
};

const BravaisFocusCardBody: React.FC<BravaisFocusCardBodyProps> = ({ slotKey, item, queued, current, titleWidth, actions }) => {
    const { t } = useTranslation();
    const artists = item.artists ?? [];
    const canOpenAlbum = Boolean(item.album) && actions.canOpenAlbum(item.key);
    // B7：右上角「⋯」——条目动作（声明 ∩ 控制器能力，由 surface 给出；没有就不显示）。
    const menu = actions.menuFor(item.key);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const toggles = current && actions.togglesCurrent;
    const isPlaying = usePlaybackStore(state => toggles && selectDisplayPlayerState(state) === PlayerState.PLAYING);
    const entersLattice = usePlaybackEntryViewStore(state => resolvePlaybackSurface(state.playbackEntryView) === 'lattice');
    const playLabel = toggles
        ? t(isPlaying ? 'libraryBravais.pausePlayback' : 'libraryBravais.resumePlayback')
        : t('libraryBravais.playNow');
    const enterLabel = t(entersLattice ? 'libraryBravais.enterLattice' : 'libraryBravais.enterPlayer');
    return (
        <>
        <BravaisTileQuickActions slotKey={slotKey} item={item} actions={actions} beside={menu.length > 0 ? 'more' : undefined} />
        {menu.length > 0 && (
            <span className="bravais-focus-more">
                <button
                    type="button"
                    className="bravais-chrome-button bravais-focus-more-toggle"
                    data-bravais-action="more"
                    aria-expanded={isMenuOpen}
                    aria-label={t('libraryBravaisCollection.more')}
                    title={t('libraryBravaisCollection.more')}
                    onClick={handled(() => setIsMenuOpen(open => !open))}
                >
                    <MoreHorizontal aria-hidden />
                </button>
                {isMenuOpen && (
                    <span className="bravais-focus-menu" role="menu" data-bravais-focus-menu={item.key}>
                        {menu.map(entry => (
                            <button
                                key={entry.id}
                                type="button"
                                role="menuitem"
                                className={entry.danger ? 'is-danger' : undefined}
                                data-bravais-action={entry.id}
                                onClick={handled(() => {
                                    setIsMenuOpen(false);
                                    actions.runMenu(slotKey, entry.id);
                                })}
                            >
                                {entry.label}
                            </button>
                        ))}
                    </span>
                )}
            </span>
        )}
        <span className="lattice-poster-copy bravais-focus-copy" data-bravais-focus-card={item.key}>
            <WallTitle title={item.title} expanded targetPosterWidth={titleWidth} />
            <span className="bravais-focus-links">
                {artists.map((name, index) => (
                    <React.Fragment key={`${index}:${name}`}>
                        {index > 0 && <i>,</i>}
                        {actions.canOpenArtist(item.key, index) ? (
                            <button type="button" data-bravais-action="open-artist" onClick={handled(() => actions.openArtist(slotKey, index))}>
                                {name}
                            </button>
                        ) : <span>{name}</span>}
                    </React.Fragment>
                ))}
                {item.album && (
                    <>
                        {artists.length > 0 && <i>·</i>}
                        {canOpenAlbum ? (
                            <button type="button" data-bravais-action="open-album" onClick={handled(() => actions.openAlbum(slotKey))}>
                                {item.album}
                            </button>
                        ) : <span>{item.album}</span>}
                    </>
                )}
                {item.durationLabel && (
                    <>
                        <i>·</i>
                        <span className="tabular-nums">{item.durationLabel}</span>
                    </>
                )}
            </span>
            <span className="bravais-focus-actions">
                <button
                    type="button"
                    className="bravais-chrome-button is-icon"
                    data-bravais-action="play"
                    data-bravais-playback={toggles ? (isPlaying ? 'playing' : 'paused') : undefined}
                    disabled={item.unavailable && !toggles}
                    aria-label={playLabel}
                    title={playLabel}
                    onClick={handled(() => actions.play(slotKey))}
                >
                    {toggles && isPlaying ? <Pause fill="currentColor" aria-hidden /> : <Play fill="currentColor" aria-hidden />}
                </button>
                {current && actions.enterPlayback && (
                    <button
                        type="button"
                        className="bravais-chrome-button is-icon"
                        data-bravais-action="enter"
                        data-bravais-enter={entersLattice ? 'lattice' : 'player'}
                        aria-label={enterLabel}
                        title={enterLabel}
                        onClick={handled(() => actions.enterPlayback?.())}
                    >
                        <Maximize2 aria-hidden />
                    </button>
                )}
                <button
                    type="button"
                    className={`bravais-chrome-button${queued && !current ? ' has-hover-label' : ''}`}
                    data-bravais-action="enqueue"
                    data-bravais-queued={queued || undefined}
                    disabled={item.unavailable}
                    onClick={handled(() => actions.enqueue(slotKey))}
                >
                    {queued && !current ? (
                        // 两种文案叠在同一格里（宽度取两者较宽的），悬停 / 聚焦时换显示；藏着的那份 visibility:hidden，不进可访问名。
                        <span className="bravais-enqueue-labels">
                            <span className="bravais-enqueue-rest"><Check aria-hidden />{t('libraryBravais.inQueue')}</span>
                            <span className="bravais-enqueue-hover"><Plus aria-hidden />{t('libraryBravais.insertIntoQueue')}</span>
                        </span>
                    ) : (
                        <>
                            {queued ? <Check aria-hidden /> : <Plus aria-hidden />}
                            {queued ? t('libraryBravais.inQueue') : t('libraryBravais.addToQueue')}
                        </>
                    )}
                </button>
            </span>
        </span>
        </>
    );
};

export default BravaisFocusCardBody;
