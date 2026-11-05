import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ListFilter, ListPlus, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getSizedCoverUrl } from '../../../utils/coverUrl';
import type { BravaisLayer } from './bravaisLayer';
import type { BravaisSeamActions } from './BravaisSeamContent';
import { BravaisSeamCollectionMenu, BravaisSeamCollectionMeta, BravaisSeamMetaLine, BravaisSeamStar, BravaisSeamStatusLine } from './BravaisSeamCollection';
import BravaisSeamAbout from './BravaisSeamAbout';
import { BravaisSeamFlipText } from './BravaisSeamFlip';
import BravaisSeamCrumbs from './BravaisSeamCrumbs';
import { openBravaisFilter } from './useBravaisSeamFilter';
import { BRAVAIS_ALBUM_COVER_PX } from './bravaisConstants';
import { resolveAlbumComposition } from './bravaisPosterComposition';
import { splitHeroWord } from './BravaisSeamPoster';
import {
    flyCoverBack,
    flyCoverToPoster,
    measureQuad,
    parkCoverBackOrigin,
    readCoverShadow,
    takeCoverFlightSource,
    takeParkedCoverBackOrigin,
    type BravaisHardShadow,
    type BravaisQuad,
} from './bravaisCoverFlight';
import './bravaisPoster.css';
import './bravaisAlbumPoster.css';

// src/library/suites/bravais/BravaisSeamAlbumPoster.tsx
// 专辑页的海报（完整等级下的专辑页缝，见 bravaisSeamTarget 的 'poster'）：凝彩的视觉语言，参考稿 album.png 竖过来——
// 上半是浅色点阵纸，封面斜着贴在上面（一条胶带、墨色硬阴影），旁边竖排一行碎字；一道斜线网纹把纸和下半的深色块切开；
// 色块上是「专辑 · 年份」的小标签、奶油色带立体残影的大标题（标题里一个词放大错开）、强调色下划线、「歌手 · 首数 · 时长 ·
// 流派」（带 id 的歌手名可以点开歌手页）、一句简介，最下面是播放全部 / 加入队列 / 收藏 / 「⋯ 更多」。色块上还有一个描边的水印大字。
// 构图按专辑定死（bravaisPosterComposition 的 resolveAlbumComposition），颜色从封面取（bravaisPosterPalette 的专辑那套，
// 变量写在 stage 根节点上）。缝里原有的功能都在：返回与面包屑、过滤当前页、补页进度、状态行与重试、结果提示。
// 纸、色块、网纹、水印这些底子不缩；倾斜时文字、封面与按钮（bravais-poster-ui）缩进安全区。
// 入场（挂载时放一次，换专辑按 layer.key 重新挂载）：纸从整张收到斜边、露出色块，封面落下贴上，标题每个词从不同方向
// 拼上来、立体残影晚半拍，下划线拉出，信息与按钮依次浮上来，胶带最后贴上；降低动态效果时只淡入（bravaisAlbumPoster.css）。
// 从墙上点专辑打开时，封面不是落下来，而是从被点的那张磁贴飞过来（bravaisCoverFlight）；返回时飞回去。

const WIDE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const TITLE_LINES = 3;

/** 一段字占几格：中日韩文字一个字一格，其余按 0.62 格估。 */
const columnsOf = (text: string) => [...text].reduce((sum, character) => sum + (WIDE.test(character) ? 1.02 : 0.62), 0);

/** 标题字号按一行要放几格收：标题最多折成 TITLE_LINES 行，最长的那个词不能被折开。 */
const titleColumns = (title: string) => {
    const longestWord = Math.max(0, ...title.split(/\s+/).filter(word => !WIDE.test(word)).map(columnsOf));
    return Math.max(2, longestWord, columnsOf(title) / TITLE_LINES);
};

/** 入场（封面飞来或落下、倾斜）放完的时刻，之后海报封面不再动。 */
const COVER_SETTLE_MS = 1300;

const BravaisSeamAlbumPoster: React.FC<{ layer: BravaisLayer; actions: BravaisSeamActions }> = ({ layer, actions }) => {
    const { t } = useTranslation();
    const { seam } = layer;
    const album = seam.album;
    const collection = seam.collection;
    const title = seam.title;
    const words = useMemo(() => splitHeroWord(title), [title]);
    const hero = words.find(word => word.hero)?.text;
    const ghost = [...(hero ?? title)].slice(-1).join('');
    const composition = useMemo(() => resolveAlbumComposition(layer.key), [layer.key]);
    const fold = useMemo(() => ({ label: t('libraryBravais.seamFoldStrip'), run: () => actions.setLevel('hidden') }), [actions, t]);
    const coverUrl = album?.coverUrl ? getSizedCoverUrl(album.coverUrl, BRAVAIS_ALBUM_COVER_PX) : undefined;
    const style = {
        '--bravais-album-title-columns': titleColumns(title),
        // 海报高度的百分比写成 cqh：纸往上延伸进出血后框变高了，百分比会跟着变，cqh 不会。
        '--bravais-album-divider-left': `${composition.divider.left}cqh`,
        '--bravais-album-divider-right': `${composition.divider.right}cqh`,
        '--bravais-album-cover-deg': `${composition.coverDeg}deg`,
        '--bravais-album-tape-x': `${composition.tape.x}%`,
        '--bravais-album-tape-deg': `${composition.tape.deg}deg`,
        '--bravais-album-underline': `${composition.underline}%`,
        '--bravais-album-hero-x': `${composition.hero.x}em`,
        '--bravais-album-hero-y': `${composition.hero.y}em`,
        '--bravais-album-hero-deg': `${composition.hero.deg}deg`,
    } as React.CSSProperties;
    const year = album?.kicker;
    // 封面飞行（bravaisCoverFlight）：从墙上被点的那张专辑飞来时，自己的封面先藏着、落地再露出；卸载（返回）时飞回那一格。
    const coverRef = useRef<HTMLElement>(null);
    const flownFromRef = useRef<{ slotKey: string; cardKey: string } | null>(null);
    const [coverFlight, setCoverFlight] = useState<'pending' | 'landed' | undefined>(undefined);
    const albumCoverUrl = album?.coverUrl;
    useLayoutEffect(() => {
        const cover = coverRef.current;
        const from = takeCoverFlightSource(albumCoverUrl);
        if (cover && from) {
            flownFromRef.current = { slotKey: from.slotKey, cardKey: from.cardKey };
            setCoverFlight('pending');
            flyCoverToPoster(from, cover, () => {
                // 同步露出（不等 React 重渲染），飞行的图下一帧才撤；落地后也不再放「落下」的入场。
                cover.setAttribute('data-flight', 'landed');
                setCoverFlight('landed');
            });
        } else {
            flownFromRef.current = takeParkedCoverBackOrigin(layer.key);
        }
        // 开发模式下 effect 会重跑一次（DOM 不动）：飞行不停，回程在 flyCoverBack 里等到封面真的不在了才出发。
        return () => {
            const origin = flownFromRef.current;
            // 还在这张专辑上（只是缝换了样子）：不飞，记下终点等海报回来。
            if (origin && actions.currentLayerKey?.() === layer.key) {
                parkCoverBackOrigin(layer.key, origin);
                return;
            }
            const from = coverQuadRef.current;
            const shadow = coverShadowRef.current;
            if (cover && origin && from && shadow && albumCoverUrl) flyCoverBack({ cover, from, shadow, ...origin, coverUrl: albumCoverUrl });
        };
    // 只在挂载 / 卸载时（换专辑按 layer.key 重新挂载）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // 回程的起点：入场放完后量一次封面（海报这一列在专辑页上不动），窗口尺寸变了再量。
    const coverQuadRef = useRef<BravaisQuad | null>(null);
    const coverShadowRef = useRef<BravaisHardShadow | null>(null);
    useEffect(() => {
        const measure = () => {
            if (!coverRef.current) return;
            const quad = measureQuad(coverRef.current);
            coverQuadRef.current = quad ?? coverQuadRef.current;
            coverShadowRef.current = readCoverShadow(coverRef.current, quad);
        };
        const timer = window.setTimeout(measure, COVER_SETTLE_MS);
        window.addEventListener('resize', measure);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener('resize', measure);
        };
    }, []);
    return (
        <section className="bravais-poster bravais-album-poster" style={style} aria-label={t('libraryBravaisAlbum.posterLabel')}
            data-bravais-poster data-bravais-album-poster>
            <div className="bravais-poster-ground" aria-hidden>
                <div className="bravais-album-paper" />
                <div className="bravais-album-hatch" />
                <div className="bravais-album-dots" />
                <div className="bravais-album-ghost" data-side={composition.ghostSide}>{ghost}</div>
                <div className="bravais-poster-grain" />
            </div>

            <div className="bravais-poster-ui">
                <div className="bravais-poster-top">
                    <div className="bravais-seam-crumbs">
                        {layer.onDone && (
                            <button type="button" className="bravais-seam-back" data-bravais-seam-action="back" onClick={layer.onDone}
                                aria-label={t('libraryBravais.seamBack')} title={t('libraryBravais.seamBack')}>
                                <ChevronLeft aria-hidden />
                            </button>
                        )}
                        <BravaisSeamCrumbs layer={layer} />
                    </div>
                    {seam.filter && (
                        <button type="button" className="bravais-poster-filter" data-bravais-seam-action="filter" onClick={openBravaisFilter}
                            title={seam.filter.placeholder}>
                            <ListFilter aria-hidden />{seam.filter.placeholder}
                        </button>
                    )}
                </div>

                <div className="bravais-album-stage">
                    <figure ref={coverRef} className="bravais-album-cover" data-bravais-album-cover data-flight={coverFlight}>
                        {coverUrl ? <img src={coverUrl} alt="" draggable={false} /> : <span className="bravais-album-cover-empty" />}
                        <span className="bravais-album-tape" aria-hidden />
                    </figure>
                    <div className="bravais-album-scrap" aria-hidden>
                        {title}{year ? ` · ${year}` : ''}
                    </div>
                </div>

                <div className="bravais-album-title-block">
                    {album?.kicker && <span className="bravais-album-kicker">{album.kicker}</span>}
                    <h2 className="bravais-album-title" data-bravais-seam-title data-bravais-album-title>
                        {words.map((word, index) => (
                            <span key={index} className={`bravais-album-word${word.hero ? ' is-hero' : ''}`} data-text={word.text}
                                data-space={word.text.trim() ? undefined : ''}
                                style={{ '--bravais-album-word-index': index } as React.CSSProperties}>{word.text}</span>
                        ))}
                    </h2>
                    <div className="bravais-album-underline" aria-hidden />
                </div>

                <div className="bravais-poster-bottom bravais-album-bottom">
                    <div className="bravais-album-facts" data-bravais-album-facts>
                        {album && album.artists.length > 0 && (
                            <span className="bravais-album-artists" data-bravais-album-artists>
                                {album.artists.map((artist, index) => (
                                    <React.Fragment key={`${artist.targetId ?? ''}:${index}`}>
                                        {index > 0 && <span className="bravais-album-artist-separator" aria-hidden> / </span>}
                                        {artist.targetId !== undefined && album.onOpenArtist ? (
                                            <button type="button" className="bravais-album-artist" data-bravais-seam-action="open-artist"
                                                onClick={() => album.onOpenArtist?.(artist)} title={t('libraryBravaisAlbum.openArtist', { name: artist.name })}>
                                                {artist.name}
                                            </button>
                                        ) : <span className="bravais-album-artist">{artist.name}</span>}
                                    </React.Fragment>
                                ))}
                            </span>
                        )}
                        {seam.meta && <BravaisSeamMetaLine as="span" meta={seam.meta} reload={collection?.reload} className="bravais-poster-meta" />}
                        {album?.facts.filter(fact => fact !== seam.meta).map(fact => <span key={fact} className="bravais-album-fact">{fact}</span>)}
                    </div>
                    {collection?.description && (
                        <BravaisSeamAbout data-bravais-seam-about="collection" text={collection.description} textAttribute="data-bravais-collection-description" />
                    )}
                    {collection && <BravaisSeamCollectionMeta collection={collection} />}
                    {seam.status && <BravaisSeamFlipText as="div" flipKey={seam.status} className="bravais-seam-status" data-bravais-seam-status>{seam.status}</BravaisSeamFlipText>}
                    {collection?.status && <BravaisSeamStatusLine status={collection.status} />}
                    <div className="bravais-poster-actions">
                        {seam.onPlayScope && (
                            <button type="button" className="bravais-poster-button is-primary" data-bravais-seam-action="play-scope" onClick={seam.onPlayScope}>
                                <Play aria-hidden />{seam.scopeLabels?.play ?? t('libraryBravais.playAll')}
                            </button>
                        )}
                        {seam.onEnqueueScope && (
                            <button type="button" className="bravais-poster-button" data-bravais-seam-action="enqueue-scope" onClick={seam.onEnqueueScope}>
                                <ListPlus aria-hidden />{seam.scopeLabels?.enqueue ?? t('libraryBravais.enqueueAll')}
                            </button>
                        )}
                        {collection?.subscribe && <BravaisSeamStar subscribe={collection.subscribe} />}
                        <BravaisSeamCollectionMenu collection={collection} onOpenList={actions.openList} fold={fold} />
                    </div>
                </div>
            </div>
        </section>
    );
};

export default BravaisSeamAlbumPoster;
