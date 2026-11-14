// src/services/onlineMusic/lxmusic/lxTypes.ts
// 洛雪音乐（LX Music）自定义音源的类型定义。
// LX 自定义源只负责三件事：拿播放地址（musicUrl）、拿歌词（lyric）、拿封面（pic）。
// 搜索、歌单、排行榜这些由「各家音乐平台」自己的 SDK 提供 —— 在本项目里，我们复用 folia 自带的
// 网易云 / 酷狗 / QQ 等 provider 去搜索与列歌单，再用导入的 LX 音源为这些歌续上可播放的地址与歌词。

/** LX 音源声明支持的「平台键」。kw=酷我 kg=酷狗 tx=QQ wy=网易云 mg=咪咕 local=本地。 */
export type LxPlatformKey = 'wy' | 'kg' | 'tx' | 'kw' | 'mg' | 'local';

/** LX 平台键 → folia 原生 providerId（用于搜索 / 列歌单 / 取详情）。没有原生 provider 的平台（kw/mg）只能续地址，无法搜索。 */
export const LX_PLATFORM_TO_PROVIDER: Partial<Record<LxPlatformKey, string>> = {
    wy: 'netease',
    kg: 'kugou',
    tx: 'qq',
    kw: undefined, // 酷我：folia 无原生 provider
    mg: undefined, // 咪咕：folia 无原生 provider
    local: undefined,
};

/** folia 原生 providerId → LX 平台键（反向映射，搜索聚合时用）。 */
export const PROVIDER_TO_LX_PLATFORM: Record<string, LxPlatformKey> = {
    netease: 'wy',
    kugou: 'kg',
    qq: 'tx',
};

/** 音源头部注释解析出来的元信息。 */
export interface LxSourceMeta {
    name: string;
    description?: string;
    version?: string;
    author?: string;
    homepage?: string;
}

export interface LxSourcePlatformInfo {
    name?: string;
    type: 'music';
    actions: string[];
    qualitys: string[];
}

export interface LxSource {
    /** 稳定 id（uuid）。 */
    id: string;
    meta: LxSourceMeta;
    /** 源的原始脚本代码（持久化保存，运行时再加载）。 */
    rawScript: string;
    /** 脚本在 inited 事件里声明的支持平台。 */
    sources: Partial<Record<LxPlatformKey, LxSourcePlatformInfo>>;
    enabled: boolean;
    importedAt: number;
    /** 若是「在线导入」来的，记下来源网址。 */
    sourceUrl?: string;
    /** 加载 / 初始化时遇到的错误（有则音源不可用）。 */
    error?: string;
}

/** LX 音质（脚本侧） → folia 音质（应用侧）。 */
export const LX_QUALITY_TO_FOLIA: Record<string, import('../../../types/onlineMusic').AudioQualityPreference> = {
    '128k': 'standard',
    '320k': 'high',
    flac: 'lossless',
    flac24bit: 'hires',
};

/** folia 音质 → LX 音质候选（按顺序取源支持的最近一档）。 */
export const FOLIA_QUALITY_TO_LX: Array<{ folia: import('../../../types/onlineMusic').AudioQualityPreference; lx: string }> = [
    { folia: 'standard', lx: '128k' },
    { folia: 'high', lx: '320k' },
    { folia: 'lossless', lx: 'flac' },
    { folia: 'hires', lx: 'flac24bit' },
    { folia: 'ultra', lx: 'flac24bit' },
];

export type LxRequestHandler = (payload: {
    source: LxPlatformKey;
    action: 'musicUrl' | 'lyric' | 'pic';
    info: { type?: string | null; musicInfo: Record<string, unknown> };
}) => Promise<unknown>;

export interface LxLoadedSource {
    id: string;
    meta: LxSourceMeta;
    sources: Partial<Record<LxPlatformKey, LxSourcePlatformInfo>>;
    requestHandler: LxRequestHandler;
    error?: string;
    /** 初始化完成（收到 inited 或超时）。很多音源是异步 send(inited) 的，必须等它。 */
    ready: Promise<void>;
}
