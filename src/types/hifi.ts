// HiFi 后端的跨进程契约：主进程 electron/hifi/* 经 preload 的 window.electron.hifi 与渲染端 src/services/hifi/* 共用这些形状。

/** 当前这首歌由哪套引擎发声：web 是 <audio> + Web Audio，hifi 是 mpv。 */
export type PlaybackRoute = 'web' | 'hifi';

/** 主进程只回传错误码，文案由渲染端按 hifi.errors.<code> 取。 */
export type HifiErrorCode =
    | 'MPV_NOT_FOUND'
    /** 找到的 mpv 比 0.39.0 旧，认不得我们的启动参数。 */
    | 'MPV_TOO_OLD'
    | 'MPV_SPAWN_FAILED'
    | 'MPV_CRASHED'
    | 'IPC_TIMEOUT'
    | 'CIRCUIT_OPEN'
    | 'DEVICE_BUSY'
    | 'DEVICE_UNAVAILABLE'
    | 'SOURCE_UNREACHABLE'
    | 'SOURCE_REJECTED'
    | 'FORMAT_UNSUPPORTED'
    | 'LOAD_FAILED'
    | 'INVALID_REQUEST'
    | 'UNSUPPORTED_PLATFORM'
    | 'INSTALL_FAILED'
    | 'INSTALL_CHECKSUM_MISMATCH'
    | 'INSTALL_CANCELLED'
    | 'UNKNOWN';

export type HifiRuntimeSource = 'manual' | 'downloaded' | 'system';

export type HifiRuntimeDownloadInfo = {
    /** 清单里有这个平台和架构的构建。Linux 恒为 false。 */
    supported: boolean;
    /** 清单推荐的版本。 */
    version: string | null;
    /** userData 里已装好的最新版本；只算 `--version` 探测得通的，装了但起不来的不算。 */
    installedVersion: string | null;
    updateAvailable: boolean;
    /** 正在下载、校验或解压。 */
    installing: boolean;
};

export type HifiRuntimeStatus = {
    available: boolean;
    path: string | null;
    /** 解析出的版本号，如 '0.41.0' 或 git 构建的 '0.41.0-123-gabcdef0'。 */
    version: string | null;
    source: HifiRuntimeSource | null;
    /**
     * 没找到时为 MPV_NOT_FOUND；手动路径不可用时也写在这里。只找到比 0.39.0 旧的 mpv（或手动路径指向它）时为
     * MPV_TOO_OLD：available 为 false 时 path / version / source 填的就是那个太旧的。
     */
    errorCode: HifiErrorCode | null;
    /** 设置了手动路径，但它不存在、不可执行、不是 mpv 或版本太旧。 */
    manualPathRejected: boolean;
    platform: string;
    arch: string;
    download: HifiRuntimeDownloadInfo;
    /** 这个 mpv 预计能做 DoP：Windows，且版本比 0.41.0 新。最终以实际输出格式为准。 */
    dopCapable: boolean;
};

export type HifiInstallPhase = 'downloading' | 'verifying' | 'extracting' | 'done' | 'error' | 'cancelled';

export type HifiInstallProgress = {
    phase: HifiInstallPhase;
    version: string;
    receivedBytes: number;
    totalBytes: number;
    errorCode: HifiErrorCode | null;
};

export type HifiInstallResult = {
    ok: boolean;
    errorCode: HifiErrorCode | null;
    status: HifiRuntimeStatus;
};

export type HifiDevice = {
    /** mpv 的 audio-device 值，如 'auto'、'wasapi/{guid}'、'alsa/hw:CARD=D10,DEV=0'。 */
    name: string;
    description: string;
    /** name 里 '/' 之前的驱动名，'auto' 为 'auto'。 */
    driver: string;
    /** Linux 上绕过混音器的 ALSA hw: 直连设备。 */
    direct: boolean;
};

export type HifiDsdMode = 'pcm' | 'dop';

/** 渲染端设置推给主进程的那部分；主进程只在内存里保存，变化时对运行中的 mpv 直接 set_property。 */
export type HifiEngineConfig = {
    /** 手动指定的 mpv 路径，null 表示自动检测。 */
    mpvPath: string | null;
    audioDevice: string;
    exclusive: boolean;
    dsdMode: HifiDsdMode;
    softwareVolume: boolean;
    /**
     * mpv 的 volume，0–100：应用音量（0–1）的立方根乘 100，不取整。mpv 按三次方曲线换成增益，增益就等于应用音量。
     * 渲染端总是填它；主进程只在 softwareVolume 时用，否则 mpv 固定 100。
     */
    volume: number;
    /** 应用里的静音：不论软件音量开没开都下发给 mpv 的 mute；不静音时不碰样本，比特完美不受影响。 */
    muted: boolean;
};

export type HifiSourceRequest =
    | {
        kind: 'local';
        /** 渲染端为这个 File 生成的随机键；主进程据此向渲染端拉块。 */
        sourceKey: string;
        size: number;
        mimeType: string;
        fileName: string;
    }
    | {
        kind: 'navidrome';
        /** 带凭据的 stream 地址（format=raw）；只在主进程内用于 net.fetch，不进 mpv 参数和日志。 */
        url: string;
        fileName: string;
    };

export type HifiLoadRequest = {
    /** 渲染端为这一次起播生成的不透明键（songKey + 随机后缀），用来丢弃过时事件。 */
    trackKey: string;
    /** getPlaybackSongKey(song)。 */
    songKey: string;
    source: HifiSourceRequest;
    startSec: number;
    paused: boolean;
    loopFile: boolean;
};

export type HifiLoadResult =
    | { ok: true; state: HifiEngineState }
    | { ok: false; errorCode: HifiErrorCode; detail?: string };

export type HifiPlaybackStatus = 'stopped' | 'starting' | 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

/** mpv 的 audio-params / audio-out-params，键名换成驼峰。format 如 's16'、's32'、'float'、'floatp'。 */
export type HifiMpvAudioParams = {
    samplerate: number;
    channelCount: number;
    channels: string;
    format: string;
};

/** track-list 里选中的音轨。 */
export type HifiMpvTrackInfo = {
    codec: string | null;
    codecDesc: string | null;
    decoder: string | null;
    demuxSamplerate: number | null;
    demuxChannelCount: number | null;
    demuxBitrate: number | null;
    formatName: string | null;
};

export type HifiQueuedTrack = {
    trackKey: string;
    songKey: string;
};

export type HifiEngineState = {
    status: HifiPlaybackStatus;
    processRunning: boolean;
    trackKey: string | null;
    songKey: string | null;
    sourceKind: 'local' | 'navidrome' | null;
    /** 本地源的 sourceKey；窗口重建后新渲染进程用它重新登记同一个 File。 */
    localSourceKey: string | null;
    durationSec: number | null;
    positionSec: number;
    paused: boolean;
    loopFile: boolean;
    audioParams: HifiMpvAudioParams | null;
    audioOutParams: HifiMpvAudioParams | null;
    /** mpv 的 current-ao，如 'wasapi'、'coreaudio'、'alsa'、'pipewire'。 */
    currentAo: string | null;
    audioDevice: string | null;
    exclusive: boolean;
    /** mpv 的 audio-spdif，DoP 时为 'dsd'。 */
    spdif: string | null;
    volume: number;
    track: HifiMpvTrackInfo | null;
    /** 已用 loadfile append 预载、等着无缝接上的下一首。 */
    next: HifiQueuedTrack | null;
    errorCode: HifiErrorCode | null;
    circuitOpen: boolean;
    /** 每次推送加一，渲染端丢弃乱序到达的旧状态。 */
    seq: number;
};

export type HifiClockReason = 'tick' | 'seek' | 'pause' | 'resume' | 'load';

export type HifiClockUpdate = {
    trackKey: string | null;
    positionSec: number;
    paused: boolean;
    reason: HifiClockReason;
    seq: number;
    /** 主进程从 mpv 读到这个位置时的 Date.now()；渲染进程按它补上推送路上耽搁的时间。 */
    sampledAtMs: number;
};

export type HifiErrorEvent = {
    code: HifiErrorCode;
    trackKey: string | null;
    /** 已去掉查询串和凭据的说明，只用于日志。 */
    detail?: string;
    /** true 表示这次播放已经停了，渲染端要回落。 */
    fatal: boolean;
};

/** 主进程向渲染端要本地文件的一段字节。 */
export type HifiReadRequest = {
    readId: string;
    sourceKey: string;
    offset: number;
    length: number;
};

export type HifiReadResponse =
    | { status: 'ok'; data: Uint8Array }
    | { status: 'unknown-source' }
    | { status: 'failed' };

/** 源的格式：本地取自 music-metadata，Navidrome 取自 Subsonic 的 bitDepth / samplingRate / channelCount。 */
export type HifiSourceSpec = {
    origin: 'local' | 'navidrome';
    codec: string | null;
    container: string | null;
    bitDepth: number | null;
    sampleRate: number | null;
    channels: number | null;
    lossless: boolean | null;
    isDsd: boolean;
    /** DSD 的位速率，如 2822400（DSD64）。 */
    dsdRate: number | null;
    bitrate: number | null;
};

/**
 * rate-passthrough：Linux 上经 PipeWire 输出，PipeWire 报告的设备采样率和 mpv 交出的一致（没被 PipeWire 重采样）。
 * 这只是 PipeWire 自己报的状态，DAC 实际收到什么要在实机上由人确认。
 */
export type HifiSignalVerdict = 'bit-perfect' | 'dop' | 'rate-passthrough' | 'converted' | 'shared-mixer' | 'unknown';

/** system：mpv 之后、声卡之前的系统音频服务（目前只有 Linux 的 PipeWire）。 */
export type HifiSignalStageId = 'source' | 'transport' | 'decode' | 'process' | 'output' | 'system';

export type HifiSignalStageStatus = 'passthrough' | 'converted' | 'bypassed' | 'unknown';

/**
 * filter：PipeWire 里 mpv 和声卡之间的滤波链（均衡器、remap、loopback 这些虚拟节点）。volume：process 一级是 mpv 的软件音量，
 * system 一级是 PipeWire 在流或设备上乘的软件音量。float-to-int：32 位浮点转成 s32，±1.0 以内每个采样的数值不变，
 * 只有超过 0 dBFS 的被截顶；数据格式变了，仍不算比特完美。to-float：转成浮点而数值不变（有效位数不超过尾数的整数转 float /
 * double、float 转 double）。别的采样格式变化（float 转 s24 / s16、double 转整数、32 bit 整数转 float、缩窄位宽）是 format。
 */
export type HifiSignalConversion = 'resample' | 'format' | 'float-to-int' | 'to-float' | 'channels' | 'dsd-to-pcm' | 'dop' | 'volume' | 'shared-mixer' | 'filter';

export type HifiSignalFormat = {
    sampleRate: number | null;
    bitDepth: number | null;
    /** mpv 的采样格式名（'s16'、's32'、'floatp'…）或源的编码名。 */
    sampleFormat: string | null;
    channels: number | null;
    dsdRate: number | null;
};

export type HifiSignalStage = {
    id: HifiSignalStageId;
    status: HifiSignalStageStatus;
    conversions: HifiSignalConversion[];
    format: HifiSignalFormat | null;
    /** 这一级的补充说明，不翻译：编码名、'format=raw'、AO 名加设备名。 */
    detail: string | null;
};

export type HifiSignalPath = {
    verdict: HifiSignalVerdict;
    stages: HifiSignalStage[];
    conversions: HifiSignalConversion[];
    output: {
        ao: string | null;
        device: string | null;
        exclusive: boolean;
    };
    /** 有 PipeWire 探测结果时，逐项列出 PipeWire 这一段对不对得上；没有探测（非 Linux、没有 pw-dump、找不到流）为 null。 */
    system: HifiSystemReport | null;
};

export type HifiPipewireVolume = {
    /** 节点的总音量（线性，1 为 100%）。 */
    volume: number | null;
    mute: boolean;
    channelVolumes: number[];
    /** PipeWire 在软件里乘上去的那部分音量（硬件音量做不了的部分）；没有时为 null。 */
    softVolumes: number[] | null;
    softMute: boolean | null;
};

export type HifiPipewireFormat = {
    /** PipeWire 的格式名：'S32LE'、'S24_32LE'、'F32P'… */
    format: string | null;
    rate: number | null;
    channels: number | null;
};

/** 主进程用 pw-dump 读出的、mpv 那路流在 PipeWire 里的去向。字段都是 PipeWire 报的原样，没有推断。 */
export type HifiOutputProbe = {
    backend: 'pipewire';
    /**
     * 第一次读到这份结果的时刻（主进程读 pw-dump 时的 Date.now()）。之后读到一样的结果时 store 不重写
     * （isSameOutputProbe 不比 at），所以它不是最近一次探测的时刻。
     */
    at: number;
    stream: {
        nodeId: number;
        state: string | null;
        format: HifiPipewireFormat;
        volume: HifiPipewireVolume | null;
    };
    /**
     * 从 mpv 的流到设备之间经过的虚拟节点（滤波链、remap、loopback），按先后。链路停在没有 link-group 的虚拟 sink
     * （EasyEffects 这类）时，它是最后一项，device 为 null。
     */
    filters: Array<{ nodeId: number; name: string; description: string | null }>;
    /** 最后接到的设备节点；没接上、链路走不到设备或停在虚拟 sink 时为 null。 */
    device: {
        nodeId: number;
        name: string;
        description: string | null;
        /** 'alsa'、'bluez5'… 取自 device.api 或 api.* 属性。 */
        api: string | null;
        /** ALSA 的 api.alsa.path，如 'hw:D10'。 */
        path: string | null;
        state: string | null;
        format: HifiPipewireFormat;
        volume: HifiPipewireVolume | null;
    } | null;
    /** pw-metadata settings 里的时钟设置。 */
    graph: {
        clockRate: number | null;
        allowedRates: number[];
        forceRate: number | null;
    };
    /** 同一设备上别的正在放的流（不含 mpv 这一路）。own：来自 Folia 自己的进程（系统媒体控制的静音保活、Web 引擎）。 */
    otherStreams: Array<{ nodeId: number; name: string; own: boolean }>;
};

export type HifiSystemCheckId = 'rate' | 'filters' | 'streamVolume' | 'deviceVolume' | 'otherStreams' | 'channels';

export type HifiSystemCheck = {
    id: HifiSystemCheckId;
    ok: boolean;
    /**
     * 不翻译的补充：'96000 → 48000'、滤波节点名、'87%'、别的流名。rate 一项为 'unknown' 时：链路停在虚拟 sink
     * （EasyEffects 这类），PipeWire 报不出最后接到哪块声卡（SYSTEM_DEVICE_UNKNOWN，在 signalPathSystem.ts）。
     */
    detail: string | null;
};

export type HifiSystemReport = {
    backend: 'pipewire';
    checks: HifiSystemCheck[];
    /** 设备名；链路停在虚拟 sink、不知道最后接到哪块声卡时为 null。 */
    deviceName: string | null;
    deviceRate: number | null;
    deviceFormat: string | null;
    /** pw-metadata 允许的采样率；判断「为什么没切」时要用。 */
    allowedRates: number[];
    /** pw-metadata 里的 clock.force-rate：强制的采样率；没强制（0 或没设）时为 null。 */
    forceRate: number | null;
};

/** Linux：推给主进程 MPRIS 的 HiFi 播放状态（electron/hifi/mpris/mprisIpc.cjs 校验）。active 为假时主进程交还总线名。 */
export type HifiMprisState =
    | { active: false }
    | {
        active: true;
        trackKey: string;
        title: string;
        artists: string[];
        album: string;
        durationSec: number | null;
        status: 'Playing' | 'Paused' | 'Stopped';
        /** atMs（Date.now()）那一刻的位置；在放时主进程从这里往后外推。 */
        positionSec: number;
        atMs: number;
        /** 这次推送是因为跳转：主进程补发 Seeked。 */
        seeked: boolean;
    };

/** MPRIS 的封面：页面读到的图片字节，读不到时退回 http(s) 原址（主进程下载成文件，原址不交给 MPRIS）。 */
export type HifiMprisArtwork = { bytes: Uint8Array; mimeType: string } | { url: string };

/** HiFi 在放时主进程有没有在会话总线上登记好 MPRIS。 */
export type HifiMprisStatus = { registered: boolean };

/** 系统媒体面板经 MPRIS 发来的按键。 */
export type HifiMprisCommand = 'play' | 'pause' | 'playpause' | 'stop' | 'next' | 'previous';
