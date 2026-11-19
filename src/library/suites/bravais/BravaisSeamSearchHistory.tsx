import React from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

// src/library/suites/bravais/BravaisSeamSearchHistory.tsx
// 缝里那个全局搜索框的搜索历史：贴在「搜索」按钮下面，一条一个标签，标签点了就再搜一次，
// 右边的叉删这一条，右上角「清空」删整份。数据是全局那一份（useSearchNavigationStore 的 searchHistory）。
// 这里不用 Tailwind 的玻璃面板，样式在 bravaisHome.css 的 `.bravais-search-history`：缝里的底色是墙的，
// 只能靠 currentColor 混出来，和首页那层浮在 3D 墙上的面板不是一回事。

type BravaisSeamSearchHistoryProps = {
    items: readonly string[];
    onPick: (query: string) => void;
    onRemove: (query: string) => void;
    onClear: () => void;
};

const BravaisSeamSearchHistory: React.FC<BravaisSeamSearchHistoryProps> = ({ items, onPick, onRemove, onClear }) => {
    const { t } = useTranslation();
    if (items.length === 0) return null;

    return (
        <div className="bravais-search-history" data-bravais-search-history>
            <div className="bravais-search-history-head">
                <span>{t('home.searchHistory')}</span>
                <button type="button" data-bravais-seam-action="clear-search-history" onClick={onClear}>
                    {t('home.searchHistoryClear')}
                </button>
            </div>
            <div className="bravais-search-history-tags">
                {items.map(item => (
                    <span key={item} className="bravais-search-history-tag">
                        <button
                            type="button"
                            className="bravais-search-history-pick"
                            data-bravais-seam-action="pick-search-history"
                            onClick={() => onPick(item)}
                            title={item}
                        >
                            {item}
                        </button>
                        <button
                            type="button"
                            className="bravais-search-history-remove"
                            aria-label={t('home.searchHistoryRemove', { query: item })}
                            title={t('home.searchHistoryRemove', { query: item })}
                            onClick={() => onRemove(item)}
                        >
                            <X aria-hidden />
                        </button>
                    </span>
                ))}
            </div>
        </div>
    );
};

export default BravaisSeamSearchHistory;
