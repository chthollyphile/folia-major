// packages/coven/src/codes.mjs
// Coven 流程自己的代码（8xx）。和项目的检查器（Folia 是 Dedicatus，用 D0xx–D7xx）共用 D 前缀、错开号段。
// 代码一经发布不改含义、不复用。

export const COVEN_CODES = {
    // 80x：开 PR 前的阻断项（coven verify、coven pr）
    D801: { name: '缺少契约或契约没批准', level: 'error' },
    D802: { name: '契约项未通过', level: 'error' },
    D803: { name: '越出契约范围', level: 'error' },
    D804: { name: '契约被改写', level: 'error' },
    D805: { name: '疑似提示注入', level: 'error' },
    D806: { name: '重构未消减基线', level: 'error' },
    D807: { name: '风险级被下调', level: 'error' },
    // 81x：任务停下等人（blocked）
    D810: { name: '重试耗尽', level: 'warning' },
    D811: { name: '评审两轮未过', level: 'warning' },
    D812: { name: '需要取舍', level: 'warning' },
    D813: { name: '预算耗尽', level: 'warning' },
    D820: { name: '外部代码未获准运行', level: 'error' },
    // 83x：coven: 认领协议
    D830: { name: '认领冲突', level: 'warning' },
    D831: { name: '无效认领', level: 'notice' },
    D832: { name: '租约过期', level: 'notice' },
    // 84x：账本只减不增（适配层的 ledger）
    D841: { name: '账本增长', level: 'error' },
};

/** blocked 的原因必须是 8xx 代码。 */
export const BLOCKED_CODE = /^D8\d\d$/;
