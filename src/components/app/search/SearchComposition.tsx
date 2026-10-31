import React from 'react';
import type { SearchKind } from '../../../stores/useSearchNavigationStore';

// src/components/app/search/SearchComposition.tsx
// 搜索页底下的至上主义构图（只是装饰，屏幕阅读器跳过）。几何形的站位按搜的种类换（search.css 的 data-search-kind），
// 换种类时移过去；挂上时依次飞入。竖排的碎字是正在搜的词。

type SearchCompositionProps = {
    kind: SearchKind;
    query: string;
};

const SearchComposition: React.FC<SearchCompositionProps> = ({ kind, query }) => (
    <div className="search-composition" data-search-kind={kind} aria-hidden="true">
        <div className="search-figure is-line is-first"><i /></div>
        <div className="search-figure is-line is-second"><i /></div>
        <div className="search-figure is-slab"><i /></div>
        <div className="search-figure is-disc"><i /></div>
        <div className="search-figure is-dot"><i /></div>
        <div className="search-figure is-bar"><i /></div>
        <div className="search-figure is-hatch"><i /></div>
        <div className="search-figure is-dots"><i>· · ·</i></div>
        {query.trim() && <div className="search-figure is-word"><i>{query.trim()}</i></div>}
    </div>
);

export default React.memo(SearchComposition);
