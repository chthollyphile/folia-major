import type { FoliumClientApi, FoliumSourceHandle } from '@folia/folium';
import { connectSpotifyTransport } from './spotifyTransport';
import { connectSpotifyPlaybackMode } from './spotifySoloistPlayback';
import { createSpotifySource } from './spotifyProvider';

// sources/spotify/client/index.ts
// Spotify 音源模组的 client 入口：请求经 folium.rpc 交给 main 入口；短名、登录窗口的字、两种播放方式与 Soloist
// 配置清单的字、「已点赞的歌曲」、探索页的字来自模组自己的语言表。播放方式（标准 / Soloist）一变就
// handle.changed()，宿主重读这个音源（routeOf 随之改走音频或外部播放器）。在第一个 await 之前注册（方案 §5.4
// 末尾的约定）。

/** client 入口。 */
export default function activate(folium: FoliumClientApi): void {
    connectSpotifyTransport({
        call: <T>(name: string, ...args: unknown[]) => folium.rpc.call<T>(name, ...args),
        error: (code, message, details) => folium.sources.error(code, message, details),
    });
    let handle: FoliumSourceHandle | null = null;
    connectSpotifyPlaybackMode(() => handle?.changed());
    handle = folium.sources.register(createSpotifySource({
        text: (key, params) => folium.i18n.key(key, params),
        translate: key => folium.i18n.text(key),
    }));
}
