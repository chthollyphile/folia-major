import React, { useCallback, useMemo } from 'react';
import { ChevronLeft, FoldHorizontal, ListFilter, ListPlus, Maximize2, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BravaisLayer } from './bravaisLayer';
import type { BravaisSeamLevel } from './bravaisSeamLevel';
import { BravaisSeamCollectionMenu, BravaisSeamCollectionMeta, BravaisSeamStar, BravaisSeamStatusLine } from './BravaisSeamCollection';
import { BravaisSeamSpineTitle, BravaisSeamTitleArea } from './BravaisSeamTitle';
import BravaisSeamFilterField from './BravaisSeamFilterField';
import { openBravaisFilter } from './useBravaisSeamFilter';
import BravaisSeamArtist from './BravaisSeamArtist';
import BravaisSeamAbout from './BravaisSeamAbout';
import BravaisSeamCrumbs from './BravaisSeamCrumbs';
import { BravaisSeamFlipText } from './BravaisSeamFlip';
import './bravaisSeamRow.css';

// src/library/suites/bravais/BravaisSeamRow.tsx
// 信息条横向时集合 / 歌手页的两套内容（缝是一道横跨视口的横条，见 bravaisSeamRow.css）：
// - 完整信息条：上面一行是 ‹ 与面包屑、右边是过滤输入位；下面三栏——标题区域（引号 + 横排大标题，点它收成书脊）、
//   元数据 / 简介 / 收藏与状态（放不下时在栏里滚）、播放全部 / 加入队列 / 星标与「列表」「⋯ 更多」。
// - 书脊：一行——返回、折叠、横排标题（点它展开）、计数、过滤中的图标，右端播放与展开。
// 用的零件与竖的缝（BravaisSeamContent 的 FullSeam / SpineSeam）是同一套，只是排成一行；文案、动作、data 属性都不变，
// 用例与读屏看到的是同一组控件。

export type BravaisSeamRowActions = {
    setLevel: (level: BravaisSeamLevel) => void;
    openList?: () => void;
};

/** 横排标题的字号：按字数收，长标题折成两行也放得下。 */
const rowTitleSize = (title: string, base: number, min: number) => (
    Math.max(min, Math.min(base, Math.round(640 / Math.max(1, [...title].length))))
);

const FoldButton: React.FC<{ onClick: () => void }> = ({ onClick }) => {
    const { t } = useTranslation();
    return (
        <button type="button" className="bravais-seam-icon" data-bravais-seam-action="hide" onClick={onClick}
            aria-label={t('libraryBravais.seamFold')} title={t('libraryBravais.seamFold')}>
            <FoldHorizontal aria-hidden />
        </button>
    );
};

export const BravaisSeamFullRow: React.FC<{ layer: BravaisLayer; actions: BravaisSeamRowActions }> = ({ layer, actions }) => {
    const { t } = useTranslation();
    const { seam } = layer;
    const collection = seam.collection;
    const { setLevel } = actions;
    const collapse = useCallback(() => setLevel('spine'), [setLevel]);
    const fold = useMemo(() => ({ label: t('libraryBravais.seamFoldStrip'), run: () => setLevel('hidden') }), [setLevel, t]);
    return (
        <div className="bravais-seam-row is-full" data-bravais-seam-row="full">
            <div className="bravais-seam-row-head">
                <div className="bravais-seam-crumbs">
                    {layer.onDone && (
                        <button type="button" className="bravais-seam-back" data-bravais-seam-action="back" onClick={layer.onDone}
                            aria-label={t('libraryBravais.seamBack')} title={t('libraryBravais.seamBack')}>
                            <ChevronLeft aria-hidden />
                        </button>
                    )}
                    <BravaisSeamCrumbs layer={layer} />
                </div>
                {seam.filter && <div className="bravais-seam-row-filter"><BravaisSeamFilterField filter={seam.filter} /></div>}
            </div>
            <div className="bravais-seam-row-main">
                <BravaisSeamTitleArea title={seam.title} fontSize={rowTitleSize(seam.title, 40, 20)} label={t('libraryBravais.seamCollapseStrip')}
                    onCollapse={collapse} row />
                <div className="bravais-seam-row-info">
                    {/* 歌手页的统计已是「关于艺术家」的附注：相同时元数据行不重复（过滤中是匹配数，照常显示）。 */}
                    {!(seam.artist?.stats && seam.artist.stats === seam.meta) && (
                        <BravaisSeamFlipText as="div" flipKey={seam.meta} className="bravais-seam-meta">{seam.meta}</BravaisSeamFlipText>
                    )}
                    {seam.artist && <BravaisSeamArtist artist={seam.artist} />}
                    {collection?.description && (
                        <BravaisSeamAbout data-bravais-seam-about="collection" text={collection.description} textAttribute="data-bravais-collection-description" />
                    )}
                    {collection && <BravaisSeamCollectionMeta collection={collection} />}
                    {seam.status && <BravaisSeamFlipText as="div" flipKey={seam.status} className="bravais-seam-status" data-bravais-seam-status>{seam.status}</BravaisSeamFlipText>}
                    {collection?.status && <BravaisSeamStatusLine status={collection.status} />}
                </div>
                <div className="bravais-seam-row-side">
                    <div className="bravais-seam-actions is-scope">
                        {seam.onPlayScope && (
                            <button type="button" className="bravais-chrome-button is-primary" data-bravais-seam-action="play-scope" onClick={seam.onPlayScope}>
                                <Play aria-hidden />{seam.scopeLabels?.play ?? t('libraryBravais.playAll')}
                            </button>
                        )}
                        {seam.onEnqueueScope && (
                            <button type="button" className="bravais-chrome-button" data-bravais-seam-action="enqueue-scope" onClick={seam.onEnqueueScope}>
                                <ListPlus aria-hidden />{seam.scopeLabels?.enqueue ?? t('libraryBravais.enqueueAll')}
                            </button>
                        )}
                        {collection?.subscribe && <BravaisSeamStar subscribe={collection.subscribe} />}
                    </div>
                    <BravaisSeamCollectionMenu collection={collection} onOpenList={actions.openList} fold={fold} />
                </div>
            </div>
        </div>
    );
};

export const BravaisSeamSpineRow: React.FC<{ layer: BravaisLayer; actions: BravaisSeamRowActions }> = ({ layer, actions }) => {
    const { t } = useTranslation();
    const { seam } = layer;
    const { setLevel } = actions;
    const expand = useCallback(() => setLevel('full'), [setLevel]);
    return (
        <div className="bravais-seam-row is-spine" data-bravais-seam-row="spine">
            {layer.onDone && (
                <button type="button" className="bravais-seam-icon" data-bravais-seam-action="back" onClick={layer.onDone}
                    aria-label={t('libraryBravais.seamBack')} title={t('libraryBravais.seamBack')}>
                    <ChevronLeft aria-hidden />
                </button>
            )}
            <FoldButton onClick={() => setLevel('hidden')} />
            <BravaisSeamSpineTitle title={seam.title} fontSize={rowTitleSize(seam.title, 20, 15)} label={t('libraryBravais.seamRestore')}
                onExpand={expand} />
            <BravaisSeamFlipText as="div" flipKey={seam.meta} className="bravais-seam-row-count">{seam.meta}</BravaisSeamFlipText>
            {/* 过滤中：一个强调色的过滤图标（点它把缝临时展开、焦点进输入位）。 */}
            {seam.filter?.query && (
                <button type="button" className="bravais-seam-icon is-filtering" data-bravais-seam-action="filter" onClick={openBravaisFilter}
                    aria-label={seam.filter.placeholder} title={`${seam.filter.placeholder} · ${seam.filter.query}`}>
                    <ListFilter aria-hidden />
                </button>
            )}
            <div className="bravais-seam-spacer" />
            {seam.onPlayScope && (
                <button type="button" className="bravais-seam-icon" data-bravais-seam-action="play-scope" onClick={seam.onPlayScope}
                    aria-label={seam.scopeLabels?.play ?? t('libraryBravais.playAll')} title={seam.scopeLabels?.play ?? t('libraryBravais.playAll')}>
                    <Play aria-hidden />
                </button>
            )}
            <button type="button" className="bravais-seam-icon" data-bravais-seam-action="expand" onClick={expand}
                aria-label={t('libraryBravais.seamExpand')} title={t('libraryBravais.seamExpand')}>
                <Maximize2 aria-hidden />
            </button>
        </div>
    );
};
