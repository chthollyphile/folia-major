import React, { useCallback, useMemo } from 'react';
import { ChevronLeft, FoldHorizontal, ListFilter, ListPlus, Maximize2, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BravaisLayer } from './bravaisLayer';
import type { BravaisHomeShortcut } from './bravaisHomeModels';
import type { BravaisSeamLevel } from './bravaisSeamLevel';
import type { BravaisSeamContentVariant } from './bravaisSeamTarget';
import { BravaisSeamCollectionMenu, BravaisSeamCollectionMeta, BravaisSeamStar, BravaisSeamStatusLine } from './BravaisSeamCollection';
import { BravaisSeamSpineTitle, BravaisSeamTitleArea } from './BravaisSeamTitle';
import BravaisSeamFilterField from './BravaisSeamFilterField';
import { openBravaisFilter } from './useBravaisSeamFilter';
import BravaisListPanel, { type BravaisPanelActions } from './BravaisListPanel';
import BravaisSeamFormView from './BravaisSeamFormView';
import BravaisSeamHome from './BravaisSeamHome';
import BravaisSeamSearch from './BravaisSeamSearch';
import BravaisDirectoryPanel from './BravaisDirectoryPanel';
import BravaisSeamArtist from './BravaisSeamArtist';
import BravaisSeamAbout from './BravaisSeamAbout';
import BravaisSeamCrumbs from './BravaisSeamCrumbs';
import BravaisSeamPoster from './BravaisSeamPoster';
import BravaisSeamAlbumPoster from './BravaisSeamAlbumPoster';
import { BravaisSeamFlipText } from './BravaisSeamFlip';
import { BravaisSeamFullRow, BravaisSeamSpineRow } from './BravaisSeamRow';
import BravaisSeamHomeRow from './BravaisSeamHomeRow';

// src/library/suites/bravais/BravaisSeamContent.tsx
// 缝里的四套内容（设计稿 §5）：首页窄缝（竖排「书库」+ 竖排页签）、首页书脊、完整信息条（面包屑行、竖排标题、
// 元数据、播放全部 / 加入队列）、书脊（返回、竖排标题、计数、播放、展开）。排版宽度由外层按「此刻渲染的这一套」定，
// 这里只排内容。文案都来自层描述（已翻译）与 libraryBravais 的 key。界面文案：「收起」= 收成书脊，「折叠」= 折到侧边。
// fb10：完整信息条的面包屑行只剩 ‹ 与面包屑（拿到整行宽度）；「收起」改成点标题区域（BravaisSeamTitle，书脊上点标题
// 展开，两边一致），「折叠」挪进「⋯ 更多」的末尾；收藏星标在播放全部 / 加入队列那一行的末尾。
// B9：首页窄缝 / 书脊换成 BravaisSeamHome（页签、二级切换、工具按钮、管理隐藏、账户位），另有全局搜索框（search）；
// 首页层的面板是目录树（BravaisDirectoryPanel），集合层的面板仍是歌曲列表。
// 集合页的描述在标题下方（元数据行之后），与歌手页的「关于艺术家」共用 BravaisSeamAbout（同一套正文样式、
// 截断 + 展开，都不加小节标题），书脊上没有。歌手页的统计是那一节的附注，元数据行与它相同时不再重复。
// 换层 / 换形态由外层整条翻（useBravaisSeam）；同一层里元数据（计数、匹配数）与状态文字变了，新的一行翻进来（BravaisSeamFlipText）。
// 当前页过滤（设计稿 §7.6）：完整信息条的面包屑行下面是缝自己的过滤输入位（BravaisSeamFilterField）；书脊放不下输入框，
// 过滤中只留一个过滤图标（点它或在墙上打字，缝临时展开成完整信息条）。
// 歌手页、专辑页的完整等级画成海报（BravaisSeamPoster / BravaisSeamAlbumPoster，相机把它带到视口最左边）；过滤、面板、表单时回到上面这几套。
// 信息条横向（row）：首页窄缝 / 书脊与完整信息条 / 书脊换成横条的排法（BravaisSeamHomeRow、BravaisSeamRow），搜索框同一个
// 组件、横条样式（bravaisSeamRow.css）；面板、表单、海报总是竖的（bravaisSeamTarget 的 resolveSeamAxis）。

export type BravaisSeamActions = {
    setLevel: (level: BravaisSeamLevel) => void;
    /** B7：打开列表面板、面板里的定位 / 播放 / 关闭（stage 给）。 */
    openList?: () => void;
    panel?: BravaisPanelActions;
    /** 首页窄缝的直达入口（特殊集合）：墙上找得到那张卡就以它为起点磁贴（useBravaisInteractions 的 openShortcut）。 */
    openShortcut?: (shortcut: BravaisHomeShortcut) => void;
    /** 此刻导航到的层（缝里显示的层在换层时会晚一拍）：专辑海报卸载时据此分辨是真的离开了还是只换了缝的样子。 */
    currentLayerKey?: () => string | null;
};

type BravaisSeamContentProps = {
    variant: BravaisSeamContentVariant;
    /** 这套内容画在横的缝里。 */
    row?: boolean;
    layer: BravaisLayer | null;
    /** 导航栈深度：面包屑在首页与当前层之间折叠中间层。 */
    depth: number;
    actions: BravaisSeamActions;
};

/** 竖排标题的字号：按字数收，长标题不至于撑出缝。 */
const verticalTitleSize = (title: string, base: number, min: number) => (
    Math.max(min, Math.min(base, Math.round(320 / Math.max(1, [...title].length))))
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

const FullSeam: React.FC<{ layer: BravaisLayer; depth: number; actions: BravaisSeamActions }> = ({ layer, actions }) => {
    const { t } = useTranslation();
    const { seam } = layer;
    const collection = seam.collection;
    const { setLevel } = actions;
    const collapse = useCallback(() => setLevel('spine'), [setLevel]);
    const fold = useMemo(() => ({ label: t('libraryBravais.seamFoldStrip'), run: () => setLevel('hidden') }), [setLevel, t]);
    return (
        <div className="bravais-seam-full">
            <div className="bravais-seam-crumbs">
                {layer.onDone && (
                    <button type="button" className="bravais-seam-back" data-bravais-seam-action="back" onClick={layer.onDone}
                        aria-label={t('libraryBravais.seamBack')} title={t('libraryBravais.seamBack')}>
                        <ChevronLeft aria-hidden />
                    </button>
                )}
                <BravaisSeamCrumbs layer={layer} />
            </div>
            {seam.filter && <BravaisSeamFilterField filter={seam.filter} />}
            {/* fb10：标题区域（引号 + 竖排大标题）本身就是「收起信息条」，面包屑拿到整行宽度。 */}
            <BravaisSeamTitleArea title={seam.title} fontSize={verticalTitleSize(seam.title, 52, 26)} label={t('libraryBravais.seamCollapseStrip')}
                onCollapse={collapse} />
            <div className="bravais-seam-rule" />
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
                {/* fb10：收藏星标是这一排动作的最后一个（图标按钮，靠右），不再在描述下面单独占一行。 */}
                {collection?.subscribe && <BravaisSeamStar subscribe={collection.subscribe} />}
            </div>
            <BravaisSeamCollectionMenu collection={collection} onOpenList={actions.openList} fold={fold} />
        </div>
    );
};

const SpineSeam: React.FC<{ layer: BravaisLayer; actions: BravaisSeamActions }> = ({ layer, actions }) => {
    const { t } = useTranslation();
    const { seam } = layer;
    const { setLevel } = actions;
    const expand = useCallback(() => setLevel('full'), [setLevel]);
    return (
        <div className="bravais-seam-spine">
            {layer.onDone && (
                <button type="button" className="bravais-seam-icon" data-bravais-seam-action="back" onClick={layer.onDone}
                    aria-label={t('libraryBravais.seamBack')} title={t('libraryBravais.seamBack')}>
                    <ChevronLeft aria-hidden />
                </button>
            )}
            <FoldButton onClick={() => actions.setLevel('hidden')} />
            <BravaisSeamSpineTitle title={seam.title} fontSize={verticalTitleSize(seam.title, 30, 18)} label={t('libraryBravais.seamRestore')}
                onExpand={expand} />
            <BravaisSeamFlipText as="div" axis="y" flipKey={seam.meta} className="bravais-seam-vcount">{seam.meta}</BravaisSeamFlipText>
            {/* 过滤中：一个强调色的过滤图标（点它把缝临时展开、焦点进输入位；书脊上放不下输入框）。 */}
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
            <button type="button" className="bravais-seam-icon" data-bravais-seam-action="expand" onClick={() => actions.setLevel('full')}
                aria-label={t('libraryBravais.seamExpand')} title={t('libraryBravais.seamExpand')}>
                <Maximize2 aria-hidden />
            </button>
        </div>
    );
};

const BravaisSeamContent: React.FC<BravaisSeamContentProps> = ({ variant, row = false, layer, depth, actions }) => {
    if (!layer) return null;
    if (row) {
        switch (variant) {
            case 'home': return <BravaisSeamHomeRow layer={layer} compact={false} setLevel={actions.setLevel} openShortcut={actions.openShortcut} />;
            case 'home-spine': return <BravaisSeamHomeRow layer={layer} compact setLevel={actions.setLevel} openShortcut={actions.openShortcut} />;
            case 'full': return <BravaisSeamFullRow layer={layer} actions={actions} />;
            case 'spine': return <BravaisSeamSpineRow layer={layer} actions={actions} />;
            default: break;
        }
    }
    switch (variant) {
        case 'home': return <BravaisSeamHome layer={layer} compact={false} setLevel={actions.setLevel} openShortcut={actions.openShortcut} />;
        case 'home-spine': return <BravaisSeamHome layer={layer} compact setLevel={actions.setLevel} openShortcut={actions.openShortcut} />;
        case 'search': return <BravaisSeamSearch layer={layer} />;
        case 'full': return <FullSeam layer={layer} depth={depth} actions={actions} />;
        case 'poster': return layer.seam.album
            ? <BravaisSeamAlbumPoster key={layer.key} layer={layer} actions={actions} />
            : <BravaisSeamPoster layer={layer} actions={actions} />;
        case 'spine': return <SpineSeam layer={layer} actions={actions} />;
        case 'panel':
            if (!actions.panel) return null;
            return layer.home?.panel
                ? <BravaisDirectoryPanel layer={layer} actions={actions.panel} />
                : <BravaisListPanel layer={layer} depth={depth} actions={actions.panel} />;
        case 'form': return layer.seam.collection?.form ? <BravaisSeamFormView form={layer.seam.collection.form} /> : null;
        default: return null;
    }
};

export default BravaisSeamContent;
