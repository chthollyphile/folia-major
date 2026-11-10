// src/services/proxiedUrl.ts
// 桌面版：跨域请求由 nativeHttpRequest（主进程 IPC lx-fetch）直接发，不再拼代理地址。
// 洛雪的 publicApi / runtime 只在 hasNativeHttp() 为 false 时才用这里的返回值（浏览器里就是原地址）。

export const resolveProxiedUrl = (targetUrl: string): string => targetUrl;
