import React, { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { Search, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { BravaisLayer } from './bravaisLayer';
import { setBravaisSearchOpen } from './bravaisHomeUiStore';
import BravaisSeamCrumbs from './BravaisSeamCrumbs';
import BravaisSeamSearchHistory from './BravaisSeamSearchHistory';
import { useSearchNavigationStore } from '../../../stores/useSearchNavigationStore';

// src/library/suites/bravais/BravaisSeamSearch.tsx
// 首页缝里的全局搜索框（设计稿 §10.5「全局搜索的过渡方案」）：⌕ 或 `/` 把首页窄缝临时展开成完整宽度，输入框拿焦点。
// 提交走宿主的 onSearchCommitted，跳到 SearchWorkspace——过渡期唯一的离墙路径（计划完成标准 5），提交后搜索框关上；
// 「关闭搜索」、Esc 只关框。输入框非受控：打字不经过层描述，只在提交时把词交给 surface。
// 与当前页过滤（BravaisSeamFilterField）明确区分（设计稿 §7.6）：这里是放大镜 + 带框的输入框 +「搜索在线平台」+ 搜索按钮，
// 占整条缝（面包屑「书库 › 搜索」），提交才发 provider 请求、换到搜索结果；过滤是漏斗 + 下划线，只收窄当前墙、不发请求。

const BravaisSeamSearch: React.FC<{ layer: BravaisLayer }> = ({ layer }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const search = layer.seam.home?.search;
    // 历史是全局那一份（useSearchNavigationStore，由 submitSearch 记）：这里只读、删一条、清空。
    const { searchHistory, forgetSearchHistoryQuery, clearSearchHistory } = useSearchNavigationStore(useShallow(state => ({
        searchHistory: state.searchHistory,
        forgetSearchHistoryQuery: state.forgetSearchHistoryQuery,
        clearSearchHistory: state.clearSearchHistory,
    })));
    useEffect(() => {
        inputRef.current?.focus({ preventScroll: true });
    }, []);
    if (!search) return null;
    const close = () => setBravaisSearchOpen(false);
    // 一个词从输入框或历史标签来都一样：交给 surface（它的 submitSearch 顺带记历史）、关框。
    const runSearch = (query: string) => {
        const trimmed = query.trim();
        if (!trimmed) return;
        search.onSubmit(trimmed);
        close();
    };
    const submit = (event: FormEvent) => {
        event.preventDefault();
        runSearch(inputRef.current?.value ?? '');
    };
    const pickHistory = (query: string) => {
        if (inputRef.current) inputRef.current.value = query;
        runSearch(query);
    };
    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        close();
    };
    return (
        <div className="bravais-seam-search" data-bravais-search data-bravais-input-kind="search">
            <div className="bravais-seam-crumbs">
                <BravaisSeamCrumbs layer={layer} panelLabel={search.title} onClosePanel={close} />
                <button type="button" className="bravais-seam-level" data-bravais-seam-action="close-search" onClick={close}>
                    {search.closeLabel}
                </button>
            </div>
            <form className="bravais-search-form" role="search" onSubmit={submit}>
                <Search aria-hidden />
                <input
                    ref={inputRef}
                    name="bravais-search"
                    type="search"
                    placeholder={search.placeholder}
                    aria-label={search.title}
                    autoComplete="off"
                    spellCheck={false}
                    onKeyDown={onKeyDown}
                />
                <button type="button" className="bravais-seam-icon" aria-label={search.closeLabel} title={search.closeLabel} onClick={close}>
                    <X aria-hidden />
                </button>
            </form>
            <p className="bravais-search-hint">{search.hint}</p>
            <span className="bravais-form-buttons">
                <button type="button" className="bravais-chrome-button is-primary" data-bravais-seam-action="submit-search"
                    onClick={() => inputRef.current?.form?.requestSubmit()}>
                    <Search aria-hidden />{search.submitLabel}
                </button>
            </span>
            <BravaisSeamSearchHistory
                items={searchHistory}
                onPick={pickHistory}
                onRemove={forgetSearchHistoryQuery}
                onClear={clearSearchHistory}
            />
        </div>
    );
};

export default BravaisSeamSearch;
