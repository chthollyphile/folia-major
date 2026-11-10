// packages/coven/src/index.mjs
// 给适配层和测试用的公开接口。命令行入口在 bin/coven.mjs。

export { defineAdapter, deterministicKinds, validateAdapter } from './adapter.mjs';
export { catalogueLabel, GENRES, runLabel, scopeLabel, taskLabel, TEMPOS, tempoLabel } from './catalogue.mjs';
export { resolveClaims } from './claim.mjs';
export { BLOCKED_CODE, COVEN_CODES } from './codes.mjs';
export { isRelativePath } from './contract.mjs';
export { loadHost } from './host.mjs';
export { maxRisk, RISKS, riskRank, sensitiveRiskOf } from './risk.mjs';
