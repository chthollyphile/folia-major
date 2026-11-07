import React, { useEffect, useMemo } from 'react';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronLeft, ListPlus, Play } from 'lucide-react';
import { List, useListRef, type RowComponentProps } from 'react-window';
import { useTranslation } from 'react-i18next';
import type { BravaisItem, BravaisLayer } from './bravaisLayer';
import { BravaisSeamStatusLine } from './BravaisSeamCollection';
import BravaisSeamFilterField from './BravaisSeamFilterField';
import { setBravaisLinkedKey, useBravaisUiStore } from './bravaisUiStore';
import BravaisSeamCrumbs from './BravaisSeamCrumbs';

// src/library/suites/bravais/BravaisListPanel.tsx
// 列表面板（设计稿 §5「面板」「歌曲列表」）：缝加宽到 min(420, 视口 − 52)，标题横排压在顶部，下面是工具行（本地文件夹的
// 排序）、可滚动列表（react-window 虚拟化）和底部的播放 / 入队。列表顺序 = 层的条目顺序，过滤时只列匹配项。
// 列表 ↔ 墙双向联动：悬停一行，墙上这一项的所有可见副本高亮（is-linked）；单击一行，相机飞到离缝最近的那一份并聚焦它
// （歌曲直接展开聚焦卡）；双击播放；悬停墙上的磁贴，这一行高亮并滚到可见。面板是导航状态：返回（‹、Esc、浏览器后退）
// 先关它；面包屑多一级「列表」。

export const BRAVAIS_LIST_ROW_HEIGHT = 44;

export type BravaisPanelActions = {
    close: () => void;
    /** 定位到离缝最近的一份并聚焦（歌曲展开聚焦卡）。 */
    locate: (itemKey: string) => void;
    play: (itemKey: string) => void;
    fold: () => void;
};

type RowProps = {
    items: readonly BravaisItem[];
    highlightKey: string | null;
    nowPlayingKey: string | null;
    actions: BravaisPanelActions;
};

const ListRow = ({ index, style, items, highlightKey, nowPlayingKey, actions }: RowComponentProps<RowProps>): React.ReactElement | null => {
    const item = items[index];
    if (!item) return null;
    const classes = [
        'bravais-list-row',
        item.key === highlightKey ? 'is-linked' : '',
        item.key === nowPlayingKey ? 'is-current' : '',
        item.unavailable ? 'is-unavailable' : '',
    ].filter(Boolean).join(' ');
    return (
        <div
            style={style}
            className={classes}
            role="option"
            aria-selected={item.key === highlightKey}
            data-bravais-list-row={item.key}
            onMouseEnter={() => setBravaisLinkedKey(item.key)}
            onMouseLeave={() => setBravaisLinkedKey(null)}
            onClick={() => actions.locate(item.key)}
            onDoubleClick={() => actions.play(item.key)}
        >
            <span className="bravais-list-badge">{item.badge}</span>
            <span className="bravais-list-text">
                <strong>{item.title}</strong>
                {item.subtitle && <small>{item.subtitle}</small>}
            </span>
            {item.durationLabel && <span className="bravais-list-time">{item.durationLabel}</span>}
        </div>
    );
};

const BravaisListPanel: React.FC<{ layer: BravaisLayer; depth: number; actions: BravaisPanelActions }> = ({ layer, actions }) => {
    const { t } = useTranslation();
    const listRef = useListRef(null);
    const { seam, entries } = layer;
    const collection = seam.collection;
    const linkedKey = useBravaisUiStore(state => state.linkedKey);
    const wallHoverKey = useBravaisUiStore(state => state.wallHoverKey);
    const highlightKey = wallHoverKey ?? linkedKey;
    const items = layer.items;

    // 悬停墙上的磁贴：滚到对应的行（离散事件，不跟指针逐帧）。
    useEffect(() => {
        if (!wallHoverKey) return;
        const index = items.findIndex(item => item.key === wallHoverKey);
        if (index >= 0) listRef.current?.scrollToRow({ index, align: 'smart', behavior: 'smooth' });
    }, [items, listRef, wallHoverKey]);

    // 面板关掉时撤掉联动高亮。
    useEffect(() => () => {
        setBravaisLinkedKey(null);
        useBravaisUiStore.setState({ wallHoverKey: null });
    }, []);

    const rowProps = useMemo<RowProps>(() => ({
        items,
        highlightKey,
        nowPlayingKey: layer.nowPlayingKey,
        actions,
    }), [actions, highlightKey, items, layer.nowPlayingKey]);
    const sort = entries?.sort;

    return (
        <div className="bravais-seam-panel" data-bravais-list={layer.key}>
            <div className="bravais-seam-crumbs">
                <button type="button" className="bravais-seam-back" data-bravais-seam-action="close-list" onClick={actions.close}
                    aria-label={t('libraryBravais.seamBack')} title={t('libraryBravais.seamBack')}>
                    <ChevronLeft aria-hidden />
                </button>
                <BravaisSeamCrumbs layer={layer} panelLabel={entries?.listCrumb ?? ''} onClosePanel={actions.close} />
                <button type="button" className="bravais-seam-level" data-bravais-seam-action="hide" onClick={actions.fold}>
                    {t('libraryBravais.seamFold')}
                </button>
            </div>
            {layer.seam.filter && <BravaisSeamFilterField filter={layer.seam.filter} variant="panel" />}
            <h2 className="bravais-panel-title" data-bravais-seam-title>{seam.title}</h2>
            <div className="bravais-seam-meta">{seam.meta}</div>
            {sort && (
                <div className="bravais-panel-tools" data-bravais-list-sort>
                    <select
                        value={sort.field}
                        aria-label={entries?.panelTitle}
                        data-bravais-list-sort-field
                        onChange={event => sort.setField(event.target.value)}
                    >
                        {sort.fields.map(field => <option key={field.value} value={field.value}>{field.label}</option>)}
                    </select>
                    <button type="button" className="bravais-seam-icon" data-bravais-list-sort-direction={sort.direction}
                        onClick={sort.toggleDirection} aria-label={sort.directionLabel} title={sort.directionLabel}>
                        {sort.direction === 'asc' ? <ArrowUpNarrowWide aria-hidden /> : <ArrowDownWideNarrow aria-hidden />}
                    </button>
                </div>
            )}
            <div className="bravais-panel-list" role="listbox" aria-label={entries?.panelTitle}>
                {items.length > 0 ? (
                    <List
                        listRef={listRef}
                        rowCount={items.length}
                        rowHeight={BRAVAIS_LIST_ROW_HEIGHT}
                        rowComponent={ListRow}
                        rowProps={rowProps}
                        overscanCount={6}
                        className="custom-scrollbar"
                        style={{ height: '100%', width: '100%' }}
                    />
                ) : collection?.status && <BravaisSeamStatusLine status={collection.status} />}
            </div>
            <div className="bravais-seam-actions">
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
            </div>
        </div>
    );
};

export default BravaisListPanel;
