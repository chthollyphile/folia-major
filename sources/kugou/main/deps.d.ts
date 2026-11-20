// sources/kugou/main/deps.d.ts
// KuGouMusicApi 不带类型：它导出的是一张「模块文件名 → 函数」的表。

declare module 'kugoumusicapi' {
    const api: Record<string, unknown>;
    export default api;
}
