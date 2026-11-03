// src/library/core/shared/capability.contract.ts
// 能力查询的契约：某个动作此刻支不支持、能不能点、是否进行中、为什么不行。按钮与命令面板共用同一份结果。

/**
 * pending：同类动作正在进行（共用的来源动作、串行的删除）；limit-reached：上游说没有更多了
 * （每日推荐的不喜欢次数用完）。
 */
export type LibraryCapabilityReason = 'empty' | 'loading' | 'unsupported' | 'pending' | 'limit-reached';

/** 同一个能力查询同时服务按钮与命令面板。 */
export type LibraryCapability = {
    supported: boolean;
    enabled: boolean;
    pending: boolean;
    reason?: LibraryCapabilityReason;
};
