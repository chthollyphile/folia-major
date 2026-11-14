// test/fixtures/folium-sources/fixture-source/main/deps.d.ts
// 夹具依赖（deps/ 下的本地包）的类型：它们是不带类型的 JavaScript。

declare module 'fixture-bundle-dep' {
    export const label: (text: string) => string;
}

declare module 'fixture-asar-dep' {
    export const loadedFrom: string;
    export const catalog: () => string[];
}

declare module 'fixture-esm-only' {
    export const greet: (name: string) => string;
    const value: { kind: string };
    export default value;
}
