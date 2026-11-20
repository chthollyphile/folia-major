import type { FoliumClientApi } from '@folia/folium';
import { connectAppleMusicTransport } from './appleMusicTransport';
import { connectAppleMusicLibraryName } from './appleMusicData';
import { createAppleMusicSource } from './appleMusicProvider';

// sources/appleMusic/client/index.ts
// Apple Music 音源模组的 client 入口：请求经 folium.rpc 交给 main 入口（它带着伴侣程序）；短名、登录窗口的字、
// Linux 不支持的说明和「全部歌曲」歌单名来自模组自己的语言表。在第一个 await 之前注册（方案 §5.4 末尾的约定）。

// 应用跑在哪个系统上：渲染进程只看得到 navigator，这里按 Node 的叫法交给定义（决定可用与否）。
function platformOf(): string {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    const name = `${(nav as { userAgentData?: { platform?: string } } | null)?.userAgentData?.platform ?? ''} ${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`;
    if (/mac/i.test(name)) return 'darwin';
    if (/win/i.test(name)) return 'win32';
    if (/linux|x11|cros/i.test(name)) return 'linux';
    return 'unknown';
}

/** client 入口。 */
export default function activate(folium: FoliumClientApi): void {
    connectAppleMusicTransport({
        call: <T>(name: string, ...args: unknown[]) => folium.rpc.call<T>(name, ...args),
        error: (code, message, details) => folium.sources.error(code, message, details),
    });
    connectAppleMusicLibraryName(() => folium.i18n.text('libraryPlaylistName'));
    folium.sources.register(createAppleMusicSource({
        text: key => folium.i18n.key(key),
        platform: platformOf(),
    }));
}
