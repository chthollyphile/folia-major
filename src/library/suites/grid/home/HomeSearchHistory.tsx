import React from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

// src/library/suites/grid/home/HomeSearchHistory.tsx
// 首页搜索框点开时贴在它下面的搜索历史：一条一个标签，标签本身点了就再搜一次，
// 右边的叉删这一条，右上角「清空」删整份。数据是全局那一份（useSearchNavigationStore 的 searchHistory）。
// 面板上的按下都挡住默认行为：那样输入框不会先失焦，面板也就不会在点击落下之前消失。

type HomeSearchHistoryProps = {
    items: readonly string[];
    onPick: (query: string) => void;
    onRemove: (query: string) => void;
    onClear: () => void;
    isDaylight: boolean;
    className?: string;
};

/** 让输入框保持焦点：面板上的点击不用先 blur 再 click。 */
const keepFocus = (event: React.MouseEvent) => event.preventDefault();

export const HomeSearchHistory: React.FC<HomeSearchHistoryProps> = ({
    items,
    onPick,
    onRemove,
    onClear,
    isDaylight,
    className = '',
}) => {
    const { t } = useTranslation();

    const surface = isDaylight
        ? 'bg-white/90 border-black/10 text-zinc-800 shadow-[0_18px_40px_rgba(15,23,42,0.18)]'
        : 'bg-black/70 border-white/10 text-zinc-100 shadow-[0_18px_40px_rgba(0,0,0,0.45)]';
    const chip = isDaylight
        ? 'border-black/10 bg-black/[0.04] hover:bg-black/[0.08]'
        : 'border-white/10 bg-white/[0.06] hover:bg-white/[0.12]';

    return (
        <div
            id="home-search-history"
            data-testid="home-search-history"
            className={`w-72 max-w-[calc(100vw-2rem)] rounded-2xl border p-3 backdrop-blur-xl ${surface} ${className}`}
        >
            <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide opacity-50">
                    {t('home.searchHistory')}
                </span>
                <button
                    type="button"
                    onMouseDown={keepFocus}
                    onClick={onClear}
                    className="rounded-md px-1.5 py-0.5 text-[11px] opacity-55 transition-opacity hover:opacity-100"
                >
                    {t('home.searchHistoryClear')}
                </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
                {items.map(item => (
                    <span
                        key={item}
                        className={`inline-flex min-w-0 max-w-full items-center rounded-full border transition-colors ${chip}`}
                    >
                        <button
                            type="button"
                            onMouseDown={keepFocus}
                            onClick={() => onPick(item)}
                            title={item}
                            className="min-w-0 truncate py-1 pl-2.5 pr-1 text-xs"
                        >
                            {item}
                        </button>
                        <button
                            type="button"
                            onMouseDown={keepFocus}
                            onClick={() => onRemove(item)}
                            aria-label={t('home.searchHistoryRemove', { query: item })}
                            title={t('home.searchHistoryRemove', { query: item })}
                            className="mr-1 grid h-4 w-4 shrink-0 place-items-center rounded-full opacity-45 transition-opacity hover:opacity-100"
                        >
                            <X size={10} />
                        </button>
                    </span>
                ))}
            </div>
        </div>
    );
};

export default HomeSearchHistory;
