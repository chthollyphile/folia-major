// 夹具：只有 ESM 的依赖，进 vendor.mjs。有默认导出也有具名导出。
export const greet = (name) => `vendor:${name}`;
export default { kind: 'esm-only' };
