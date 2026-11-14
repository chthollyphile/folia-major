import React from 'react';
import { CircleHelp, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SettingsSearchField from './SettingsSearchField';
import type { SettingsNavGroup, SettingsSectionId } from './settingsNavModel';
// src/components/modal/settings/navigation/SettingsSideList.tsx
// The settings' side list: a search field, then the categories under their group names, and Help at
// the foot. It lists categories only; what a page holds is in that page's header. The compact
// window opens this same list from its menu button, without the search field - the top bar keeps
// that one, so the list there starts straight at the categories.

type SettingsSideListProps = {
    groups: SettingsNavGroup[];
    /** The category on screen, 'help', or null while search results are shown. */
    activeId: SettingsSectionId | 'help' | null;
    onSelectSection: (sectionId: SettingsSectionId) => void;
    onSelectHelp: () => void;
    query: string;
    onQueryChange: (query: string) => void;
    /** Enter in the search field. */
    onSubmitQuery: () => void;
    /** 紧凑档的抽屉里不画搜索框：那一个在顶栏上（所以上面三个搜索参数仍要传，只是不被画出）。 */
    showSearch?: boolean;
};

export const SettingsSideList: React.FC<SettingsSideListProps> = ({
    groups,
    activeId,
    onSelectSection,
    onSelectHelp,
    query,
    onQueryChange,
    onSubmitQuery,
    showSearch = true,
}) => {
    const { t } = useTranslation();

    const renderItem = (id: SettingsSectionId | 'help', Icon: LucideIcon, label: string, onSelect: () => void) => {
        const isActive = activeId === id;
        return (
            <button
                key={id}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={onSelect}
                className={`flex h-8 w-full shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 text-left text-[13px] transition-colors ${isActive ? 'bg-[var(--st-fill2)] text-[color:var(--st-t1)]' : 'text-[color:var(--st-t2)] hover:bg-[var(--st-fill)]'}`}
            >
                <Icon size={16} className={`shrink-0 ${isActive ? '' : 'opacity-70'}`} />
                <span className="truncate">{label}</span>
            </button>
        );
    };

    return (
        <aside className={`flex h-full min-h-0 w-full shrink-0 flex-col bg-[var(--st-side)] px-2.5 pb-2.5 pt-3.5 ${showSearch ? 'border-r border-[var(--st-line)]' : ''}`}>
            {showSearch && (
                <SettingsSearchField
                    query={query}
                    onQueryChange={onQueryChange}
                    onSubmitQuery={onSubmitQuery}
                    className="shrink-0"
                />
            )}
            <nav className="mt-1 flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto overflow-x-hidden">
                {groups.map(group => (
                    <div key={group.id} className="flex flex-col gap-px">
                        <div className="block px-2.5 pb-1 pt-3.5 text-xs leading-[18px] text-[color:var(--st-t3)]">
                            {group.label}
                        </div>
                        {group.items.map(section => renderItem(section.id, section.icon, section.label, () => onSelectSection(section.id)))}
                    </div>
                ))}
                <div className="mt-auto block pt-3">
                    {renderItem('help', CircleHelp, t('help.title'), onSelectHelp)}
                </div>
            </nav>
        </aside>
    );
};

export default SettingsSideList;
