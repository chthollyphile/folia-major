import React, { useState } from 'react';
import AutomixModelsSection from '../../src/components/modal/settings/AutomixModelsSection';
import manifest from '../../shared/modelManifest.json';
import type { ProbeDefinition } from './definition';
// dev/probes/automixModels.probe.tsx

/**
 * 设置页的模型区块。这块只在 window.electron 存在时渲染，浏览器预览本来看不到，
 * 所以这里把它需要的那几个 IPC 假装出来。
 *
 * 主要要看的是「所有线路都失败」之后才出现的网盘那一排：两个网盘各自带自己的提取码，
 * 而提取码是四个区分大小写的字符（qWGi），照着屏幕手打是个真会出错的事，所以它是个
 * 按钮而不是一段文字。失败态是默认展开的——正常态下这一排根本不出现，而它不出现的
 * 时候是看不出它长得对不对的。
 */
const MANUAL = manifest.manual as { links: Array<{ label: string; url: string; code?: string }>; note: string };

/**
 * The rows are ENUMERATED here, not folded out of the manifest the way modelStore does it.
 *
 * A probe's job is to name the visual states, and the third row has one the real resolver can only
 * produce on hardware this machine is not: an Intel Mac, where the runtime has no build and the row
 * has to say so instead of offering a download. Re-deriving it here would mean the only way to look
 * at that state is to own the machine that cannot use the feature.
 */
type Row = ElectronAutomixModelStatus['models'][number];

const buildStatus = (installed: boolean, runtimeSupported: boolean) => {
    const [beatThis, htdemucs, runtime] = manifest.models;
    // Both stems rows go dark together, the way downloadables makes them: htdemucs.onnx resolves on
    // any platform, but 109MB of weights with no runtime to run them is not a download worth
    // offering. A probe showing one supported and the other not would be showing a state the app
    // cannot produce, which is worse than not showing the state at all.
    const model = (entry: typeof beatThis): Row => {
        const supported = runtimeSupported || entry.enables !== 'stems';
        return {
            name: entry.name,
            file: entry.file ?? null,
            bytes: supported ? entry.bytes ?? 0 : 0,
            enables: entry.enables as 'beatGrid' | 'stems',
            license: entry.license,
            supported,
            path: supported && installed ? `E:\\models\\${entry.file}` : null,
            downloading: false,
        };
    };
    // The one this machine would get. Any of the three would do - what is being drawn is the row.
    const build = runtime.platforms?.['win32-x64'];
    return {
        manual: MANUAL,
        downloadDir: String.raw`C:\Users\somebody\AppData\Roaming\Folia\models`,
        models: [model(beatThis), model(htdemucs), {
            name: runtime.name,
            file: runtimeSupported ? build?.file ?? null : null,
            bytes: runtimeSupported ? build?.bytes ?? 0 : 0,
            enables: runtime.enables as 'stems',
            license: runtime.license,
            supported: runtimeSupported,
            // Unpacks to a directory, so an installed runtime shows a folder and not a file.
            path: runtimeSupported && installed ? String.raw`E:\models\runtime` : null,
            downloading: false,
        } satisfies Row],
    };
};

const AutomixModelsProbe: React.FC = () => {
    const [installed, setInstalled] = useState(false);
    const installedRef = React.useRef(installed);
    installedRef.current = installed;
    const [failed, setFailed] = useState(true);
    const [runtimeSupported, setRuntimeSupported] = useState(true);
    const [nonce, setNonce] = useState(0);
    const supportedRef = React.useRef(runtimeSupported);
    supportedRef.current = runtimeSupported;

    // Installed as a side effect on purpose: the component asks on mount, so the stub has to be in
    // place before it renders, and remounting (via `key`) is what re-asks it.
    (window as unknown as { electron: Record<string, unknown> }).electron = {
        getAutomixModelStatus: async () => buildStatus(installedRef.current, supportedRef.current),
        getAutomixModelsPresent: async () => ({
            beat_this: installedRef.current,
            // Weights AND runtime, the same conjunction modelsPresent makes - so a machine with no
            // runtime build reports no stems however many .onnx files it has.
            htdemucs: installedRef.current && supportedRef.current,
        }),
        downloadAutomixModel: async () => ({
            ok: false,
            skipped: failed
                ? ['hf-mirror.com: 无响应（45 秒）', 'huggingface.co: 连接被重置', 'github.com: 404']
                : [],
        }),
        onAutomixModelProgress: () => () => {},
        scanForAutomixModels: async () => ({ found: [] }),
        // The real bridge hands the url to the OS browser (preload -> 'open-external-url').
        // A stub that only logged made the netdisk buttons look broken in here.
        // No remount here, unlike the toggles above: the component sets its result message and
        // then refreshes, and a remount would wipe the message before anyone could read it.
        // `installedRef` is what the next getAutomixModelStatus reads, so the refresh that
        // follows sees the deletion even though this render's closure predates it.
        removeAllAutomixModels: async () => {
            installedRef.current = false;
            setInstalled(false);
            return {
                ok: true,
                removed: manifest.models.map(m => m.name),
                // The real store sums stat().size, so the stub sums the manifest rather
                // than inventing a round number - otherwise the confirm dialog and the
                // result line disagree here and agree in the app, which is backwards.
                freed: manifest.models.reduce((sum, m) => sum + (m.bytes ?? 0), 0),
                failed: [],
            };
        },
        openExternalUrl: (url: string) => {
            console.log('[Probe] opening', url);
            window.open(url, '_blank', 'noopener');
            return Promise.resolve(true);
        },
    };

    return (
        <div className="flex flex-col gap-6 p-8">
            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    data-probe-action="toggle-installed"
                    className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/10"
                    onClick={() => { setInstalled(value => !value); setNonce(n => n + 1); }}
                >
                    {installed ? '已安装 → 未安装' : '未安装 → 已安装'}
                </button>
                <button
                    type="button"
                    data-probe-action="toggle-failed"
                    className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/10"
                    onClick={() => { setFailed(value => !value); setNonce(n => n + 1); }}
                >
                    {failed ? '下载失败态（网盘可见）' : '正常态（网盘隐藏）'}
                </button>
                <button
                    type="button"
                    data-probe-action="toggle-runtime-supported"
                    className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/10"
                    onClick={() => { setRuntimeSupported(value => !value); setNonce(n => n + 1); }}
                >
                    {runtimeSupported ? '运行时可用 → 设备不支持' : '设备不支持 → 运行时可用'}
                </button>
            </div>
            {[false, true].map(isDaylight => (
                <div
                    key={`${String(isDaylight)}-${nonce}`}
                    data-probe-daylight={String(isDaylight)}
                    className={isDaylight ? 'rounded-2xl bg-zinc-200 p-4' : 'rounded-2xl bg-zinc-900 p-4'}
                    style={{
                        ['--text-primary' as string]: isDaylight ? '#18181b' : '#fafafa',
                        ['--text-secondary' as string]: isDaylight ? '#3f3f46' : '#d4d4d8',
                    }}
                >
                    <AutomixModelsSection isDaylight={isDaylight} />
                </div>
            ))}
        </div>
    );
};

const definition: ProbeDefinition = {
    id: 'automixModels',
    title: '分析模型区块',
    description: '模型下载区块：镜像失败后的两个网盘入口、各自的提取码按钮、已装/未装两态，以及运行时那一行在设备不支持时的样子。',
    Component: AutomixModelsProbe,
};

export default definition;
