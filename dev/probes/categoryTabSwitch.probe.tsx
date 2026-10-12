import React, { useState } from 'react';
import { useCategorySongLists } from '../../src/components/app/home/useCategorySongLists';
import type { ProviderCollection } from '../../src/types/onlineMusic';
import type { ProbeDefinition } from './definition';

// dev/probes/categoryTabSwitch.probe.tsx
// 「切 tab 保留分类筛选 + 切回不闪骨架」的端到端防线。
//
// 为什么用 hook 而不是自己写一份假状态机：判据是 useCategorySongLists 里的那一份，
// Grid3D 正在用的也是它。探针挂同一个 hook，浏览器里跑的就是产品代码本身，
// 测出来才对真实界面有意义。

// 可控的假数据源：第一次调用记一次数，用来证明切回来没有重拉。
// failNext 为 true 时下一次调用会失败——用来验证「失败不算拉过」：失败后切回来必须重拉。
const makeLoader = (counter: { calls: number; failNext: boolean }) => (categoryId: string) => {
    counter.calls += 1;
    if (counter.failNext) {
        counter.failNext = false;
        return Promise.reject(new Error('probe: upstream unavailable'));
    }
    const count = 3;
    const items: ProviderCollection[] = Array.from({ length: count }, (_, index) => ({
        providerId: 'qq',
        id: `${categoryId}-${index}` as ProviderCollection['id'],
        name: `${categoryId} 歌单 ${index + 1}`,
        type: 'playlist',
        coverUrl: `/probe-cover-ok.png`,
        providerData: {},
    }));
    return Promise.resolve(items);
};

const TABS = [
    { key: 'radio', label: '广场' },
    { key: 'discover', label: '发现' },
    { key: 'albums', label: '专辑' },
] as const;

const Component: React.FC = () => {
    const [activeTab, setActiveTab] = useState<string>('radio');
    const counter = React.useRef({ calls: 0, failNext: false });
    const [selectedLabel, setSelectedLabel] = useState<string | null>(null);

    const {
        categorySelected,
        setCategorySelected,
        categorySongLists,
        loadingCategory,
        categoryError,
    } = useCategorySongLists({
        isActiveTab: activeTab === 'radio',
        activeProviderId: 'qq',
        loadCategorySongLists: makeLoader(counter.current),
    });

    return (
        <div data-probe-id="categoryTabSwitch" className="p-8 text-zinc-100">
            <div className="mb-6 flex gap-2">
                {TABS.map(tab => (
                    <button
                        key={tab.key}
                        type="button"
                        data-probe-tab={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={activeTab === tab.key ? 'rounded-full bg-white px-4 py-1.5 text-black' : 'rounded-full bg-white/10 px-4 py-1.5'}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className="mb-4 flex gap-2">
                <button
                    type="button"
                    data-probe-select-category
                    onClick={() => {
                        setCategorySelected({ groupLabel: '热门', itemId: '10000000', itemLabel: '流行' });
                        setSelectedLabel('流行');
                    }}
                    className="rounded-full bg-emerald-500 px-4 py-1.5 text-black"
                >
                    选「流行」分类
                </button>
                <button
                    type="button"
                    data-probe-select-failing
                    onClick={() => {
                        counter.current.failNext = true;
                        setCategorySelected({ groupLabel: '热门', itemId: '10000000', itemLabel: '流行（失败）' });
                        setSelectedLabel('流行（失败）');
                    }}
                    className="rounded-full bg-rose-500 px-4 py-1.5 text-black"
                >
                    选一个会失败的分类
                </button>
                <button
                    type="button"
                    data-probe-clear-category
                    onClick={() => { setCategorySelected(null); setSelectedLabel(null); }}
                    className="rounded-full bg-white/10 px-4 py-1.5"
                >
                    清空
                </button>
            </div>

            {/* 用户可感知的三个面：骨架、空态、内容 */}
            <div data-probe-loading={String(loadingCategory)} className="text-xs opacity-70">
                loading={String(loadingCategory)}
            </div>

            {categoryError ? (
                <div data-probe-error className="text-red-400">{categoryError}</div>
            ) : null}

            <div data-probe-skeleton={loadingCategory ? 'on' : 'off'} className="mt-3 flex gap-3">
                {loadingCategory
                    ? [0, 1, 2].map(i => <div key={i} data-probe-skeleton-card className="h-24 w-24 animate-pulse rounded-xl bg-white/10" />)
                    : null}
            </div>

            <ul data-probe-items className="mt-3 flex flex-col gap-1 text-sm">
                {categorySongLists.map(item => (
                    <li key={String(item.id)} data-probe-item={String(item.id)}>{item.name}</li>
                ))}
            </ul>

            {/* 这三个断言值就是「有没有踩中契约」的判据 */}
            <div className="mt-4 space-y-1 text-xs opacity-80">
                <div data-probe-category-selected={String(Boolean(categorySelected))}>
                    分类仍选中：{String(Boolean(categorySelected))}
                </div>
                <div data-probe-song-list-count={categorySongLists.length}>
                    歌单数：{categorySongLists.length}
                </div>
                <div data-probe-request-count={counter.current.calls}>
                    拉取次数：{counter.current.calls}
                </div>
                {selectedLabel ? <div data-probe-label>{selectedLabel}</div> : null}
            </div>
        </div>
    );
};

export default {
    id: 'categoryTabSwitch',
    title: '分类筛选跨 tab 保留且不闪骨架',
    description: '切到别的 tab 再回来，分类仍选中、歌单仍在、且不再重拉（不再闪骨架）。',
    Component,
} satisfies ProbeDefinition;
