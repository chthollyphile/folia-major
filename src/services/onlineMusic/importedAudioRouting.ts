import type { SongResult } from '../../types';
import type { AudioQualityPreference, ProviderAudioSource } from '../../types/onlineMusic';

// src/services/onlineMusic/importedAudioRouting.ts
// 「导入音源」的取地址扩展点：omni 在问歌曲自己的 provider 之前先问这里。
//
// 单独成文件，而不是挂在 hostExtensionHooks 上：那一层是 Folium 模组的宿主扩展，
// 很多单测会整个 vi.mock 掉它；把这里的注册 / 调用放在独立模块里，新扩展点就不会
// 因为 mock 缺少新导出而在导入期炸掉，也不会改变原有宿主扩展的任何行为。
//
// 没有安装解析器，或解析器交不出地址时，一律返回 null，provider 路径原样继续。

export type ImportedAudioResolver = (
    song: SongResult,
    quality: AudioQualityPreference,
) => Promise<ProviderAudioSource | null>;

let importedAudioResolver: ImportedAudioResolver | null = null;

export const installImportedAudioResolver = (resolver: ImportedAudioResolver | null): void => {
    importedAudioResolver = resolver;
};

export const applyImportedAudioResolver = async (
    song: SongResult,
    quality: AudioQualityPreference,
): Promise<ProviderAudioSource | null> => {
    if (!importedAudioResolver) return null;
    try {
        return await importedAudioResolver(song, quality);
    } catch (error) {
        console.warn('[ImportedAudio] imported-source audio failed; using the provider source', error);
        return null;
    }
};
