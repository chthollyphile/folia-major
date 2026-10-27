/// <reference types="vite/client" />

import type { ModClearCacheResult, ModExportProgress, ModFfmpegStatus, ModLogEntry, ModMainCallStats, ModRpcMessage, ModRuntimeInfo, ModRuntimeSnapshot, ModSecretChange, ModStorageUsageResult } from './mods/types';

/** 设置 -> 连接与集成 -> AI 控制：控制服务的开关、地址、令牌与 CLI/MCP 路径。 */
export type ControlServerStatus = {
  enabled: boolean;
  running: boolean;
  url: string | null;
  port: number | null;
  token: string | null;
  tokenFile: string;
  dataDir: string;
  controlCliPath: string;
  controlMcpPath: string;
  allowEval: boolean;
  error: string | null;
};

declare global {
  const __COMMIT_HASH__: string;
  const __GIT_BRANCH__: string;
  /** 构建来源仓库（owner/repo），拿不到时为 'unknown'。 */
  const __BUILD_REPO__: string;
  /** 十六进制短 commit，拿不到时为 'dev'。 */
  const __BUILD_COMMIT__: string;
  /** 构建类别 official / self-hosted / unofficial（见 dev/build/buildIdentity.mjs）。 */
  const __BUILD_KIND__: string;
  /** 自部署平台 docker / vercel / cloudflare；其他类别为空串。 */
  const __BUILD_HOST__: string;
  const __APP_VERSION__: string;
  const __APP_VERSION_LABEL__: string;
  const __APP_RELEASE_CHANNEL__: string;
  const __DOCKER_STACK_VERSION__: string;

  interface Window {
    __FOLIA_RUNTIME_CONFIG__?: {
      aiProvider?: 'gemini' | 'openai';
      /** Docker gateway 注入 'docker'；其他部署不带这个字段。 */
      deployment?: 'docker';
    };
  }

  /** Unsaved AI settings sent by the "test connection" button. */
  interface AiConnectionTestPayload {
    provider: 'gemini' | 'openai';
    /**
     * The form's preset (shared/ai/providerRegistry.mjs). 'custom' requires apiUrl: a custom
     * connection must never fall back to a built-in endpoint. Requests follow apiUrl's host.
     */
    presetId?: string;
    /** Typed key; empty means "use the saved key", which only the main process can read. */
    apiKey: string;
    apiUrl?: string;
    model?: string;
    stream?: boolean;
    useSystemProxy?: boolean;
  }

  interface AiModelListResult {
    ok: boolean;
    models?: { id: string; name: string }[];
    status?: number;
    errorKind?: 'invalid' | 'config' | 'auth' | 'http' | 'network' | 'timeout' | 'empty';
    /** On a failure: model ids the provider suggests instead (shared/ai adapters' suggestedModels). */
    suggestedModels?: string[];
  }

  interface AiConnectionTestResult {
    ok: boolean;
    status?: number;
    durationMs: number;
    model?: string;
    text?: string;
    /** Set when the connection worked but no text came back. */
    emptyReason?: 'reasoning' | 'empty';
    error?: string;
    errorKind?: 'invalid' | 'config' | 'timeout' | 'network' | 'http';
  }

  interface ElectronCacheDirectoryResult {
    path: string;
    isDefault: boolean;
    canceled?: boolean;
  }

  interface ElectronAudioCacheEntry {
    found: boolean;
    data?: Uint8Array | ArrayBuffer | null;
    mimeType?: string | null;
  }

  type ElectronKugouOperation = import('./services/onlineMusic/kugou/kugouTransport').KugouOperation;

  interface ElectronAudioCacheStats {
    size: number;
    count: number;
  }

  interface ElectronLyricProxyResponse {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    bodyText: string;
  }

  interface ElectronNeteaseApiStatus {
    status: 'starting' | 'running' | 'error';
    port: number | null;
    error: string | null;
    // 没起来是因为断网：页面说连不上，下一次要用它时它再启动一次。
    offline?: boolean;
    updatedAt: number;
  }

  // 内嵌后端的诊断快照（electron/loginBackendIpc.cjs 的 get-login-diagnostics）。报告会原样贴进 issue；
  // 界面已告知用户其中包含哪些数据，登录凭据（cookie、token）的值不在其中。

  interface ElectronAppEnvironment {
    version: string;
    electron: string;
    node: string;
    chrome: string;
    platform: string;
    arch: string;
    osRelease: string;
    osVersion: string | null;
    locale: string | null;
    timeZone: string | null;
    uptimeSec: number;
    /** safeStorage 的状态；Linux 上 backend 为 basic_text 时 QQ 的凭据仓库会拒绝保存登录态。 */
    credentialStore: { encryptionAvailable?: boolean; backend?: string | null; error?: string } | null;
  }

  /** 拉起后端的一步（electron/backendLifecycle.cjs 的 createStartupRecorder）。 */
  interface ElectronBackendStartupStep {
    id: string;
    startedAt: number;
    durationMs: number | null;
    outcome: 'running' | 'ok' | 'failed';
    detail: Record<string, unknown>;
    error: string | null;
  }

  interface ElectronBackendStartupRun {
    startedAt: number;
    finishedAt: number | null;
    outcome: string;
    steps: ElectronBackendStartupStep[];
  }

  interface ElectronNetworkError {
    code: string | null;
    message: string;
  }

  /** 一次出站请求的连接过程（electron/networkRecorder.cjs）。 */
  interface ElectronNetworkConnection {
    at?: number;
    tag?: string | null;
    method?: string;
    host: string;
    path: string;
    dns: Array<{ address: string; family: 4 | 6 | null }>;
    dnsError?: ElectronNetworkError | null;
    attempts: Array<{ address: string; family: 4 | 6 | null; outcome: string; error: ElectronNetworkError | null }>;
    remote: { address: string | null; family: 4 | 6 | null } | null;
    reusedSocket: boolean;
    connectMs: number | null;
    tlsMs: number | null;
    responseMs: number | null;
    totalMs: number | null;
    status: number | null;
    error: (ElectronNetworkError & { phase: string }) | null;
    settled?: string;
  }

  interface ElectronNeteaseLoginRequestRecord {
    at: number;
    uri: string;
    crypto: string;
    ipHeader: 'none' | 'random-cn' | 'client' | 'real-ip';
    deviceIdTail: string;
    hasMusicU: boolean;
    hasMusicA: boolean;
    durationMs: number | null;
    outcome: {
      settled: 'pending' | 'resolved' | 'rejected';
      status: number | null;
      code: number | string | null;
      message: string;
    };
    connections: ElectronNetworkConnection[];
  }

  interface ElectronNeteaseLoginDiagnostics {
    providerId: 'netease';
    capturedAt: number;
    app: ElectronAppEnvironment;
    backend: ElectronNeteaseApiStatus;
    startup: ElectronBackendStartupRun[];
    /** 上游包没加载起来（startup 里 load 步骤失败）时为 null，identity 同理。 */
    login: {
      capturedAt: number;
      startup: { anonymousTokenAtLoad?: 'present' | 'empty' };
      network: {
        interfaces: Array<{ name: string; addresses: Array<{ address: string; family: 4 | 6; scopeId?: number }> }>;
        error?: string;
      };
      requests: ElectronNeteaseLoginRequestRecord[];
    } | null;
    /**
     * 扫码身份轮换（electron/netease/neteaseLoginIdentity.cjs）：进程启动时刻、当前 deviceId、扫码请求被重置的次数、
     * 实际轮换的次数（被重置后到下一次要码才换）、最近一次是否换到了新的匿名 token、是否还有待轮换。
     */
    identity: {
      processStartedAt: number;
      deviceId: string | null;
      connectionResets: number;
      rotations: number;
      lastRotatedAt: number | null;
      lastTokenRenewed: boolean | null;
      pendingRotation: boolean;
    } | null;
    /** 最近的上游连接（不属于任何一次登录请求的那些，例如启动时取 xeapi 公钥）。 */
    connections: ElectronNetworkConnection[];
  }

  interface ElectronQqLoginDiagnostics {
    providerId: 'qq';
    capturedAt: number;
    app: ElectronAppEnvironment;
    backend: ElectronQqApiStatus;
    version: string | null;
    startup: ElectronBackendStartupRun[];
    hooks: { installed: string[]; error: string | null };
    /** 包内扫码服务的失败（electron/qq/qqBackend.cjs 的钩子），带原始错误。 */
    failures: Array<{
      at: number;
      kind: 'session' | 'bootstrap';
      stage: string | null;
      channel: string | null;
      sessionState: string | null;
      error: Record<string, unknown>;
    }>;
    /** 包的 qq-auth.* 日志事件。 */
    authEvents: Array<{ at: number; level: string; event: string; details: unknown }>;
    connections: ElectronNetworkConnection[];
  }

  type ElectronLoginDiagnostics = ElectronNeteaseLoginDiagnostics | ElectronQqLoginDiagnostics;

  // `unavailable` means the packaged build shipped without the bundled qq-music-api.
  interface ElectronQqApiStatus {
    status: 'starting' | 'running' | 'error' | 'unavailable';
    port: number | null;
    error: string | null;
    /** 这次启动没能读出加密的登录仓库：后端里没有任何会话，后端不认一个 session 不说明登录没了。 */
    sessionStoreUnreadable?: boolean;
    updatedAt: number;
  }

  interface ElectronKugouApiStatus {
    available: boolean;
    authenticated: boolean;
    error: string | null;
  }

  interface ElectronTaskbarControlState {
    hasActiveTrack: boolean;
    canGoPrevious: boolean;
    canGoNext: boolean;
    isPlaying: boolean;
  }

  type ElectronTaskbarControlAction = 'previous' | 'play-pause' | 'next';

  type ElectronRemoteControlCommand =
    | { type: 'play-pause' }
    | { type: 'play' }
    | { type: 'pause' }
    | { type: 'previous' }
    | { type: 'next' }
    | { type: 'seek'; time: number }
    | { type: 'cycle-loop-mode' }
    | { type: 'resize-main-window'; width: number; height: number }
    | { type: 'set-main-window-border-visible'; visible: boolean }
    | { type: 'set-main-window-click-through'; enabled: boolean }
    | { type: 'set-main-window-always-on-top'; enabled: boolean }
    | { type: 'set-transparent-mode-enabled'; enabled: boolean }
    | { type: 'disable-transparent-mode' }
    | { type: 'cycle-player-chrome-visibility-mode' }
    | { type: 'set-player-chrome-visibility-mode'; mode: import('./types/remoteControl').PlayerChromeVisibilityMode }
    | { type: 'open-export' }
    | { type: 'start-export'; preset: ElectronVideoExportPreset; startMode: ElectronVideoExportStartMode }
    | { type: 'stop-export' }
    | { type: 'cancel-export' }
    | { type: 'toggle-like' }
    | import('./types/remoteControl').RemoteActionActivation;

  type ElectronVideoExportStatus =
    | 'idle'
    | 'preparing'
    | 'countdown'
    | 'recording'
    | 'finalizing'
    | 'done'
    | 'error';

  type ElectronVideoExportStartMode = 'from-start' | 'current';

  interface ElectronVideoExportPreset {
    id: string;
    label: string;
    width: number;
    height: number;
    orientation: 'landscape' | 'portrait';
  }

  interface ElectronVideoExportState {
    status: ElectronVideoExportStatus;
    presetId: string | null;
    progress: number;
    elapsed: number;
    duration: number;
    countdown: number | null;
    filePath: string | null;
    error: string | null;
  }

  interface ElectronSaveDialogResult {
    canceled: boolean;
    filePath: string | null;
  }

  interface ElectronRemoteControlSnapshot {
    remoteActions?: import('./types/remoteControl').RemoteActionsSnapshot;
    hasTrack: boolean;
    trackKey: string | null;
    title: string | null;
    artist: string | null;
    coverUrl: string | null;
    currentTime: number;
    duration: number;
    playerState: string;
    loopMode: 'off' | 'all' | 'one';
    canGoPrevious: boolean;
    canGoNext: boolean;
    prevTrackKey: string | null;
    prevTrackTitle: string | null;
    prevTrackArtist: string | null;
    prevTrackCoverUrl: string | null;
    nextTrackKey: string | null;
    nextTrackTitle: string | null;
    nextTrackArtist: string | null;
    nextTrackCoverUrl: string | null;
    trackTransition: import('./types/remoteControl').RemoteTrackTransition | null;
    controlsDisabled: boolean;
    isStageActive: boolean;
    transparentModeEnabled: boolean;
    mainWindowClickThroughEnabled: boolean;
    mainWindowAlwaysOnTop: boolean;
    mainWindowBorderVisible: boolean;
    playerChromeHidden: boolean;
    playerChromeVisibilityMode: import('./types/remoteControl').PlayerChromeVisibilityMode;
    exportState: ElectronVideoExportState;
    isDaylight?: boolean;
    lyrics?: import('./types').LyricData | null;
    subtitleContentMode: import('./types').SubtitleContentMode;
    isLiked?: boolean;
    canLike?: boolean;
    likeUnavailableProvider?: string;
    updatedAt: number;
    mainWindowWidth?: number;
    mainWindowHeight?: number;
  }

  interface ElectronPlaybackSyncBridgeStatus {
    remoteControlOpen: boolean;
    discordPresenceEnabled: boolean;
  }

  interface ElectronVoiceInputPauseStatus {
    active: boolean;
    enabled: boolean;
    supported: boolean;
  }

  interface ElectronDiscordPresenceSnapshot {
    hasTrack: boolean;
    title: string | null;
    artist: string | null;
    coverUrl: string | null;
    currentTime: number;
    duration: number;
    playerState: string;
    updatedAt: number;
  }

  interface ElectronMainWindowClickThroughState {
    enabled: boolean;
    unlockHoverActive?: boolean;
  }

  type ElectronObsBrowserSourceStatus = import('./types/obsBrowserSource').ObsBrowserSourceStatus;
  type ElectronObsBrowserSourceConfig = import('./types/obsBrowserSource').ObsBrowserSourceConfig;
  type ElectronObsBrowserSourceClock = import('./types/obsBrowserSource').ObsBrowserSourceClock;
  type ElectronObsBrowserSourceAudio = import('./types/obsBrowserSource').ObsBrowserSourceAudio;

  interface ElectronDiscordPresenceStatus {
    enabled: boolean;
    configured: boolean;
    connected: boolean;
    error: string | null;
    applicationId: string | null;
    updatedAt: number;
  }

  type ElectronUpdateStatusValue =
    | 'disabled'
    | 'idle'
    | 'checking'
    | 'available'
    | 'latest'
    | 'error'
    | 'downloading'
    | 'downloaded'
    | 'unsupported';

  interface ElectronUpdateStatus {
    status: ElectronUpdateStatusValue;
    supported: boolean;
    updateCheckSupported: boolean;
    updateCheckSupportReason?: 'system' | 'channel' | null;
    platform?: string;
    updateCheckEnabled: boolean;
    autoUpdateEnabled: boolean;
    autoUpdateSupported: boolean;
    autoUpdateSupportReason?: 'system' | 'channel' | null;
    currentVersion: string;
    availableVersion: string | null;
    updateUrl: string | null;
    error: string | null;
    lastCheckedAt: number | null;
    lastSeenVersion: string | null;
    updateSeen: boolean;
    downloadProgress?: {
      percent: number;
      transferred?: number;
      total?: number;
    } | null;
  }

  type StageActiveEntryKind = 'lyrics' | 'media';
  type StageSource = 'stage-api' | 'now-playing';

  interface StageEmbeddedUsltTag {
    language?: string;
    descriptor?: string;
    text: string;
  }

  interface StageEmbeddedLyricSource {
    type: 'embedded';
    usltTags?: StageEmbeddedUsltTag[];
    textContent?: string;
    translationContent?: string;
  }

  interface StageLocalLyricSource {
    type: 'local';
    lrcContent: string;
    tLrcContent?: string;
    formatHint?: 'lrc' | 'enhanced-lrc' | 'vtt' | 'ttml' | 'yrc' | 'qrc' | 'krc';
  }

  interface StageNeteaseLyricBranch {
    lyric?: string;
    pureMusic?: boolean;
  }

  interface StageNeteaseLyricSource {
    type: 'netease';
    lrc?: StageNeteaseLyricBranch & {
      yrc?: StageNeteaseLyricBranch;
      ytlrc?: StageNeteaseLyricBranch;
    };
    yrc?: StageNeteaseLyricBranch;
    ytlrc?: StageNeteaseLyricBranch;
    tlyric?: StageNeteaseLyricBranch;
    pureMusic?: boolean;
  }

  interface StageNavidromeStructuredLyricLine {
    start?: number;
    value?: string;
  }

  interface StageNavidromeLyricSource {
    type: 'navidrome';
    structuredLyrics?: StageNavidromeStructuredLyricLine[];
    plainLyrics?: string;
  }

  interface StageQrcLyricSource {
    type: 'qrc';
    qrcContent: string;
    translationContent?: string;
  }

  type StageLyricSource =
    | StageEmbeddedLyricSource
    | StageLocalLyricSource
    | StageNeteaseLyricSource
    | StageNavidromeLyricSource
    | StageQrcLyricSource;

  interface StageLyricsSession {
    title?: string;
    artist?: string;
    album?: string;
    lyricSource: StageLyricSource;
    updatedAt: number;
  }

  interface StageMediaSession {
    id: string;
    title: string;
    artist: string;
    album?: string;
    durationMs?: number | null;
    coverUrl?: string | null;
    coverArtUrl?: string | null;
    audioUrl?: string | null;
    audioSrc: string;
    audioMimeType?: string;
    coverMimeType?: string;
    lyricsText?: string | null;
    lyricsFormat?: 'lrc' | 'enhanced-lrc' | 'vtt' | 'ttml' | 'yrc' | 'qrc' | null;
    updatedAt: number;
  }

  type StageSession = StageMediaSession;

  interface StageSearchResult {
    songId: number;
    title: string;
    artists: string[];
    album: string;
    durationMs: number | null;
    coverUrl: string | null;
  }

  interface StageExternalPlayRequest {
    requestId: string;
    songId: number;
    appendToQueue?: boolean;
  }

  interface StageExternalPlayResult {
    requestId: string;
    ok: boolean;
    error?: string | null;
    baseSnapshot?: StagePlayerSnapshot;
    snapshot?: StagePlayerSnapshot;
    result?: unknown;
  }

  interface StageStatus {
    domain?: 'stage-input';
    direction?: 'outside-in';
    enabled: boolean;
    modeEnabled?: boolean;
    source?: StageSource | null;
    port: number;
    token: string | null;
    activeEntryKind: StageActiveEntryKind | null;
    lyricsSession: StageLyricsSession | null;
    mediaSession: StageMediaSession | null;
  }

  type StagePlayerPlaybackContext = 'normal-playback' | 'stage-session' | 'external-playback-source';

  interface StagePlayerCurrent {
    id: string;
    source: string;
    title: string;
    artist: string;
    album: string;
    durationMs: number;
    coverUrl: string | null;
  }

  interface StagePlayerControlCapabilities {
    play: boolean;
    pause: boolean;
    resume: boolean;
    seek: boolean;
    previous: boolean;
    next: boolean;
  }

  interface StagePlayerQueueCapabilities {
    append: boolean;
    insertNext: boolean;
    remove: boolean;
    move: boolean;
    select: boolean;
    clear: boolean;
  }

  interface StagePlayerQueueItem extends StagePlayerCurrent {
    queueItemId: string;
  }

  interface StagePlayerQueueSummary {
    currentIndex: number;
    length: number;
    revision?: string;
  }

  interface StagePlayerQueueSnapshot extends StagePlayerQueueSummary {
    items: StagePlayerQueueItem[];
  }

  interface StagePlayerQueueWindow extends StagePlayerQueueSummary {
    items: StagePlayerQueueItem[];
    offset: number;
    limit: number;
    returned: number;
    hasMore: boolean;
    nextOffset: number | null;
  }

  type StagePlayerQueueDiffOp =
    | { op: 'insert'; index: number; item: StagePlayerQueueItem }
    | { op: 'remove'; index: number }
    | { op: 'move'; from: number; to: number }
    | { op: 'clear' }
    | { op: 'select'; index: number };

  interface StagePlayerQueueDiff {
    baseRevision: string;
    revision: string;
    ops: StagePlayerQueueDiffOp[];
    requiresReload?: true;
  }

  interface StagePlayerSnapshot {
    playbackContext: StagePlayerPlaybackContext;
    current: StagePlayerCurrent | null;
    playerState: string;
    positionMs: number;
    durationMs: number;
    sampledAtMs: number;
    updatedAt: number;
    controlCapabilities: StagePlayerControlCapabilities;
    queueCapabilities: StagePlayerQueueCapabilities;
    queue: StagePlayerQueueSnapshot;
  }

  interface StagePlayerControlRequest {
    requestId: string;
    action: 'next' | 'prev' | 'pause' | 'resume' | 'seek';
    positionMs?: number;
  }

  interface StagePlayerQueueRequest {
    requestId: string;
    action: 'append' | 'insert-next' | 'remove' | 'move' | 'select' | 'clear';
    songId?: number;
    songIds?: number[];
    queueItemId?: string;
    fromQueueItemId?: string;
    fromIndex?: number;
    toIndex?: number;
    index?: number;
  }

  interface StagePlayerRequestResult {
    requestId: string;
    ok: boolean;
    error?: string | null;
    snapshot?: StagePlayerSnapshot;
    result?: unknown;
  }


  /** One connected display, for the choice of the display wallpaper mode uses. Geometry is in DIP, as Electron reports it. */
  interface ElectronWallpaperDisplay {
    id: number;
    /** The monitor's own name, where the system gives one. */
    label: string;
    bounds: { x: number; y: number; width: number; height: number };
    scaleFactor: number;
    primary: boolean;
  }

  /** What the main process says about that choice; see electron/wallpaper/wallpaperDisplay.cjs. */
  interface ElectronWallpaperDisplaysState {
    displays: ElectronWallpaperDisplay[];
    /** The stored choice; null is automatic. Its display need not be connected. */
    choice: { id: number; label: string; bounds: { x: number; y: number; width: number; height: number } } | null;
    /** The connected display the choice is, or null: automatic, or its display is not connected. */
    chosenId: number | null;
    /** The display the wallpaper is on, or would be on if it were entered now. */
    activeId: number | null;
  }

  /** One process's share of a memory sample. Sizes are whole megabytes; see electron/debug/memoryMonitor.cjs. */
  interface DebugMemoryProcess {
    pid: number;
    /** `Browser`, `Tab`, `GPU`, `Utility/folia-analysis` and so on - the type plus its service name. */
    type: string;
    workingSetMB: number;
    /** This process's OWN high-water mark, reached whenever. Never summed across processes. */
    peakWorkingSetMB: number;
    /**
     * Windows via the metrics table, any platform for a process that answered for itself; null
     * where neither applies (GPU, utility), never 0 as a stand-in.
     */
    privateMB: number | null;
    /** Memory shared with other processes. Self-reported, so renderer and main only. */
    sharedMB: number | null;
    /** This process's V8 heap. Self-reported; null for the ones that cannot be asked. */
    heapMB: number | null;
    /** Blink's own allocations - DOM, CSS, decoded images. Renderer processes only. */
    blinkMB: number | null;
    cpuPercent: number;
    /** Open file descriptors. Linux only (counted from /proc); null elsewhere. */
    fdCount: number | null;
  }

  /** One tick of the memory monitor: the whole app at one instant, plus the session's figures so far. */
  interface DebugMemorySample {
    at: string;
    uptimeSec: number;
    totalWorkingSetMB: number;
    totalPrivateMB: number | null;
    cpuPercent: number;
    processCount: number;
    /** Peak / floor / mean of the SIMULTANEOUS total, over this monitoring run. */
    peakMB: number;
    floorMB: number;
    avgMB: number;
    samples: number;
    mainHeapUsedMB: number | null;
    mainHeapTotalMB: number | null;
    /** The renderer's heap - the one that separates leaked JS objects from native growth. */
    rendererHeapUsedMB: number | null;
    /**
     * The renderer's own private memory. Needs no summing, so unlike `totalPrivateMB` it exists on
     * every platform - and the renderer is the largest process in this app anyway.
     */
    rendererPrivateMB: number | null;
    /** Open fds of the renderer / GPU process. Linux only; a steady climb is the shm fd leak. */
    rendererFdCount: number | null;
    gpuFdCount: number | null;
    systemFreeMB: number | null;
    systemTotalMB: number | null;
    processes: DebugMemoryProcess[];
  }

  /** Whether each log is recording, how it opens its file, and where the files are. */
  interface DebugModuleState {
    runtimeLogEnabled: boolean;
    runtimeLogMode: 'append' | 'overwrite';
    /** The session-log switch as the main process last heard it. The renderer owns it. */
    consoleCaptureEnabled: boolean;
    memoryMonitorEnabled: boolean;
    memoryLogEnabled: boolean;
    memoryLogMode: 'append' | 'overwrite';
    memoryIntervalMs: number;
    logsRoot: string;
    runtimeFile: string | null;
    memoryFile: string | null;
  }

  interface Window {
    electron?: {
      webUtils?: {
        /** Resolves the OS path of a dropped File (File.path was removed in modern Electron). */
        getPathForFile: (file: File) => string;
      };
      /** Beat This! on the CPU in the analysis worker - automix's fallback only. Null when the weights are absent. */
      runBeatThis?: (
        chunks: Array<{ data: Float32Array; frames: number }>,
      ) => Promise<{ beat: Float32Array[]; downbeat: Float32Array[] } | null>;
      /**
       * The WebGPU export of Beat This! (fp16 tensors + manifest, one file), read by the main process.
       * final0, shipped with the app, which automix and 智能动感模式 both run. Null when absent.
       */
      getBeatThisGpuWeights?: (model?: 'beat_this') => Promise<{
        weights: Uint8Array<ArrayBuffer>;
        manifest: import('./services/analysis/beatThisWgsl/runtime').BeatThisWgslManifest;
      } | null>;
      /** htdemucs' WebGPU export, shipped with the app, for the drum stem of 智能动感模式; null when absent. */
      getHtdemucsGpuWeights?: () => Promise<{
        weights: Uint8Array<ArrayBuffer>;
        manifest: import('./services/analysis/htdemucsWgsl/runtime').HtdemucsWgslManifest;
      } | null>;
      /**
       * Automix switched on or off. While on, the analysis worker keeps htdemucs loaded across tracks;
       * off releases it in that process. One-way.
       * (From the PR #750 re-review, 2026-10-19: nothing is kept while on any more - the worker releases
       * htdemucs a minute after each run - and off still releases it at once.)
       */
      setAutomixEnabled?: (enabled: boolean) => void;
      /**
       * htdemucs separation in the analysis worker, for one window of one track at 44.1kHz.
       * `other` is not returned - it is derived by subtraction so the stems sum to the mix exactly.
       * `{ declined }` carries the worker's reason when it ran nothing.
       */
      separateStems?: (
        /**
         * `threads`: the CPU threads to run with (analysis/scheduler.ts cpuThreads); four when absent.
         * `resident: false`: a fallback for a GPU machine, released after a minute idle (phase 4).
         * (From the PR #750 re-review, 2026-10-19: `resident` is gone - every run's model is released
         * after a minute idle, on every machine, and the worker ignores the field.)
         */
        request: { left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer>; threads?: number },
      ) => Promise<(Record<
        'drums' | 'bass' | 'vocals',
        // Never shared memory: this crosses the IPC boundary by structured clone, which always
        // reconstitutes a plain ArrayBuffer on this side.
        { left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer> }
      > & {
        /** How long the worker spent building the model for this request (ms), 0 when it was built: automix's CPU estimate learns from the rest of the wait. */
        buildMs?: number;
      }) | { declined: string } | null>;
      /**
       * Which model files are on disk, answered without loading them.
       *
       * Absent in the browser build, which is why every reader treats a missing function as "no
       * weights" rather than as "unknown".
       */
      getAutomixModelsPresent?: () => Promise<{ beat_this: boolean; htdemucs: boolean; htdemucs_gpu?: boolean }>;
      /** Developer debug module. Absent in the browser build, where every caller no-ops. */
      debugGetState?: () => Promise<DebugModuleState>;
      debugSetState?: (patch: Partial<Pick<DebugModuleState, 'runtimeLogEnabled' | 'runtimeLogMode' | 'consoleCaptureEnabled' | 'memoryMonitorEnabled' | 'memoryLogEnabled' | 'memoryLogMode' | 'memoryIntervalMs'>>) => Promise<DebugModuleState>;
      debugOpenLogs?: (which?: 'runtime' | 'memory') => Promise<boolean>;
      debugWriteRuntimeLines?: (lines: Array<{ at: number; level: string; tag: string | null; text: string }>) => void;
      /** The main process's console lines, for the log panel. */
      onDebugMainLines?: (callback: (lines: Array<{ at: number; level: 'log' | 'info' | 'warn' | 'error' | 'debug'; text: string }>) => void) => () => void;
      /** What this process can say about itself that the metrics table cannot see from outside. */
      debugRendererMemory?: () => Promise<{ pid: number; privateKB: number; sharedKB: number; blinkAllocatedKB: number } | null>;
      debugReportRendererMemory?: (report: { pid: number; privateKB?: number; sharedKB?: number; blinkAllocatedKB?: number; heapUsedKB?: number }) => void;
      onDebugMemorySample?: (callback: (sample: DebugMemorySample) => void) => () => void;
      /** One-way stage marks from the automix session into the runtime log. */
      diagMark?: (text: string) => void;
      /**
       * Old automix models in the folder an earlier version (up to 0.7.20) let the listener choose:
       * where, how many and how big, or null when there is nothing to ask about.
       */
      checkLegacyModels?: () => Promise<{ dir: string; count: number; bytes: number } | null>;
      /** Deletes them ('delete') or leaves them ('dismiss'); either way the prompt is not shown again. */
      resolveLegacyModels?: (action: 'delete' | 'dismiss') => Promise<{ ok: boolean }>;
      /** Opens that folder in the file manager. */
      openLegacyModelsFolder?: () => Promise<boolean>;
      platform: string;
      isLinuxX11: boolean;
      getSettings: () => Promise<any>;
      saveSettings: (key: string, value: any) => Promise<any>;
      onWallpaperModeChanged?: (callback: (settings: Record<string, unknown>) => void) => () => void;
      onWallpaperTransparentRefused?: (callback: (settings: Record<string, unknown>) => void) => () => void;
      /** The tray asked to enter wallpaper mode; the renderer shows the confirmation before entering. */
      onWallpaperEntryRequested?: (callback: () => void) => () => void;
      onWallpaperInputMonitorRequested?: (callback: () => void) => () => void;
      /** macOS wallpaper mode with Stage Manager on and the desktop icons shown, without the Accessibility grant the click guard needs (issue #698). */
      onWallpaperAccessibilitySuggested?: (callback: () => void) => () => void;
      /**
       * Windows only: the GPU choice this run started with (a later change waits for a restart), whether
       * it came from the setting or a command-line switch, and the name of the adapter Chromium renders
       * on. null off Windows or when the asking page is not the main window.
       */
      getGpuPreferenceState?: () => Promise<{
          applied: 'auto' | 'high-performance' | 'low-power';
          source: 'setting' | 'command-line';
          activeGpu: string | null;
      } | null>;
      /** The connected displays and the display chosen for wallpaper mode. null when the asking page is not the main window. */
      getWallpaperDisplays?: () => Promise<ElectronWallpaperDisplaysState | null>;
      /** Chooses a connected display by id, or automatic with null; a running wallpaper moves at once. Answers the new state. */
      setWallpaperDisplay?: (displayId: number | null) => Promise<ElectronWallpaperDisplaysState | null>;
      /** A display was connected, removed or changed, or the choice changed. */
      onWallpaperDisplaysChanged?: (callback: (state: ElectronWallpaperDisplaysState) => void) => () => void;
      /** macOS wallpaper mode: the on-screen controls' rects (viewport CSS px), covered by click catchers so Finder and Stage Manager never see those clicks. */
      setWallpaperHitRegions?: (rects: Array<{ left: number; top: number; width: number; height: number }>) => void;
      setPlaybackDisplaySleepBlockingActive: (active: boolean) => Promise<boolean>;
      /**
       * The 后台节流 switch for the main window: `active` while it is on and not standing down
       * (wallpaper, video export, OBS browser source); `hidden` while it is and the window is
       * minimised or hidden to the tray.
       */
      getBackgroundThrottlingState?: () => Promise<{ active: boolean; hidden: boolean }>;
      onBackgroundThrottlingChanged?: (callback: (state: { active: boolean; hidden: boolean }) => void) => () => void;
      setAppLocale: (localeKey: 'en' | 'zh-CN' | 'zh-TW' | 'in') => Promise<string>;
      getCacheDirectory: () => Promise<ElectronCacheDirectoryResult>;
      chooseCacheDirectory: () => Promise<ElectronCacheDirectoryResult>;
      resetCacheDirectory: () => Promise<ElectronCacheDirectoryResult>;
      getUpdateStatus: () => Promise<ElectronUpdateStatus>;
      checkForUpdates: () => Promise<ElectronUpdateStatus>;
      markUpdateSeen: (version?: string | null) => Promise<ElectronUpdateStatus>;
      openUpdateReleasePage: (version?: string | null) => Promise<boolean>;
      openExternalUrl: (url: string) => Promise<boolean>;
      downloadUpdate: () => Promise<ElectronUpdateStatus>;
      quitAndInstallUpdate: () => Promise<boolean>;
      onUpdateStatusChanged: (callback: (status: ElectronUpdateStatus) => void) => () => void;
      getAudioCache: (cacheKey: string) => Promise<ElectronAudioCacheEntry>;
      hasAudioCache: (cacheKey: string) => Promise<boolean>;
      /** `limitBytes` is the cache ceiling to prune down to afterwards; 0 means no ceiling. */
      saveAudioCache: (cacheKey: string, data: ArrayBuffer, mimeType?: string, limitBytes?: number) => Promise<boolean>;
      /** Deletes the file under `cacheKey` only while it is `size` bytes; resolves to whether it did. */
      removeAudioCache: (cacheKey: string, size: number) => Promise<boolean>;
      getAudioCacheUsage: () => Promise<number>;
      getAudioCacheStats: () => Promise<ElectronAudioCacheStats>;
      clearAudioCache: () => Promise<boolean>;
      requestTranscodeFallback?: (request: import('./types/playbackRecovery').TranscodeFallbackRequest) => Promise<import('./types/playbackRecovery').TranscodeFallbackResult>;
      cancelTranscodeFallback?: (requestId: string) => Promise<boolean>;
      getCoverCache: (cacheKey: string) => Promise<ElectronAudioCacheEntry>;
      saveCoverCache: (cacheKey: string, data: ArrayBuffer, mimeType?: string) => Promise<boolean>;
      removeCoverCache: (cacheKey: string) => Promise<boolean>;
      getCoverCacheUsage: () => Promise<number>;
      clearCoverCache: () => Promise<boolean>;
      hasLocalCoverAsset: (assetId: string) => Promise<boolean>;
      saveLocalCoverAsset: (assetId: string, data: ArrayBuffer, mimeType: string) => Promise<boolean>;
      removeLocalCoverAsset: (assetId: string) => Promise<boolean>;
      clearLocalCoverAssets: () => Promise<boolean>;
      generateTheme: (lyricsText: string, options?: { isPureMusic?: boolean; songTitle?: string }) => Promise<any>;
      /** Word-segments lyric lines with the user's configured model. Resolves to one boundary array per line. */
      segmentLyrics: (lines: string[]) => Promise<string[][]>;
      /** Sends "hello" with the unsaved AI settings from the form and reports the reply. Never rejects on connection failures. */
      testAiConnection: (settings: AiConnectionTestPayload) => Promise<AiConnectionTestResult>;
      listAiModels: (settings: AiConnectionTestPayload) => Promise<AiModelListResult>;
      fetchLyricProxy: (
        url: string,
        init?: {
          method?: string;
          headers?: Record<string, string>;
          body?: string;
        },
      ) => Promise<ElectronLyricProxyResponse>;
      getNeteasePort: () => Promise<number>;
      getNeteaseApiStatus: () => Promise<ElectronNeteaseApiStatus>;
      /** 内嵌后端（网易、QQ）的诊断快照；没有内嵌后端的 provider 回 null。 */
      getLoginDiagnostics?: (providerId: string) => Promise<ElectronLoginDiagnostics | null>;
      /** 扫码登录失败后的主动自检（electron/loginSelfCheck.cjs）。 */
      runLoginSelfCheck?: (providerId: string) => Promise<import('./types/onlineMusic').LoginSelfCheckResult | null>;
      // 'needed'：一个请求要用它，它却因为断网没起来；主进程只在离上一次断网失败够久时才再启动。
      restartNeteaseApi: (reason?: 'needed') => Promise<ElectronNeteaseApiStatus>;
      onNeteaseApiStatusChanged: (callback: (status: ElectronNeteaseApiStatus) => void) => () => void;
      getKugouApiStatus: () => Promise<ElectronKugouApiStatus>;
      qishuiRequest: (
        operation: import('./services/onlineMusic/qishui/qishuiTransport').QishuiOperation,
        params?: import('./services/onlineMusic/qishui/qishuiTransport').QishuiParams,
      ) => Promise<import('./services/onlineMusic/qishui/qishuiTransport').QishuiBridgeResult>;
      bodianRequest: (
        operation: import('./services/onlineMusic/bodian/bodianTransport').BodianOperation,
        params?: import('./services/onlineMusic/bodian/bodianTransport').BodianParams,
      ) => Promise<import('./services/onlineMusic/bodian/bodianTransport').BodianBridgeResult>;
      ytmRequest: (
        operation: import('./services/onlineMusic/ytm/ytmTransport').YtmOperation,
        params?: import('./services/onlineMusic/ytm/ytmTransport').YtmParams,
      ) => Promise<import('./services/onlineMusic/ytm/ytmTransport').YtmBridgeResult>;
      spotifyRequest: (
        operation: import('./services/onlineMusic/spotify/spotifyTransport').SpotifyOperation,
        params?: import('./services/onlineMusic/spotify/spotifyTransport').SpotifyParams,
      ) => Promise<import('./services/onlineMusic/spotify/spotifyTransport').SpotifyBridgeResult>;
      kugouRequest: (
        operation: ElectronKugouOperation,
        params?: Record<string, string | number | boolean | undefined>,
      ) => Promise<unknown>;
      getQqPort: () => Promise<number | null>;
      getQqApiStatus: () => Promise<ElectronQqApiStatus>;
      onQqApiStatusChanged: (callback: (status: ElectronQqApiStatus) => void) => () => void;
      minimizeWindow: () => Promise<boolean>;
      toggleMaximizeWindow: () => Promise<boolean>;
      toggleFullscreenWindow: () => Promise<boolean>;
      closeWindow: () => Promise<boolean>;
      quitApp: () => Promise<boolean>;
      isWindowMaximized: () => Promise<boolean>;
      isWindowFullscreen: () => Promise<boolean>;
      onWindowFullscreenChanged: (callback: (fullscreen: boolean) => void) => () => void;
      getWindowTransparentMode: () => Promise<boolean>;
      setWindowTransparentMode: (
        enabled: boolean,
        handoff?: import('./types/appPlayback').WindowPlaybackHandoff | null,
      ) => Promise<boolean>;
      consumeWindowPlaybackHandoff: () => Promise<import('./types/appPlayback').WindowPlaybackHandoff | null>;
      submitWindowPlaybackHandoff: (
        requestId: string,
        handoff: import('./types/appPlayback').WindowPlaybackHandoff | null,
      ) => Promise<boolean>;
      onWindowPlaybackHandoffRequested: (
        callback: (payload: { requestId: string }) => void,
      ) => () => void;
      setNativeTheme: (themeSource: 'system' | 'light' | 'dark') => Promise<void>;
      getMainWindowClickThroughEnabled: () => Promise<boolean>;
      setMainWindowClickThroughEnabled: (enabled: boolean) => Promise<boolean>;
      setMainWindowClickThroughUnlockHover: (active: boolean) => Promise<boolean>;
      getMainWindowAlwaysOnTop: () => Promise<boolean>;
      setMainWindowAlwaysOnTop: (enabled: boolean) => Promise<boolean>;
      onMainWindowClickThroughChanged: (callback: (state: ElectronMainWindowClickThroughState) => void) => () => void;
      getObsBrowserSourceStatus: () => Promise<ElectronObsBrowserSourceStatus>;
      setObsBrowserSourceEnabled: (enabled: boolean) => Promise<ElectronObsBrowserSourceStatus>;
      regenerateObsBrowserSourceToken: () => Promise<ElectronObsBrowserSourceStatus>;
      publishObsBrowserSourceConfig: (config: ElectronObsBrowserSourceConfig) => Promise<boolean>;
      publishObsBrowserSourceClock: (clock: ElectronObsBrowserSourceClock) => Promise<boolean>;
      publishObsBrowserSourceAudio: (audio: ElectronObsBrowserSourceAudio) => Promise<boolean>;
      getLyricApiStatus: () => Promise<import('./types/lyricApi').LyricApiStatus>;
      setLyricApiEnabled: (enabled: boolean) => Promise<import('./types/lyricApi').LyricApiStatus>;
      publishLyricApiData: (lyrics: import('./types').LyricData | null, offset: number, clipStartMs?: number) => Promise<boolean>;
      onLyricApiStatusChanged: (callback: (status: import('./types/lyricApi').LyricApiStatus) => void) => () => void;
      getDiscordPresenceStatus: () => Promise<ElectronDiscordPresenceStatus>;
      publishDiscordPresenceSnapshot: (snapshot: ElectronDiscordPresenceSnapshot) => Promise<ElectronDiscordPresenceStatus>;
      getPlaybackSyncBridgeStatus: () => Promise<ElectronPlaybackSyncBridgeStatus>;
      getVoiceInputPauseStatus: () => Promise<ElectronVoiceInputPauseStatus>;
      onVoiceInputStateChanged: (callback: (state: ElectronVoiceInputPauseStatus) => void) => () => void;
      onPlaybackSyncBridgeStatusChanged: (callback: (status: ElectronPlaybackSyncBridgeStatus) => void) => () => void;
      onDiscordPresenceStatusChanged: (callback: (status: ElectronDiscordPresenceStatus) => void) => () => void;
      onObsBrowserSourceStatusChanged: (callback: (status: ElectronObsBrowserSourceStatus) => void) => () => void;
      /** Replaces the registered system-wide shortcuts. `portal` means the desktop binds the keys (native Wayland). */
      /** 'portal' on native Wayland, where the desktop binds the keys. */
      getGlobalShortcutBackend: () => Promise<'native' | 'portal'>;
      setGlobalShortcuts: (accelerators: string[]) => Promise<{ backend: 'native' | 'portal'; results: Array<{ accelerator: string; registered: boolean }> }>;
      onGlobalShortcut: (callback: (accelerator: string) => void) => () => void;
      updateTaskbarControls: (state: ElectronTaskbarControlState) => Promise<boolean>;
      onTaskbarControl: (callback: (action: ElectronTaskbarControlAction) => void) => () => void;
      openRemoteControl: () => Promise<boolean>;
      toggleRemoteControl: () => Promise<boolean>;
      closeRemoteControl: () => Promise<boolean>;
      getRemoteControlAlwaysOnTop: () => Promise<boolean>;
      setRemoteControlAlwaysOnTop: (alwaysOnTop: boolean) => Promise<boolean>;
      /** alwaysOnTopSupported is false on native Wayland, where setAlwaysOnTop is silently ignored. */
      getRemoteControlWindowSettings: () => Promise<{ hideTitlebar: boolean; clickThrough: boolean; expandCover?: boolean; textShade?: boolean; alwaysOnTopSupported?: boolean }>;
      onRemoteControlWindowSettingsChanged: (callback: (settings: { hideTitlebar: boolean; clickThrough: boolean; expandCover?: boolean; textShade?: boolean; alwaysOnTopSupported?: boolean }) => void) => () => void;
      /** Null when the main process cannot tell (a Wayland session): the page then uses its own mouse events. */
      getRemoteControlPointerInside: () => Promise<boolean | null>;
      onRemoteControlPointerInside: (callback: (inside: boolean) => void) => () => void;
      publishRemoteControlSnapshot: (snapshot: ElectronRemoteControlSnapshot) => Promise<boolean>;
      getRemoteControlSnapshot: () => Promise<ElectronRemoteControlSnapshot | null>;
      sendRemoteControlCommand: (command: ElectronRemoteControlCommand) => Promise<boolean>;
      onRemoteControlCommand: (callback: (command: ElectronRemoteControlCommand) => void) => () => void;
      onRemoteControlSnapshot: (callback: (snapshot: ElectronRemoteControlSnapshot) => void) => () => void;
      chooseVideoExportPath: (
        defaultName?: string,
        extension?: 'mp4' | 'webm',
        displayName?: string,
      ) => Promise<ElectronSaveDialogResult>;
      reportDevicePixelRatio: (ratio: number) => Promise<void>;
      // Returns `false` when the resize could not be prepared, otherwise the resolved DPR.
      prepareVideoExportWindow: (size: { width: number; height: number; dpr?: number }) => Promise<false | { success: boolean; dpr: number }>;
      restoreVideoExportWindow: () => Promise<boolean>;
      // Chunked export file writing: open returns a session id, chunks are appended in order,
      // finish renames the partial file onto the chosen path, abort deletes it.
      openVideoExportFile: (filePath: string) => Promise<string>;
      appendVideoExportChunk: (sessionId: string, data: ArrayBuffer) => Promise<number>;
      finishVideoExportFile: (sessionId: string) => Promise<{ filePath: string; bytesWritten: number; finalized: boolean }>;
      abortVideoExportFile: (sessionId: string) => Promise<boolean>;
      getControlStatus: () => Promise<ControlServerStatus>;
      setControlEnabled: (enabled: boolean) => Promise<ControlServerStatus>;
      regenerateControlToken: () => Promise<ControlServerStatus & { token: string }>;
      getStageStatus: () => Promise<StageStatus>;
      setStageEnabled: (enabled: boolean) => Promise<StageStatus>;
      regenerateStageToken: () => Promise<StageStatus>;
      clearStageState: () => Promise<StageStatus>;
      completeStageExternalPlayRequest: (result: StageExternalPlayResult) => Promise<boolean>;
      publishStagePlayerSnapshot: (snapshot: StagePlayerSnapshot, options?: { forcePlaybackEvent?: boolean }) => Promise<StagePlayerSnapshot>;
      completeStagePlayerControlRequest: (result: StagePlayerRequestResult) => Promise<boolean>;
      completeStagePlayerQueueRequest: (result: StagePlayerRequestResult) => Promise<boolean>;
      onStageSessionUpdated: (callback: (status: StageStatus) => void) => () => void;
      onStageSessionCleared: (callback: (status: StageStatus) => void) => () => void;
      onStageExternalPlayRequest: (callback: (request: StageExternalPlayRequest) => void) => () => void;
      onStagePlayerControlRequest: (callback: (request: StagePlayerControlRequest) => void) => () => void;
      onStagePlayerQueueRequest: (callback: (request: StagePlayerQueueRequest) => void) => () => void;
      mods?: {
        listMods: () => Promise<{ mods: ModRuntimeInfo[]; ffmpeg: ModFfmpegStatus; directories: string[]; startSkipped?: boolean }>;
        setModEnabled: (modId: string, enabled: boolean) => Promise<{ ok: boolean; error?: string; mods: ModRuntimeInfo[] }>;
        reloadMods: () => Promise<{ mods: ModRuntimeInfo[] }>;
        cancelExport: () => Promise<{ ok: boolean }>;
        invokeModRpc: (modId: string, name: string, args: unknown[]) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
        invokeModStorage: (modId: string, operation: string, key?: string, value?: unknown) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
        invokeModSecrets: (modId: string, operation: string, key?: unknown, value?: unknown) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
        invokeModNetFetch: (modId: string, url: string, init: unknown) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
        invokeModPickFile: (modId: string, accept: string, persist?: boolean) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
        invokeModRestoreFile: (modId: string, grantId: string) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
        invokeModReleaseFile: (modId: string, grantId: string) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
        pushRuntimeSnapshot: (snapshot: ModRuntimeSnapshot) => Promise<{ ok: boolean }>;
        getFfmpegStatus: () => Promise<{ ffmpeg: ModFfmpegStatus }>;
        openModsDirectory: () => Promise<{ ok: boolean; directory?: string; error?: string }>;
        installModFromZip: (zipPath: string) => Promise<{ ok: boolean; id?: string; error?: string }>;
        getModStorageUsage: (modId: string) => Promise<ModStorageUsageResult>;
        clearModCache: (modId: string) => Promise<ModClearCacheResult>;
        getModCallStats: () => Promise<{ stats: Record<string, ModMainCallStats> }>;
        reportModsStartSettled: () => Promise<{ ok: boolean }>;
        reportModsStartAlive: () => Promise<{ ok: boolean }>;
        onModsStateChanged: (callback: (mods: ModRuntimeInfo[]) => void) => () => void;
        onExportProgress: (callback: (progress: ModExportProgress) => void) => () => void;
        onModLog: (callback: (entry: ModLogEntry) => void) => () => void;
        onModRpcMessage: (callback: (message: ModRpcMessage) => void) => () => void;
        onModSecretChanged: (callback: (change: ModSecretChange) => void) => () => void;
      };
      /** HiFi 原生直通后端（mpv 子进程）。只在桌面版存在。 */
      hifi?: {
        getRuntimeStatus: () => Promise<import('./types/hifi').HifiRuntimeStatus>;
        detectRuntime: () => Promise<import('./types/hifi').HifiRuntimeStatus>;
        /** 弹系统文件框选 mpv 可执行文件；取消时为 null。 */
        pickRuntimePath: () => Promise<string | null>;
        installRuntime: () => Promise<import('./types/hifi').HifiInstallResult>;
        cancelInstall: () => Promise<void>;
        configure: (config: import('./types/hifi').HifiEngineConfig) => Promise<void>;
        listDevices: () => Promise<import('./types/hifi').HifiDevice[]>;
        load: (request: import('./types/hifi').HifiLoadRequest) => Promise<import('./types/hifi').HifiLoadResult>;
        play: () => Promise<void>;
        pause: () => Promise<void>;
        seek: (positionSec: number) => Promise<void>;
        stop: () => Promise<void>;
        setLoopFile: (loop: boolean) => Promise<void>;
        preloadNext: (request: import('./types/hifi').HifiLoadRequest) => Promise<boolean>;
        clearNext: () => Promise<void>;
        getSnapshot: () => Promise<import('./types/hifi').HifiEngineState>;
        /** Linux：用 pw-dump 读 mpv 那路流在 PipeWire 里的去向；不是 PipeWire、没有 pw-dump、找不到流时为 null。 */
        probeOutput: () => Promise<import('./types/hifi').HifiOutputProbe | null>;
        respondRead: (readId: string, response: import('./types/hifi').HifiReadResponse) => Promise<void>;
        /** Linux：HiFi 在放时主进程登记的 MPRIS 的状态；active 为假时交还总线名。别的平台没有处理方。 */
        setMprisState?: (state: import('./types/hifi').HifiMprisState) => Promise<void>;
        setMprisArtwork?: (trackKey: string, artwork: import('./types/hifi').HifiMprisArtwork | null) => Promise<void>;
        onMprisCommand?: (callback: (command: import('./types/hifi').HifiMprisCommand) => void) => () => void;
        /** HiFi 在放时主进程登记 MPRIS 成没成（每次推送后报）；没成时页面退回静音保活。 */
        onMprisStatus?: (callback: (status: import('./types/hifi').HifiMprisStatus) => void) => () => void;
        onState: (callback: (state: import('./types/hifi').HifiEngineState) => void) => () => void;
        onClock: (callback: (update: import('./types/hifi').HifiClockUpdate) => void) => () => void;
        onError: (callback: (event: import('./types/hifi').HifiErrorEvent) => void) => () => void;
        onInstallProgress: (callback: (progress: import('./types/hifi').HifiInstallProgress) => void) => () => void;
        onReadRequest: (callback: (request: import('./types/hifi').HifiReadRequest) => void) => () => void;
      };
    };
  }
}

export {};
