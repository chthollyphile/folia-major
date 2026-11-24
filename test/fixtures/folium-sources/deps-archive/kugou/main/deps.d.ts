// test/fixtures/folium-sources/deps-archive/kugou/main/deps.d.ts
// 上游包不带类型：它导出的是一张「模块文件名 → 函数」的表。

declare module 'kugoumusicapi' {
    const api: Record<string, unknown>;
    export default api;
}
