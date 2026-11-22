// test/fixtures/folium-sources/deps-archive/netease/main/deps.d.ts
// 样例用到的上游包内路径的类型（包自己不带这几个子路径的类型）。

declare module '@neteasecloudmusicapienhanced/api/util/request' {
    const createRequest: (...args: unknown[]) => unknown;
    export default createRequest;
}

declare module '@neteasecloudmusicapienhanced/api/util/index' {
    export const generateRandomChineseIP: () => string;
    export const generateDeviceId: () => string;
}

declare module '@neteasecloudmusicapienhanced/api/main' {
    export const register_anonimous: () => Promise<unknown>;
}

declare module '@neteasecloudmusicapienhanced/api/server' {
    export const serveNcmApi: (options: { port: number; host: string }) => Promise<{
        server: {
            listening: boolean;
            once(event: string, listener: (...args: unknown[]) => void): unknown;
            address(): unknown;
            close(): unknown;
        };
    }>;
}
