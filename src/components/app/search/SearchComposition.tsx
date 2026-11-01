import React, { useEffect, useRef, useState } from 'react';
import type { SearchKind } from '../../../stores/useSearchNavigationStore';

// src/components/app/search/SearchComposition.tsx
// 搜索页底下的至上主义构图（只是装饰，屏幕阅读器跳过）。几何形的站位按搜的种类换（search.css 的 data-search-kind），
// 换种类时移过去；挂上时依次飞入。竖排的碎字是正在搜的词。换来源时整幅构图转到那个来源的站位，同时一道墨色宽带
// 和一条强调色细线斜着扫过一次（search.css 的 .search-sweep）；降低动态效果时没有扫带，站位直接落下。

type SearchCompositionProps = {
    kind: SearchKind;
    query: string;
    /** 选着的来源：变了就扫一次。 */
    source: string;
    /** 它在来源列表里排第几：按它挑整幅构图的站位。 */
    sourceIndex: number;
};

// 整幅构图的几种站位（转角、横移、竖移），按来源的位置轮流用；第一个来源是原位。
const STAGE_POSES: ReadonlyArray<{ turn: number; x: number; y: number }> = [
    { turn: 0, x: 0, y: 0 },
    { turn: -5, x: -3, y: 2 },
    { turn: 4, x: 2, y: -3 },
    { turn: -2, x: 4, y: 4 },
];

const SearchComposition: React.FC<SearchCompositionProps> = ({ kind, query, source, sourceIndex }) => {
    // 挂上时不扫（那时有飞入），来源换了才扫：每换一次换一个 key，扫带重新挂上、动画重新放。
    const [sweep, setSweep] = useState(0);
    const shownSource = useRef(source);
    useEffect(() => {
        if (shownSource.current === source) return;
        shownSource.current = source;
        setSweep(count => count + 1);
    }, [source]);
    const pose = STAGE_POSES[Math.max(0, sourceIndex) % STAGE_POSES.length];

    return (
        <div className="search-composition" data-search-kind={kind} aria-hidden="true">
            <div
                className="search-composition-stage"
                style={{
                    '--search-stage-turn': `${pose.turn}deg`,
                    '--search-stage-x': `${pose.x}vw`,
                    '--search-stage-y': `${pose.y}vh`,
                } as React.CSSProperties}
            >
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
            {sweep > 0 && (
                <div key={sweep} className="search-sweep">
                    <i className="is-band" />
                    <i className="is-rule" />
                </div>
            )}
        </div>
    );
};

export default React.memo(SearchComposition);
