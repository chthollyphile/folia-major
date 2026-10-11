// src/components/app/home/categorySelectionState.ts
// 广场分类筛选的状态判据。抽出来是为了能单测——Grid3D 本体 props 有几十项又依赖 omni
// 单例与 zustand store，直接挂组件测试只会变成脆弱的大规模 mock，而这判据恰恰是
// 用户可感知行为的决定因素（2026-10-11 用户实测反馈：分类后没封面、切 tab 回来变回
// 默认、来回切换闪骨架）。

/** 分类歌单数据的归属标识：同一音源的同一分类才复用，换分类/换音源都不算。 */
export const categoryScopeOf = (providerId: string, categoryId: string): string => `${providerId}:${categoryId}`;

/**
 * 切 tab 回来时是否可以直接复用已拉到的分类歌单。
 *
 * 两个条件缺一不可：scope 要对上（不是别的分类/别的音源的数据），而且手上真有数据。
 * 只有 scope 没有数据不算数——那是被取消或失败的请求留下的记账，留着会让下一次切回来
 * 跳过拉取、直接对着空列表显示「暂无内容」。
 */
export const canReuseCategorySongLists = (
    loadedScope: string | null,
    scope: string,
    itemCount: number,
): boolean => loadedScope === scope && itemCount > 0;
