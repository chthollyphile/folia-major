// test/fixtures/folium-sources/deps-archive/qq/main/deps.d.ts
// 样例只用到上游包导出的 server；包自带的类型在样例的 tsconfig 下读不到这个成员，这里写最小的形状。

declare module '@yakult-green-tea/qq-music-api' {
    export const server: {
        listening: boolean;
        once(event: string, listener: (...args: unknown[]) => void): unknown;
        close(): unknown;
    } | undefined;
}
