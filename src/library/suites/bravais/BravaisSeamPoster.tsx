import React, { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { ChevronLeft, ListFilter, ListMusic, ListPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getSizedCoverUrl } from '../../../utils/coverUrl';
import type { BravaisItem, BravaisLayer } from './bravaisLayer';
import type { BravaisSeamActions } from './BravaisSeamContent';
import { BravaisSeamCollectionMenu, BravaisSeamCollectionMeta, BravaisSeamStatusLine } from './BravaisSeamCollection';
import { BRAVAIS_POSTER_QUICK_CELL } from './bravaisSeamQuickCells';
import BravaisSeamAbout from './BravaisSeamAbout';
import { BravaisSeamFlipText } from './BravaisSeamFlip';
import BravaisSeamCrumbs from './BravaisSeamCrumbs';
import { openBravaisFilter } from './useBravaisSeamFilter';
import { BRAVAIS_POSTER_SCRAP_COUNT, BRAVAIS_POSTER_SHAPE_RISE, posterShapeClipPath, resolvePosterComposition, risePosterPoints } from './bravaisPosterComposition';
import './bravaisPoster.css';
import BravaisSeamPlayScope from './BravaisSeamPlayScope';

// src/library/suites/bravais/BravaisSeamPoster.tsx
// 歌手页的海报（完整等级下的歌手页缝，仍是墙上裂开的一列、相机把它带到视口最左边，见 bravaisSeamTarget 的 'poster' 与 bravaisFrame 的 poster）：
// 用凝彩（Tempera）的视觉语言，构图按歌手定死、每个歌手一幅（bravaisPosterComposition）——灰色的胶片颗粒纸底、四周压暗；
// 定妆照去色、套在一块大的斜切色块里，块外被裁掉的部分淡淡地垫在整幅底下（往下渐隐，不压名字与按钮）（白色发丝描边 + 错开的
// 虚影，块里盖网点），像凝彩里装着画面的几何形；斜穿整幅的贯穿线、四角的取景角标、斜线填充的小方块、「· · ·」，散落在
// 上半的两个灰色碎字（取自热门歌名里放大的那个词）；歌手名是超粗的黑体、白到灰的渐变，后面拖着错开的立体残影，旁边一个
// 小词（「歌手」）与它错落排在一起，名字放不下时渲染后按比例缩小；热门歌曲前三首（每首的标题里最长的那个词放大、带同样的残影）。
// 缝里原有的功能都还在：返回与面包屑、过滤专辑（点了缝临时展开成完整信息条，与书脊上的过滤图标同一条路）、
// 播放热门 / 加入队列、「⋯ 更多」（列表面板、折叠、本地歌手的编辑），以及「关于艺术家」（简介两行截断、统计附注）、
// 专辑补页进度、加载失败与重试这些状态行（与完整信息条同一套组件）。
// 底色是海报自己的（不跟缝的材质预设、透明缝、叠色与熄灯走）；画面全是静态的，没有逐帧动画。
// 变体：歌手的「全部歌曲」那一层（seam.artistSongs，#918）也画这幅海报——大字仍是歌手名，旁边的小词换成「全部歌曲」，
// 热门三首换成一个超大的歌曲总数（同样的立体残影），按钮是集合页的播放全部 / 加入队列；构图按这一层的 key 定，与歌手页那幅不同。

const TOP_SONG_COUNT = 3;

/** 名字的字号按字数收：中日韩文字一个字一格，其余按 0.62 格估。 */
const nameColumns = (name: string) => {
    const characters = [...name];
    const wide = characters.filter(character => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(character)).length;
    return Math.max(2, wide * 1.02 + (characters.length - wide) * 0.62);
};

let wordSegmenter: Intl.Segmenter | null = null;

/** 歌名拆成词，最长的那个词（按字素数，只看文字词）放大，其余原样。 */
export const splitHeroWord = (title: string): { text: string; hero: boolean }[] => {
    wordSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'word' });
    const parts = Array.from(wordSegmenter.segment(title), part => ({ text: part.segment, wordLike: Boolean(part.isWordLike) }));
    let heroIndex = -1;
    let heroLength = 0;
    parts.forEach((part, index) => {
        const length = [...part.text].length;
        if (part.wordLike && length > heroLength) {
            heroIndex = index;
            heroLength = length;
        }
    });
    // 整个标题就是一个词：不放大（没有对比就没有重心）。
    if (parts.filter(part => part.wordLike).length < 2) heroIndex = -1;
    return parts.map((part, index) => ({ text: part.text, hero: index === heroIndex }));
};

const PosterSong: React.FC<{ item: BravaisItem; index: number; onPlay?: (key: string) => void }> = ({ item, index, onPlay }) => {
    const words = useMemo(() => splitHeroWord(item.title), [item.title]);
    const play = useCallback(() => onPlay?.(item.key), [item.key, onPlay]);
    return (
        <li>
            <button type="button" className="bravais-poster-song" onClick={play} disabled={!onPlay || item.unavailable}
                data-bravais-poster-song={item.key} aria-label={item.subtitle ? `${item.title} · ${item.subtitle}` : item.title}>
                <span className="bravais-poster-song-index" aria-hidden>{String(index + 1).padStart(2, '0')}</span>
                <span className="bravais-poster-song-title" aria-hidden>
                    {words.map((word, wordIndex) => (
                        <span key={wordIndex} className={word.hero ? 'is-hero' : undefined}>{word.text}</span>
                    ))}
                </span>
            </button>
        </li>
    );
};

/**
 * 碎字：热门歌名里放大的那个词（没有就取整个歌名的前两个字），最多两个，散在海报上半。
 * 三个词不重复（不分大小写）：撞了就换这首歌名里次长的词，都撞了再取前两个字，还撞就不放这一个。
 */
export const scrapWords = (items: readonly BravaisItem[]) => {
    const used = new Set<string>();
    const words: string[] = [];
    for (const item of items) {
        const title = item.title.trim();
        wordSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'word' });
        const titleWords = Array.from(wordSegmenter.segment(title)).filter(part => part.isWordLike).map(part => part.segment);
        // 排序是稳定的：最长的词里排第一的那个就是放大的那个（splitHeroWord）；整个标题只有一个词时不放大，直接取前两个字。
        const byLength = titleWords.length < 2 ? [] : [...titleWords].sort((a, b) => [...b].length - [...a].length);
        const word = [...byLength, [...title].slice(0, 2).join('')].find(candidate => candidate && !used.has(candidate.toLocaleLowerCase()));
        if (!word) continue;
        used.add(word.toLocaleLowerCase());
        words.push(word);
        if (words.length === BRAVAIS_POSTER_SCRAP_COUNT) break;
    }
    return words;
};

const BravaisSeamPoster: React.FC<{ layer: BravaisLayer; actions: BravaisSeamActions }> = ({ layer, actions }) => {
    const { t } = useTranslation();
    const { seam } = layer;
    const artist = seam.artist;
    const artistSongs = seam.artistSongs;
    const name = artistSongs?.name ?? seam.title;
    const coverUrl = artistSongs ? artistSongs.coverUrl : artist?.coverUrl;
    // 名字旁边的小词：歌手页是「歌手」，「全部歌曲」那一层换成「全部歌曲」（更宽，大字要跟着重新量）。
    const kicker = artistSongs ? t('artistGrid.allSongs') : t('libraryBravais.kind.artist');
    const topSongs = useMemo(
        () => layer.items.filter(item => item.kind === 'track').slice(0, TOP_SONG_COUNT),
        [layer.items],
    );
    const scraps = useMemo(() => scrapWords(topSongs), [topSongs]);
    // 构图按层的 key（含歌手 id）定死：同一个歌手每次都是同一幅（bravaisPosterComposition）。
    const composition = useMemo(() => resolvePosterComposition(layer.key), [layer.key]);
    const clipPath = posterShapeClipPath(composition.shape);
    const fold = useMemo(() => ({ label: t('libraryBravais.seamFoldStrip'), run: () => actions.setLevel('hidden') }), [actions, t]);
    const style = { '--bravais-poster-name-columns': nameColumns(name) } as React.CSSProperties;
    // 字号按字数估（nameColumns），估不准的（字体比预想的宽、前面的小词更长）渲染后再量一次：放不下就按比例缩小。
    const titleRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const title = titleRef.current;
        const heading = title?.querySelector<HTMLElement>('.bravais-poster-name');
        const kicker = title?.querySelector<HTMLElement>('.bravais-poster-kicker');
        if (!title || !heading) return;
        const fit = () => {
            heading.style.removeProperty('--bravais-poster-name-fit');
            const box = getComputedStyle(title);
            // 立体残影往右下多出约 0.1em（--bravais-poster-extrude 最后一层）。
            const extrude = parseFloat(getComputedStyle(heading).fontSize) * 0.1;
            const room = title.clientWidth - parseFloat(box.paddingLeft) - parseFloat(box.paddingRight)
                - (kicker?.offsetWidth ?? 0) - (parseFloat(box.columnGap) || 0) - extrude;
            const need = heading.scrollWidth;
            if (room > 0 && need > room) heading.style.setProperty('--bravais-poster-name-fit', (room / need).toFixed(4));
        };
        fit();
        const observer = new ResizeObserver(fit);
        observer.observe(title);
        let alive = true;
        void document.fonts?.ready.then(() => { if (alive) fit(); });
        return () => {
            alive = false;
            observer.disconnect();
        };
    // 小词也算：从歌手页进「全部歌曲」时海报实例被复用、名字不变，只有小词变宽。
    }, [kicker, name]);
    return (
        <section className="bravais-poster" style={style} aria-label={t('libraryBravaisArtist.posterLabel')} data-bravais-poster>
            <div className="bravais-poster-ground" aria-hidden>
                {/* 色块外被裁掉的那部分定妆照：同一张照片、同样对齐，淡淡地垫在整幅底下、往下渐隐（色块里那张是实的）。
                    与块里同一个地址，不多下载一张。 */}
                {coverUrl && (
                    <div className="bravais-poster-backdrop" data-bravais-poster-backdrop>
                        <img src={getSizedCoverUrl(coverUrl, 1024)} alt="" draggable={false} decoding="async" />
                    </div>
                )}
                {/* 装着定妆照的斜切色块：先画错开的虚影，再画块本身（照片 + 网点 + 白色描边）。 */}
                <div className="bravais-poster-shape-ghost" style={{ clipPath, transform: `translate(${composition.ghost.x}px, ${composition.ghost.y}px)` }} />
                <div className="bravais-poster-shape" style={{ clipPath }}>
                    {coverUrl && (
                        <div className="bravais-poster-portrait" data-bravais-poster-portrait>
                            <img src={getSizedCoverUrl(coverUrl, 1024)} alt="" draggable={false} decoding="async" />
                        </div>
                    )}
                </div>
                {composition.shape.kind === 'polygon' ? (
                    <svg className="bravais-poster-shape-edge" viewBox={`0 ${-BRAVAIS_POSTER_SHAPE_RISE} 100 ${100 + BRAVAIS_POSTER_SHAPE_RISE}`} preserveAspectRatio="none">
                        <polygon points={risePosterPoints(composition.shape.points).map(([x, y]) => `${x},${y}`).join(' ')} />
                    </svg>
                ) : (
                    <div className="bravais-poster-shape-ring" style={{ left: `${composition.shape.cx}%`, top: `${composition.shape.cy}%` }} />
                )}
                <div className="bravais-poster-grain" />
                {composition.through.map((line, index) => (
                    <i key={index} className={`bravais-poster-through is-${index}`} style={{ top: `${line.y}%`, transform: `rotate(${line.deg}deg)` }} />
                ))}
                <div className="bravais-poster-corners"><i className="is-tl" /><i className="is-tr" /><i className="is-bl" /><i className="is-br" /></div>
                <div className="bravais-poster-finder"><i className="is-l" /><i className="is-r" /></div>
                <div className="bravais-poster-hatch" data-side={composition.hatch.side} style={{ top: `${composition.hatch.y}%` }}><i /><i /></div>
                <div className="bravais-poster-dots" style={{ left: `${composition.dots.x}%`, top: `${composition.dots.y}%` }}>· · ·</div>
                {scraps.map((word, index) => {
                    const scrap = composition.scraps[index];
                    if (!scrap) return null;
                    return (
                        <span key={index} className="bravais-poster-scrap" style={{
                            left: `${scrap.x}%`,
                            top: `${scrap.y}%`,
                            fontSize: `min(${Math.round(scrap.size * 8.75)}px, ${scrap.size.toFixed(2)}cqh)`,
                            transform: `rotate(${scrap.deg.toFixed(1)}deg)`,
                            opacity: scrap.opacity,
                        }}>{word}</span>
                    );
                })}
            </div>

            {/* 文字与按钮：倾斜时整块缩进安全区（四个角不转出屏幕）；上面的色块、颗粒与细线不缩，转出去也无妨。 */}
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

                <div className="bravais-poster-title" ref={titleRef}>
                    {/* 小词与大字错落排在一起（凝彩一行里一个放大的 hero 词、其余压小）。 */}
                    <span className="bravais-poster-kicker" aria-hidden>{kicker}</span>
                    <h2 className="bravais-poster-name" data-bravais-poster-name data-bravais-seam-title data-text={name}>{name}</h2>
                </div>

                <div className="bravais-poster-bottom">
                    {/* 统计已是「关于艺术家」的附注：相同时元数据行不重复（过滤中是匹配数，照常显示）。 */}
                    {/* 全部歌曲的变体：曲目数就是下面那个大数字，元数据行不重复。 */}
                    {seam.meta && !artistSongs && !(artist?.stats && artist.stats === seam.meta) && (
                        <BravaisSeamFlipText as="div" flipKey={seam.meta} className="bravais-poster-meta">{seam.meta}</BravaisSeamFlipText>
                    )}
                    {artist && (artist.description || artist.stats) && (
                        <BravaisSeamAbout data-bravais-seam-artist text={artist.description} textAttribute="data-bravais-artist-bio"
                            note={artist.stats} noteAttribute="data-bravais-artist-stats" />
                    )}
                    {seam.collection && <BravaisSeamCollectionMeta collection={seam.collection} />}
                    {seam.status && <BravaisSeamFlipText as="div" flipKey={seam.status} className="bravais-seam-status" data-bravais-seam-status>{seam.status}</BravaisSeamFlipText>}
                    {seam.collection?.status && <BravaisSeamStatusLine status={seam.collection.status} />}
                    {artistSongs && artistSongs.trackCount > 0 && (
                        <div className="bravais-poster-count" data-bravais-poster-count>
                            <span className="bravais-poster-count-number" data-text={String(artistSongs.trackCount)}>{artistSongs.trackCount}</span>
                            <span className="bravais-poster-count-unit">{t('libraryBravaisArtist.allSongsCountUnit', { count: artistSongs.trackCount })}</span>
                        </div>
                    )}
                    {!artistSongs && topSongs.length > 0 && (
                        <ol className="bravais-poster-songs" aria-label={t('libraryBravaisArtist.posterTopSongs')}>
                            {topSongs.map((item, index) => <PosterSong key={item.key} item={item} index={index} onPlay={layer.onPlayItem} />)}
                        </ol>
                    )}
                    <div className="bravais-poster-actions">
                        <BravaisSeamPlayScope seam={seam} buttonClassName="bravais-poster-button" />
                        {seam.onEnqueueScope && (
                            <button type="button" className="bravais-poster-button" data-bravais-seam-action="enqueue-scope" onClick={seam.onEnqueueScope}>
                                <ListPlus aria-hidden />{seam.scopeLabels?.enqueue ?? t('libraryBravais.enqueueAll')}
                            </button>
                        )}
                        {seam.onOpenAllSongs && (
                            <button type="button" className="bravais-poster-button" data-bravais-seam-action="open-all-songs" onClick={seam.onOpenAllSongs}>
                                <ListMusic aria-hidden />{t('artistGrid.allSongs')}
                            </button>
                        )}
                        <BravaisSeamCollectionMenu collection={seam.collection} onOpenList={actions.openList} fold={fold} cellClassName={BRAVAIS_POSTER_QUICK_CELL} />
                    </div>
                </div>
            </div>
        </section>
    );
};

export default BravaisSeamPoster;
