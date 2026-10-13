import { useCallback, useEffect, useRef, useState } from 'react';
import type { CategorySelection } from '../model/categorySelectionState';
import type { ProviderCollection } from '../../../types/onlineMusic';

// src/library/core/bindings/useCategorySongLists.ts
// 广场「分类筛选」的状态机：选中什么分类、那一批歌单拉到没有、切 tab 回来要不要复用。
//
// 抽成 hook 是为了让这条链路可测。这三个用户可感知现象全由这段逻辑决定，而 Grid3D 本体有
// 几十项 props、又依赖 omni 单例与 zustand store，直接挂组件测试只会变成脆弱的大规模 mock：
//   - 「点发现再回来就变回默认的了」—— 所以切 tab 不清 categorySelected 是这里的契约；
//   - 「来回切换出现骨架、不显示内容」—— 所以切走复位 loading、切回命中缓存就不再重拉。
// 探针挂这个 hook，浏览器里跑的就是 Grid3D 正在用的同一份代码，不是复制的假逻辑。

export type UseCategorySongListsOptions = {
    /** 电台 tab 才处理分类；切到别的 tab 一律复位加载态，否则切回来会先看到一帧永远的骨架。 */
    isActiveTab: boolean;
    activeProviderId: string;
    /** 分类歌单数据源：Grid3D 传 omni 的真实实现，探针传可控的假实现。 */
    loadCategorySongLists: (categoryId: string) => Promise<ProviderCollection[]>;
    /** 拉取失败时告知用户（Grid3D 走全局单通道提示，探针可留空）。 */
    onError?: (message: string) => void;
};

export type CategorySongListsApi = ReturnType<typeof useCategorySongLists>;

export const useCategorySongLists = ({
    isActiveTab,
    activeProviderId,
    loadCategorySongLists,
    onError,
}: UseCategorySongListsOptions) => {
    const [categorySelected, setCategorySelected] = useState<CategorySelection | null>(null);
    const [categoryPanelOpen, setCategoryPanelOpen] = useState(false);
    const [categorySongLists, setCategorySongLists] = useState<ProviderCollection[]>([]);
    const [loadingCategory, setLoadingCategory] = useState(false);
    const [categoryError, setCategoryError] = useState<string | null>(null);
    // 已经拉过的分类（provider:categoryId）：切 tab 回来时据此复用，不重拉、不闪骨架。
    const categorySongListsScopeRef = useRef<string | null>(null);

    // 跨 provider 切换必须清分类：分类 id 是各音源上游的内部键（QQ 的 categoryId 在酷狗/
    // 网易云那里根本不存在），留着会让旧音源的卡片可点，点进去却用新音源去解析旧 id。
    // 反过来，跨 tab 切刻意不清 —— 用户筛出来的结果不该因为路过别的 tab 就丢。
    // 首次不跑这个 effect（providerId 第一次就等于初值），否则会把初始化时的状态也擦一遍。
    const firstProviderRunRef = useRef(true);
    useEffect(() => {
        if (firstProviderRunRef.current) {
            firstProviderRunRef.current = false;
            return;
        }
        categorySongListsScopeRef.current = null;
        setCategorySongLists([]);
        setCategoryError(null);
        setCategorySelected(null);
        setCategoryPanelOpen(false);
        setLoadingCategory(false);
    }, [activeProviderId]);

    const load = useCallback(async (selection: CategorySelection) => {
        // 切到别的 tab 再回来时，这个分类的数据可能已经拉过了：直接复用。不复用的话每次
        // 切走都清空、切回来重拉，用户看到的就是「闪一下骨架再出内容」，而且白打一次请求。
        const scope = `${activeProviderId}:${selection.itemId}`;
        if (categorySongListsScopeRef.current === scope && categorySongLists.length > 0) {
            setLoadingCategory(false);
            return;
        }
        let cancelled = false;
        setCategoryError(null);
        setLoadingCategory(true);
        try {
            const items = await loadCategorySongLists(selection.itemId);
            if (cancelled) return;
            setCategorySongLists(items);
            categorySongListsScopeRef.current = scope;
        } catch (error) {
            console.warn('[useCategorySongLists] category song lists failed', error);
            // 失败就不算拉过：记住的 scope 是上一个成功的分类，留着会让它挪到下一次切回来时
            // 误以为「这个已经有数据」，实际给的是刚过失败的那个空。
            if (!cancelled) {
                setCategorySongLists([]);
                categorySongListsScopeRef.current = null;
                onError?.('category-load-failed');
            }
        } finally {
            if (!cancelled) setLoadingCategory(false);
        }
    }, [activeProviderId, categorySongLists.length, loadCategorySongLists, onError]);

    useEffect(() => {
        // 切走时也要复位：否则 loadingCategory 留在 true，切回来时会先看到一帧永远的骨架。
        if (!isActiveTab) {
            setLoadingCategory(false);
            return;
        }
        if (!categorySelected) {
            setCategorySongLists([]);
            categorySongListsScopeRef.current = null;
            setCategoryError(null);
            return;
        }
        void load(categorySelected);
    }, [isActiveTab, categorySelected, load]);

    return {
        categorySelected,
        setCategorySelected,
        categoryPanelOpen,
        setCategoryPanelOpen,
        categorySongLists,
        loadingCategory,
        categoryError,
    };
};
