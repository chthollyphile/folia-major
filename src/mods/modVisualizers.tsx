import React, { useCallback, useEffect, useRef } from 'react';
import { appendVisualizerEntry, removeVisualizerEntry } from '@/components/visualizer/registry';
import type { VisualizerRegistryEntry, VisualizerSharedProps } from '@/components/visualizer/definition';
import type { VisualizerMode } from '@/types';
import type { Line, Theme } from '@/types';
import type { ModRuntimeInfo, ModVisualizerContribution } from './types';
import { listMods } from './ipc';
import { isModsBridgeAvailable } from './ipc';
import VisualizerShell from '@/components/visualizer/VisualizerShell';
import VisualizerSubtitleOverlay from '@/components/visualizer/VisualizerSubtitleOverlay';
import { resolveSubtitleFontSizes } from '@/components/visualizer/subtitleFontSizes';
import { useVisualizerRuntime } from '@/components/visualizer/runtime';
import { getLineRenderEndTime } from '@/utils/lyrics/renderHints';
import type { VisualizerBackgroundConfig } from '@/components/visualizer/backgrounds/definition';
import { useModVisualizerModulation } from './visualizerModulation';
import { useModVisualizerSettings } from './modVisualizerSettings';
import { createModVisualizerSettingsPanel } from './ModVisualizerSettingsPanel';

// src/mods/modVisualizers.tsx
// Bridges mod-declared visualizer contributions into the live visualizer
// registry. A contribution is a browser ESM module served over the
// whitelisted folia-mod:// protocol with an imperative `mount(el, props)`
// contract; this module adapts it into the React VisualizerRegistryEntry
// shape so mod modes work everywhere a builtin mode works: player, preview,
// ThemePark, and the transparent video export page.

export interface ModVisualizerMountProps {
    lines: Line[];
    currentLineIndex: number;
    currentTime: { get(): number; on(event: 'change', cb: (v: number) => void): () => void };
    theme: Theme | null;
    songTitle: string | null;
    songArtist: string | null;
    staticMode: boolean;
    paused: boolean;
    /**
     * Live renderer-side modulation for this mode (see the `modulate` channel in
     * mods/README.md). Deliberately a getter rather than a snapshot: a mod that
     * caches the object would freeze at whatever the knobs were when it mounted.
     */
    getModulation?: () => Record<string, number>;
    /**
     * 主题。**必须**用 getter 读：主题对象在用户换肤/切昼夜时才会换引用，若把它放进
     * mount 的依赖里，贡献层会跟着重挂（DOM 与动画整段重建）。`theme` 那份快照保留
     * 只为兼容不读 getter 的旧贡献层。
     */
    getTheme?: () => Theme | null;
    /** 宿主当前渲染的「背景类型」配置（整份，同 `background` 快照，只是会更新）。 */
    getBackground?: () => VisualizerBackgroundConfig | undefined;
    /*
     * 只给「贡献层真的会读」的量开 getter：行号与暂停看起来也该走这条路，但贡献层的
     * 行号由 `currentTime` 推导（静态预览则由宿主按行重挂），暂停时 MotionValue 本来
     * 就不推进——再加两条没人消费的通道只会让契约更难维护。
     */
    /**
     * Persisted per-mode settings declared by visualizers[].settings in the
     * manifest. Same getter contract as getModulation: read every frame.
     *
     * Only mods that declare a schema get real values here: the host renders
     * that schema as a panel (see `renderSettingsPanel`) and its edits land in
     * `modVisualizerSettings`. A mod that ships its own panel declares no
     * schema, so this channel stays empty for it and its values live in the
     * mod's own storage.
     */
    getSettings?: () => Record<string, unknown>;
    /**
     * True while the host renders onto a transparent surface: the player page is
     * transparent (see `useVisualizerRendererModel`), the OBS browser source is
     * transparent, and the mod export window runs with no background at all.
     * Contributions that paint their own full-stage surface must skip it here,
     * otherwise the exported/opaque-free frames come out as a solid rectangle.
     */
    transparentSurface?: boolean;
    /**
     * The "背景类型" config the host is already rendering behind this
     * contribution — the same object builtin modes read as `props.background`
     * (the shell mounts `VisualizerBackgroundRenderer` under the mod too, see
     * `buildRegistryEntry`). `background.transparent` is the long form of
     * `transparentSurface`.
     *
     * A contribution that owns the whole stage (an opaque full-stage surface)
     * has to decide for itself whether to keep painting over the host
     * background; cinerama's screen fill steps aside when this is present so
     * the configured background actually shows. Absent on old hosts, where the
     * contribution should behave as if it painted its own backdrop.
     */
    background?: VisualizerBackgroundConfig;
}

export interface ModVisualizerModule {
    default: {
        mount: (element: HTMLElement, props: ModVisualizerMountProps) => void | (() => void);
    };
}

export interface ModVisualizerDescriptor {
    mode: string;
    /**
     * folia-mod:// URL of the contribution's ESM entry, versioned by the mod's
     * content digest. The version matters: a bare URL would be served from the
     * browser's ES module map on every re-import, so an updated mod would keep
     * running the code imported the first time (Cache-Control cannot reach the
     * module map). A changed digest is a different specifier, so it re-imports.
     */
    url: string;
    label: Record<string, string | undefined>;
    order: number;
    settings: ModVisualizerContribution['settings'];
    modName: string;
}

const resolveModVisualizerLabel = (label: Record<string, string | undefined>, modName: string): string =>
    label['zh-CN'] ?? label.en ?? label[document?.documentElement?.lang] ?? modName;

/*
 * React host for one mod visualizer. mount() owns the DOM inside the host div;
 * the returned disposer (if any) runs on unmount or song change. Continuous
 * time flows through the MotionValue subscription, never React state.
 */
const ModVisualizerHost: React.FC<{
    mount: ModVisualizerModule['default']['mount'];
    sharedProps: VisualizerSharedProps;
    mode: string;
}> = ({ mount, sharedProps, mode }) => {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const modulation = useModVisualizerModulation(mode);
    const settings = useModVisualizerSettings(mode);
    // Read through refs so a knob drag never remounts the contribution (which
    // would rebuild its DOM and restart its animation).
    const modulationRef = useRef(modulation);
    modulationRef.current = modulation;
    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    const getModulation = useCallback(() => modulationRef.current, []);
    const getSettings = useCallback(() => settingsRef.current, []);
    /*
     * 同一条规则的第二批：**随时会变、但变化不该重建 DOM 的量一律走 getter**。
     * 主题、暂停、背景配置以前只在 mount 时快照一次，贡献层因此永远收不到
     * 「暂停了」「换主题了」「背景类型改了」；行号更糟——它每换一行就变，
     * 以前直接放在 mount 的依赖里，于是每唱一行就把贡献层整段 dispose + mount 一次。
     */
    const sharedPropsRef = useRef(sharedProps);
    sharedPropsRef.current = sharedProps;
    const getTheme = useCallback(() => sharedPropsRef.current.theme, []);
    const getBackground = useCallback(() => sharedPropsRef.current.background, []);
    const staticMode = Boolean(sharedProps.staticMode);

    useEffect(() => {
        const element = hostRef.current;
        if (!element) {
            return;
        }
        const dispose = mount(element, {
            lines: sharedProps.lines,
            currentLineIndex: sharedProps.currentLineIndex,
            currentTime: sharedProps.currentTime,
            theme: sharedProps.theme,
            songTitle: sharedProps.songTitle ?? null,
            songArtist: sharedProps.songArtist ?? null,
            staticMode,
            paused: Boolean(sharedProps.paused),
            transparentSurface: Boolean(sharedProps.background?.transparent),
            background: sharedProps.background,
            getModulation,
            getSettings,
            getTheme,
            getBackground,
        });
        return () => {
            if (typeof dispose === 'function') {
                dispose();
            }
        };
        /*
         * 重挂的判据只有「歌词数据 / 歌曲身份 / 静态预览那一行」：
         *   - `currentLineIndex` **不能**进依赖——它每换一行就变，进去就是逐行重建
         *     （贡献层拿它只用于静态预览的首帧，播放中一律读 `currentTime`）；
         *   - `theme` / `paused` / `background` 同理，它们走上面的 getter；
         *   - MotionValue 引用跨渲染稳定，故意不进依赖。
         */
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        mount,
        sharedProps.lines,
        sharedProps.songTitle,
        sharedProps.songArtist,
        staticMode,
        staticMode ? sharedProps.currentLineIndex : -1,
    ]);

    return <div ref={hostRef} className="w-full h-full" />;
};

/*
 * 模组模式共用的底部字幕层（翻译 / 下一句预览）。
 *
 * 内置模式是在各自的 renderer 里做这段接线的：`useVisualizerRuntime` 取当前行 / 上一句 /
 * 下一句，再按 `lyricsFontScale` 算两组字号，最后交给 `VisualizerSubtitleOverlay`。
 * 模组拿不到 React，宿主也不给它 `renderSettingsPanel`，所以这段缺口只能在宿主这一侧补平；
 * 补上之后模组模式和内置模式一样，字幕的字号缩放、透明度、底栏偏移、模糊、内容口径
 * 全部走宿主的既有设置，不需要模组自己实现。
 *
 * 字号取内置多数模式那一组常量（classic / cadenza / diorama / tilt 同值），
 * 所以从内置模式切到巨幕，底部字幕的位置和大小是连续的。
 */
const ModVisualizerSubtitleOverlay: React.FC<VisualizerSharedProps> = (props) => {
    const {
        currentTime,
        currentLineIndex,
        lines,
        theme,
        subtitleTheme,
        showText = true,
        lyricsFontScale = 1,
        subtitleFontScale = 1,
        subtitleOverlayOpacity,
        subtitleOverlayBackground,
        subtitleUpcomingLyricsBlur,
        isPlayerChromeHidden,
        hideTranslationSubtitle,
        showSubtitleTranslation,
        subtitleContentMode,
    } = props;
    const { activeLine, recentCompletedLine, nextLines } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });
    const subtitleFontSizes = resolveSubtitleFontSizes(lyricsFontScale);

    return (
        <VisualizerSubtitleOverlay
            showText={showText}
            activeLine={activeLine}
            recentCompletedLine={recentCompletedLine}
            nextLines={nextLines}
            theme={theme}
            subtitleTheme={subtitleTheme}
            {...subtitleFontSizes}
            subtitleFontScale={subtitleFontScale}
            subtitleOverlayOpacity={subtitleOverlayOpacity}
            subtitleOverlayBackground={subtitleOverlayBackground}
            subtitleUpcomingLyricsBlur={subtitleUpcomingLyricsBlur}
            isPlayerChromeHidden={isPlayerChromeHidden}
            hideTranslationSubtitle={hideTranslationSubtitle}
            showSubtitleTranslation={showSubtitleTranslation}
            subtitleContentMode={subtitleContentMode}
        />
    );
};

const buildRegistryEntry = (descriptor: ModVisualizerDescriptor, mount: ModVisualizerModule['default']['mount']): VisualizerRegistryEntry => ({
    mode: descriptor.mode as VisualizerRegistryEntry['mode'],
    order: descriptor.order,
    /*
     * Intentionally-unmapped key: getVisualizerModeLabel falls back to
     * labelFallback when the i18n dictionary has no entry, so mod labels work
     * in every locale without touching the locale files. The mode id must be
     * dot-joined here: i18next's default nsSeparator is ':', and a key like
     * `ui.modVisualizer.mod:<id>:<viz>` gets its namespace stripped before the
     * lookup *and* before parseMissingKeyHandler sees it, so the mangled
     * remainder ("<id>.<viz>") would come back as a "translation" and defeat
     * the fallback. Dots keep the key intact end-to-end.
     */
    labelKey: `ui.modVisualizer.${descriptor.mode.split(':').join('.')}`,
    labelFallback: resolveModVisualizerLabel(descriptor.label, descriptor.modName),
    previewSeed: descriptor.mode,
    previewStartOffset: 0,
    tuningKind: 'none',
    /*
     * 模组视觉层要套宿主那份共享外壳（`VisualizerShell`），和内置模式一个形状。
     * 以前这里是一个裸 div：外壳里左上角那颗返回按钮（播放页回首页）是外壳渲染的，
     * 模组因此完全没有它——内置模式都是自己套这层壳，所以差异只在模组这边。
     *
     * 背景与底部字幕也一并补齐，和内置模式**同源**（这是模组侧做不到的两件事：
     * 背景是一个 React 注册表、字幕要读宿主的字幕设置，纯 DOM 的贡献层拿不到）：
     *
     *   - 背景：`renderBackground` 用缺省的 true。以前传 false，理由是「模组拥有整块
     *     舞台，背景会被自己的画面盖住」——那对「画满整屏且不透明」的模组成立，但代价
     *     是用户在「背景类型」里选的背景对模组模式永远不生效。现在照内置模式接上，
     *     要不要给背景让位由贡献层自己决定（`mount` props 里给了整份 `background`，
     *     巨幕就据此让出屏面填充）。透明表面（播放页透明 / OBS 源 / 导出窗口）本来就会
     *     让 `VisualizerBackgroundRenderer` 直接返回 null，所以透明通道不受影响。
     *   - 底部字幕：`VisualizerSubtitleOverlay`，接线见下面的 ModVisualizerSubtitleOverlay。
     */
    render: (props) => (
        <VisualizerShell
            theme={props.theme}
            audioPower={props.audioPower}
            audioBands={props.audioBands}
            sharedProps={props}
        >
            <ModVisualizerHost mount={mount} sharedProps={props} mode={descriptor.mode} />
            <ModVisualizerSubtitleOverlay {...props} />
        </VisualizerShell>
    ),
    // Declared schema (manifest visualizers[].settings) turns into a settings
    // panel under the mode picker in the lyrics-animation settings; the values
    // live in modVisualizerSettings and reach the contribution via getSettings.
    renderSettingsPanel: createModVisualizerSettingsPanel({
        mode: descriptor.mode,
        settings: descriptor.settings,
        label: descriptor.label,
        fallbackLabel: resolveModVisualizerLabel(descriptor.label, descriptor.modName),
    }),
});

const collectDescriptors = (mods: ModRuntimeInfo[]): ModVisualizerDescriptor[] =>
    mods.flatMap((mod) =>
        (mod.visualizers ?? []).map((visualizer: ModVisualizerContribution) => ({
            mode: visualizer.mode,
            url: visualizer.url,
            label: visualizer.label ?? {},
            order: visualizer.order ?? 500,
            settings: visualizer.settings ?? [],
            modName: mod.name,
        }))
    );

let initPromise: Promise<void> | null = null;

// Modes currently registered from mod contributions, mapped to the exact URL
// each one was imported from. Kept in sync with the live registry so a reload
// can add newly-declared modes, drop modes whose mod was disabled or
// uninstalled, and re-import a mode whose code changed under it.
const registeredModModes = new Map<string, string>();

/*
 * Reconciles a descriptor list against the live visualizer registry. A mode
 * whose URL is unchanged keeps its existing registration; a mode that vanished
 * or whose URL moved is removed first and re-imported, so "reload" genuinely
 * picks up edited mod code instead of replaying the module already in memory.
 * Idempotent, and a per-mod import failure only skips that mod.
 */
export const registerModVisualizers = async (descriptors: ModVisualizerDescriptor[]): Promise<void> => {
    const desired = new Map(descriptors.map((descriptor) => [descriptor.mode, descriptor.url]));

    for (const [mode, url] of Array.from(registeredModModes)) {
        if (desired.get(mode) !== url) {
            removeVisualizerEntry(mode as VisualizerMode);
            registeredModModes.delete(mode);
        }
    }

    await Promise.all(descriptors.map(async (descriptor) => {
        if (registeredModModes.has(descriptor.mode)) {
            return;
        }
        try {
            const module = await import(/* @vite-ignore */ descriptor.url) as ModVisualizerModule;
            if (typeof module?.default?.mount !== 'function') {
                throw new Error('missing default.mount');
            }
            if (appendVisualizerEntry(buildRegistryEntry(descriptor, module.default.mount))) {
                registeredModModes.set(descriptor.mode, descriptor.url);
            }
        } catch (error) {
            console.warn(`[Mods] Failed to load visualizer "${descriptor.mode}":`, error);
        }
    }));
};

/*
 * Reconciles mod visualizer contributions against the latest mod state, read
 * over the IPC bridge. Only usable where that bridge exists (the main window);
 * the export window has no preload and registers from injected descriptors via
 * registerModVisualizers instead.
 */
export const initModVisualizers = async (): Promise<void> => {
    if (initPromise) {
        return initPromise;
    }
    initPromise = (async () => {
        if (!isModsBridgeAvailable()) {
            return;
        }
        const { mods } = await listMods();
        await registerModVisualizers(collectDescriptors(mods));
    })();
    return initPromise;
};

/*
 * Clears the cached init promise so the next call re-runs the reconciliation.
 * Called after the main-process mod state changes (install/enable/disable/
 * reload) so contributed visualizer modes track the current mod set.
 */
export const reloadModVisualizers = (): void => {
    initPromise = null;
};
