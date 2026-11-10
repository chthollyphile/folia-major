import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motionValue } from 'framer-motion';
import i18n from '../../src/i18n/config';
import AppDialogs from '../../src/components/app/dialogs/AppDialogs';
import ModsPage from '../../src/components/modal/settings/pages/ModsPage';
import { SettingsKitThemeContext, settingsTokens } from '../../src/components/modal/settings/kit/kitTheme';
import { kitMotionTokens } from '../../src/components/modal/settings/kit/motion';
import { SettingsAnchorProvider, useSettingsAnchorStore } from '../../src/components/modal/settings/navigation/SettingsAnchorContext';
import { DAYLIGHT_THEME, DEFAULT_THEME } from '../../src/services/baseThemes';
import { useDesktopSettingsStore } from '../../src/stores/useDesktopSettingsStore';
import { useStatusMessage } from '../../src/stores/useStatusMessageStore';
import type { FoliumStageContext } from '../../src/mods/folium/contract';
import { FoliumMountHost } from '../../src/mods/runtime/FoliumMountHost';
import type { FoliumHostContext } from '../../src/mods/folium/helpers';
import { installFoliumFaultNotice } from '../../src/mods/runtime/faultNotice';
import { commandsRegistry, runFoliumCommand } from '../../src/mods/folium/registries/commands';
import { FoliumProgressButtons, useFoliumProgressContext } from '../../src/mods/folium/registries/progress';
import { visualizersRegistry } from '../../src/mods/folium/registries/visualizers';
import { foliumMountName } from '../../src/mods/folium/kinds';
import { getFoliumIssues, setFoliumFaultNoticeMuted } from '../../src/mods/runtime/status';
import type { ModRuntimeInfo } from '../../src/mods/types';
import { useModsStore } from '../../src/mods/useModsStore';
import type { ProbeDefinition } from './definition';
// dev/probes/modFaultNotice.probe.tsx

/**
 * 模组出错时用的人看到的两处：应用顶上的那条提示，和「设置 → 模组」里这个模组那一行。
 *
 * 都是真的：主进程桥换成这里的假桥，列出两个模组；出错的那个的界面代码是下面这段文字，经真的加载器启动，
 * 它的歌词样式一挂载就抛错、进度条旁的按钮每次时间变化都抛错、命令执行失败、自己还记了一条 log.error。
 * 提示是真的 AppDialogs 画的，那一行是真的 ModsPage 画的。
 *
 * 地址上的参数：view=notice | row（看提示还是看那一行），theme=dark | light，lang=zh-CN | en | in，
 * piece=visualizer | button | start（先出错的是哪一种条目，决定提示上的那句话），muted=1（先替这个模组选好「不再提示」）。
 *
 * 那一行上的开销（启动用了多久、运行时每帧多少、出错几次、「慢」的标记）也看这里：
 * slow=1 让第二个模组真的慢（启动等 1.6 秒，每次时间变化空转 12 毫秒，时钟连着走 3 秒），主进程那一半的数是假桥给的；
 * open=<模组 id> 指定展开哪一行；skipped=1 是「这次不带模组启动」时的样子（假桥报每个模组这次没有启动）。
 */
const FAILING_CLIENT = `
export default function activate(folium) {
    if (globalThis.__probeModFailsAtStart) throw new Error('settings.json: unexpected token');
    folium.registries.visualizers.register({
        id: 'text',
        label: { 'zh-CN': '虹光', en: 'Aurora' },
        mount: () => { throw new Error("Cannot read properties of undefined (reading 'glow')"); },
    });
    folium.registries.progressButtons.register({
        id: 'like',
        slot: 'progress.trailing',
        mount: (container, ctx) => {
            ctx.onPlaybackTime(() => { throw new Error('heart is not defined'); });
        },
    });
    folium.registries.commands.register({
        id: 'export',
        label: { 'zh-CN': '导出', en: 'Export' },
        run: () => { throw new Error('ffmpeg exited with code 1'); },
    });
    folium.log.error('could not reach the lyrics server');
}
`;

const modInfo = (id: string, name: string, clientUrl: string | null): ModRuntimeInfo => ({
    id,
    name,
    version: '1.2.0',
    author: 'Probe',
    description: null,
    permissions: [],
    status: 'loaded',
    error: null,
    enabled: true,
    trustStale: false,
    signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null },
    devSource: false,
    experimental: [],
    embedOrigins: [],
    folia: null,
    hasMain: false,
    clientUrl,
});

/* A client that really is slow: its start waits 1.6 s, and its listener keeps the thread for 12 ms each time. */
const SLOW_CLIENT = `
export default async function activate(folium) {
    folium.registries.progressButtons.register({
        id: 'clock',
        slot: 'progress.trailing',
        mount: (container, ctx) => {
            ctx.onPlaybackTime(() => {
                const until = performance.now() + 12;
                while (performance.now() < until) { /* busy */ }
            });
        },
    });
    await new Promise((resolve) => setTimeout(resolve, 1600));
}
`;

const FAILING_ID = 'probe-aurora';
const QUIET_ID = 'probe-quiet';
const dataUrl = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
const listedMods = (slow: boolean, skipped: boolean): ModRuntimeInfo[] => [
    modInfo(FAILING_ID, '虹光歌词', dataUrl(FAILING_CLIENT)),
    modInfo(QUIET_ID, 'Quiet Clock', slow ? dataUrl(SLOW_CLIENT) : null),
].map((mod) => (skipped ? { ...mod, status: 'skipped', clientUrl: null } : mod));
/* What the main-process gate would have counted for the two Node entries. */
const MAIN_STATS = {
    [FAILING_ID]: { calls: 2, totalMs: 3.2, longestMs: 2.1, failures: 0 },
    [QUIET_ID]: { calls: 6, totalMs: 212.4, longestMs: 180.2, failures: 0 },
};

const clock = motionValue(0);
// One object for every render: a new context identity would mount the lyric style again.
const NO_STAGE = {} as FoliumHostContext<FoliumStageContext>;
const BAR_COLORS = { fill: '#fff', track: '#555', text: '#fff' };

/* The mod's progress-bar button, on a real progress context. */
const ButtonBar: React.FC = () => {
    const ctx = useFoliumProgressContext({ currentTime: clock, duration: 200, onSeek: () => {}, colors: BAR_COLORS });
    return <FoliumProgressButtons slot="progress.trailing" ctx={ctx} />;
};

const ModFaultNoticeProbe: React.FC = () => {
    const params = useMemo(() => new URLSearchParams(window.location.search), []);
    const view = params.get('view') === 'row' ? 'row' : 'notice';
    const piece = params.get('piece') ?? 'visualizer';
    const slow = params.get('slow') === '1';
    const skipped = params.get('skipped') === '1';
    const isDaylight = params.get('theme') === 'light';
    const theme = isDaylight ? DAYLIGHT_THEME : DEFAULT_THEME;
    const kitTheme = useMemo(() => ({ isDaylight, theme }), [isDaylight, theme]);
    const anchorStore = useSettingsAnchorStore();
    const message = useStatusMessage();
    // booting → the mod's client has started → its pieces are on the page and have failed.
    const [stage, setStage] = useState<'booting' | 'started' | 'failed'>('booting');

    useEffect(() => {
        let cancelled = false;
        const boot = async () => {
            await i18n.changeLanguage(params.get('lang') ?? 'zh-CN');
            setFoliumFaultNoticeMuted(FAILING_ID, params.get('muted') === '1');
            (globalThis as { __probeModFailsAtStart?: boolean }).__probeModFailsAtStart = piece === 'start';
            (window as unknown as { electron: unknown }).electron = {
                mods: {
                    listMods: async () => ({
                        mods: listedMods(slow, skipped),
                        ffmpeg: { available: true, path: 'ffmpeg', version: '8.1.2', candidates: [] },
                        directories: ['C:/Users/probe/AppData/Roaming/Folia/mods'],
                        startSkipped: skipped,
                    }),
                    getModCallStats: async () => ({ stats: slow ? MAIN_STATS : {} }),
                    getFfmpegStatus: async () => ({ ffmpeg: { available: true, path: 'ffmpeg', version: '8.1.2', candidates: [] } }),
                    onModsStateChanged: () => () => {},
                    onExportProgress: () => () => {},
                    onModLog: () => () => {},
                },
            };
            useModsStore.setState({ bridgeAvailable: true });
            useDesktopSettingsStore.setState({ modSystemEnabled: true });
            installFoliumFaultNotice();
            // The store hands the list to the real loader, which starts the client.
            await useModsStore.getState().refresh();
            // Started: its lyric style is registered, or (piece=start) its start has failed.
            // In a run without mods nothing starts, so there is nothing to wait for.
            const started = () => skipped || Boolean(visualizersRegistry.get(`${FAILING_ID}:text`)) || getFoliumIssues(FAILING_ID).length > 0;
            for (let tries = 0; tries < 100 && !started(); tries += 1) {
                await new Promise((resolve) => { setTimeout(resolve, 20); });
            }
            if (cancelled) return;
            useModsStore.getState().selectMod(params.get('open') ?? FAILING_ID);
            setStage('started');
        };
        void boot();
        return () => { cancelled = true; };
    }, [params, piece, slow, skipped]);

    // Once its pieces are mounted: the clock moves (the button fails each time) and the command is run.
    // Once only: StrictMode runs an effect twice.
    const drivenRef = useRef(false);
    useEffect(() => {
        if (stage !== 'started') return;
        // StrictMode's second run while the first is still moving the clock: that one ends the stage.
        if (slow && drivenRef.current) return;
        if (piece !== 'start' && !skipped && !drivenRef.current) {
            drivenRef.current = true;
            for (let tick = 1; tick <= 37; tick += 1) clock.set(tick);
            const command = commandsRegistry.get(`${FAILING_ID}:export`);
            if (command) void runFoliumCommand(command, {});
            if (slow) {
                // The clock keeps moving for three seconds, as while a song plays: the cost while
                // running is counted over the seconds in which the listeners ran.
                let tick = 37;
                const timer = setInterval(() => {
                    tick += 1;
                    clock.set(tick);
                }, 16);
                setTimeout(() => {
                    clearInterval(timer);
                    setStage('failed');
                }, 3000);
                return;
            }
        }
        setStage('failed');
    }, [stage, piece, slow, skipped]);

    const visualizer = stage === 'booting' ? null : visualizersRegistry.get(`${FAILING_ID}:text`);
    const pieces = stage === 'booting' ? null : (
        <div className="pointer-events-none absolute left-0 top-0 h-10 w-40 opacity-0">
            {visualizer && piece !== 'button' ? (
                <FoliumMountHost<FoliumStageContext>
                    modId={FAILING_ID}
                    where={`visualizer ${visualizer.id}`}
                    entryKind={foliumMountName('visualizers', 'visualizer')}
                    entryId={visualizer.id}
                    mount={visualizer.def.def.mount}
                    ctx={NO_STAGE}
                />
            ) : null}
            <ButtonBar />
        </div>
    );

    return (
        <div
            className={`relative min-h-screen p-6 ${isDaylight ? 'bg-zinc-200' : 'bg-zinc-950'}`}
            style={{ '--text-primary': theme.primaryColor, '--text-secondary': theme.secondaryColor } as React.CSSProperties}
            data-probe-mod-fault={stage}
        >
            {pieces}
            <AppDialogs
                model={{
                    statusToast: message
                        ? { ...message, isDaylight, toastKey: `${message.type}:${message.text}:${message.nonce ?? 0}` }
                        : null,
                }}
            />
            {view === 'row' && stage !== 'booting' ? (
                <div
                    data-probe-window
                    className="st-window mx-auto mt-20 rounded-2xl bg-[var(--st-win)] px-4 pb-6 pt-4 text-[color:var(--st-t1)]"
                    style={{ ...settingsTokens(isDaylight, theme), ...kitMotionTokens(false), width: 760, maxWidth: '100%' }}
                >
                    <SettingsKitThemeContext.Provider value={kitTheme}>
                        <SettingsAnchorProvider store={anchorStore} section="mods">
                            <ModsPage />
                        </SettingsAnchorProvider>
                    </SettingsKitThemeContext.Provider>
                </div>
            ) : null}
        </div>
    );
};

const probe: ProbeDefinition = {
    id: 'modFaultNotice',
    title: '模组出错：提示和设置里那一行',
    description: '一个界面代码会抛错的假模组经真的加载器启动：顶上是出错提示（两个按钮），view=row 时是「设置 → 模组」里它那一行（出错的地方、次数、开关、开销）；slow=1 加一个真的慢的模组（「慢」的标记），skipped=1 是这次不带模组启动时的样子。',
    Component: ModFaultNoticeProbe,
};

export default probe;
