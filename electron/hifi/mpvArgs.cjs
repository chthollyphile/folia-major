'use strict';

// mpv 的启动参数和 loadfile 命令（纯函数）：只开音频、不读用户配置、不做任何处理，源只经 IPC 下发，不上命令行。

const MAX_AUDIO_DEVICE_CHARS = 512;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
// mpv 列出的设备名只用到这些字符：WASAPI 的 {…} id、PipeWire / PulseAudio 的节点名、Core Audio 的 UID（聚合设备的带 ~）、
// ALSA 的 PCM 名。引号、|、$、;、反引号一律不收。
const AUDIO_DEVICE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._:=,/+{}~-]*$/;
// ALSA 的设备：mpv 原样交给 snd_pcm_open。这里只收插件名加 CARD=…,DEV=… 这样的参数：不收路径、空格和花括号（花括号能在参数里写一段配置）。
const ALSA_DEVICE_PATTERN = /^alsa(\/[A-Za-z0-9._:=,+-]*)?$/i;
// 会写文件、跑命令或加载代码的 ALSA 插件：file / tee 把声音写进文件，文件名以 | 开头时交给 shell 执行；其余几个连外部程序或库。
const ALSA_UNSAFE_PLUGIN = /(^|[/:,=])(file|tee|pipe|shm|ladspa|hooks|meter|exec|shell)(?=$|[:,=])/i;
const AO_OVERRIDE_PATTERN = /^[a-z0-9_,-]+$/i;
const PIPE_HEX_PATTERN = /^[0-9a-f]+$/i;
const LOADFILE_MODES = new Set(['replace', 'append']);
/**
 * mpv 交给系统音频服务的客户端名：PipeWire 的输出把它写进流节点的 node.name 和 application.name，
 * pipewireProbe.cjs 靠它在 pw-dump 里认出这路流（PulseAudio 输出写进 application.name）。
 */
const AUDIO_CLIENT_NAME = 'Folia HiFi';

// 顺序固定：先关掉一切会碰声音或界面的东西，再是位精确要的那几项。不设 --audio-samplerate / --audio-format，
// 让 mpv 按源的格式开输出。
const BASE_ARGS = Object.freeze([
    '--idle=yes',
    '--no-config',
    '--no-video',
    '--audio-display=no',
    '--load-scripts=no',
    '--ytdl=no',
    '--osc=no',
    '--input-default-bindings=no',
    '--input-terminal=no',
    '--input-media-keys=no',
    '--media-controls=no',
    '--terminal=no',
    '--msg-level=all=warn',
    '--keep-open=yes',
    '--gapless-audio=weak',
    '--prefetch-playlist=yes',
    '--replaygain=no',
    '--af=',
    '--audio-pitch-correction=no',
    '--audio-normalize-downmix=no',
    '--audio-channels=auto',
    '--volume=100',
    '--volume-max=100',
    '--audio-fallback-to-null=no',
    `--audio-client-name=${AUDIO_CLIENT_NAME}`,
]);

/**
 * 设置里存的设备名；空、不是字符串、过长、带控制字符或 mpv 列出的设备名里不会有的字符时回落到 'auto'。
 * ALSA 设备再挡掉会写文件或跑命令的插件（alsa/file:|… 会被 ALSA 当成命令执行）。这只是第一道：
 * 会话只把这个 mpv 自己列出的设备交给它（见 mpvSession.cjs 的 resolveDevice）。
 */
const sanitizeAudioDevice = value => {
    if (typeof value !== 'string') return 'auto';
    if (value.trim() === '' || value.length > MAX_AUDIO_DEVICE_CHARS || CONTROL_CHARS.test(value)) return 'auto';
    if (!AUDIO_DEVICE_PATTERN.test(value)) return 'auto';
    if (/^alsa(\/|$)/i.test(value) && (!ALSA_DEVICE_PATTERN.test(value) || ALSA_UNSAFE_PLUGIN.test(value.slice(5)))) return 'auto';
    return value;
};

/**
 * 实际交给 mpv 的独占开关。Linux 上总是关：ALSA 的 hw: 设备不论开关都直连，PipeWire / PulseAudio 是混音器，
 * 开着独占只会把 mpv 的流节点标成独占，声卡上已经连着别的流时 mpv 的流连不上，它丢帧快进到结尾，像是放完了。
 */
const effectiveExclusive = (platform, exclusive) => exclusive === true && platform !== 'linux';

/** Windows 上 mpv 的 IPC 命名管道，hex 是随机串。 */
const buildPipeName = hex => {
    if (typeof hex !== 'string' || !PIPE_HEX_PATTERN.test(hex)) {
        throw new TypeError('HiFi pipe name needs a hex string');
    }
    return `\\\\.\\pipe\\folia-hifi-${hex}`;
};

const buildIpcArg = (platform, ipc) => {
    if (ipc?.kind === 'fd') {
        // fd://3 要 spawn 时把 stdio[3] 开成 socketpair，Windows 上没有这条路。
        if (platform === 'win32') throw new TypeError('HiFi fd IPC is not available on Windows');
        return '--input-ipc-client=fd://3';
    }
    if (ipc?.kind === 'pipe') {
        if (typeof ipc.path !== 'string' || ipc.path === '' || CONTROL_CHARS.test(ipc.path)) {
            throw new TypeError('HiFi pipe IPC needs a path');
        }
        return `--input-ipc-server=${ipc.path}`;
    }
    throw new TypeError('HiFi IPC kind must be fd or pipe');
};

/**
 * 启动参数；ao 只给测试用（'null'、'pcm'），正式路径不传。设备总是 auto：设置里的设备等 IPC 连上、核对过 mpv 的设备表
 * 才用 set_property 换过去，渲染端给的名字不上命令行。
 */
const buildMpvArgs = ({ platform, ipc, exclusive, dsdMode, ao } = {}) => {
    const args = [
        ...BASE_ARGS,
        '--audio-device=auto',
        `--audio-exclusive=${effectiveExclusive(platform, exclusive) ? 'yes' : 'no'}`,
    ];
    if (dsdMode === 'dop') args.push('--audio-spdif=dsd');
    args.push(buildIpcArg(platform, ipc));
    if (ao !== undefined && ao !== null && ao !== '') {
        if (typeof ao !== 'string' || !AO_OVERRIDE_PATTERN.test(ao)) throw new TypeError('HiFi ao override is invalid');
        args.push(`--ao=${ao}`);
    }
    return args;
};

// 起播位置写成最多三位小数的秒数，不出现指数写法。
const formatStartSec = startSec => String(Number(startSec.toFixed(3)));

/** loadfile 命令数组；startSec 大于 0 时带上 index -1 和 start= 选项（mpv 0.38 起的四参写法）。 */
const buildLoadfileCommand = (url, mode, { startSec = 0 } = {}) => {
    if (typeof url !== 'string' || url === '') throw new TypeError('HiFi loadfile needs a url');
    if (!LOADFILE_MODES.has(mode)) throw new TypeError('HiFi loadfile mode must be replace or append');
    const command = ['loadfile', url, mode];
    if (typeof startSec === 'number' && Number.isFinite(startSec) && startSec > 0) {
        command.push(-1, `start=${formatStartSec(startSec)}`);
    }
    return command;
};

module.exports = {
    AUDIO_CLIENT_NAME,
    buildMpvArgs,
    sanitizeAudioDevice,
    effectiveExclusive,
    buildPipeName,
    buildLoadfileCommand,
};
