import React from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// src/components/modal/settings/navigation/SettingsSearchField.tsx
// 设置的搜索框：宽屏时在侧栏顶端，紧凑档时在顶栏的菜单按钮右边，两处共用这一个受控输入框。
// 回车交给调用方（跳到第一条命中）；Escape 先清空查询，只有空的时候才让出去关掉整个弹窗。

type SettingsSearchFieldProps = {
    query: string;
    onQueryChange: (query: string) => void;
    /** 回车：由调用方决定要不要落到第一条命中。 */
    onSubmitQuery: () => void;
    className?: string;
};

export const SettingsSearchField: React.FC<SettingsSearchFieldProps> = ({
    query,
    onQueryChange,
    onSubmitQuery,
    className = '',
}) => {
    const { t } = useTranslation();

    const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            onSubmitQuery();
            return;
        }
        // The first Escape clears the query; only an empty box lets it through to close the dialog.
        if (event.key === 'Escape' && query) {
            event.preventDefault();
            event.stopPropagation();
            onQueryChange('');
        }
    };

    return (
        <div className={`flex h-8 items-center gap-2 rounded-lg border border-transparent bg-[var(--st-fill)] px-2.5 text-[color:var(--st-t3)] transition-colors focus-within:border-[var(--st-line2)] ${className}`}>
            <Search size={14} className="shrink-0" />
            <input
                type="search"
                value={query}
                onChange={event => onQueryChange(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={t('options.settingsSearchPlaceholder')}
                aria-label={t('options.settingsSearchPlaceholder')}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-[color:var(--st-t1)] outline-none placeholder:text-[color:var(--st-t3)] [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
                <button
                    type="button"
                    onClick={() => onQueryChange('')}
                    aria-label={t('options.settingsSearchClear')}
                    className="shrink-0 transition-colors hover:text-[color:var(--st-t1)]"
                >
                    <X size={14} />
                </button>
            )}
        </div>
    );
};

export default SettingsSearchField;
