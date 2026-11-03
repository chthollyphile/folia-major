import React, { useEffect, useMemo, useState } from 'react';
import { Group, Row, Toggle, option, type SettingsGroupDef } from '../../src/components/modal/settings/kit';
import { SettingsKitThemeContext, settingsTokens } from '../../src/components/modal/settings/kit/kitTheme';
import { kitMotionTokens } from '../../src/components/modal/settings/kit/motion';
import { SettingsAnchorProvider, useSettingsAnchorStore } from '../../src/components/modal/settings/navigation/SettingsAnchorContext';
import { WallpaperDisplayRow } from '../../src/components/modal/settings/pages/desktop/WallpaperDisplayRow';
import { DAYLIGHT_THEME, DEFAULT_THEME } from '../../src/services/baseThemes';
import type { ProbeDefinition } from './definition';
// dev/probes/wallpaperDisplayRow.probe.tsx

/**
 * 设置「桌面」页里选壁纸显示器的那一行：真的 WallpaperDisplayRow，放在一张和设置窗口一样的卡片里，
 * 上面一行代表壁纸模式开关，下面一行代表它后面的行。主进程换成这里的假桥（window.electron 的三个函数），
 * 选了哪一块记在 data-probe-choice 上。
 *
 * 地址上的参数：displays=two | three | stacked | one（接了哪些显示器），theme=dark | light，
 * choice=auto | 显示器编号（从 1 起，按假数据的顺序）| gone（选过的那块没接着），width=卡片外框的宽度（像素）。
 */
const WINDOW: SettingsGroupDef = { id: 'desktopTrayBehavior', titleKey: 'options.desktopTrayBehavior', electronOnly: true };
const WALLPAPER_MODE = option(WINDOW, 'wallpaperMode', 'options.wallpaperMode');
const WALLPAPER_DISPLAY = option(WINDOW, 'wallpaperDisplay', 'options.wallpaperDisplay');
const NEXT_ROW = option(WINDOW, 'hideFullscreenButton', 'options.hideFullscreenButton');

type Display = ElectronWallpaperDisplay;

const display = (id: number, label: string, x: number, y: number, width: number, height: number, scaleFactor = 1, primary = false): Display => (
    { id, label, bounds: { x, y, width, height }, scaleFactor, primary }
);

const LAYOUTS: Record<string, Display[]> = {
    one: [display(1, 'Probe Panel A', 0, 0, 2560, 1440, 1, true)],
    two: [
        display(1, 'Probe Panel A', 0, 0, 2560, 1440, 1, true),
        display(2, 'Probe Panel B', 2560, 180, 1920, 1080),
    ],
    // A portrait display at the left, the primary in the middle, a 4K display at 150% at the right.
    three: [
        display(3, 'Probe Panel C', -1440, -560, 1440, 2560),
        display(1, 'Probe Panel A', 0, 0, 2560, 1440, 1, true),
        display(2, 'Probe Panel B', 2560, 0, 2560, 1440, 1.5),
    ],
    // Many side by side: the map grows so each keeps its number and resolution.
    four: [0, 1, 2, 3].map(index => display(index + 1, `Probe Panel ${'ABCD'[index]}`, index * 1920, 0, 1920, 1080, 1, index === 1)),
    six: [0, 1, 2, 3, 4, 5].map(index => display(index + 1, `Probe Panel ${'ABCDEF'[index]}`, index * 1920, 0, 1920, 1080, 1, index === 0)),
    stacked: [
        display(2, 'Probe Panel B', 320, -1080, 1920, 1080),
        display(1, 'Probe Panel A', 0, 0, 2560, 1440, 1, true),
    ],
};

const WallpaperDisplayRowProbe: React.FC = () => {
    const params = useMemo(() => new URLSearchParams(window.location.search), []);
    const displays = LAYOUTS[params.get('displays') ?? 'two'] ?? LAYOUTS.two;
    const isDaylight = params.get('theme') === 'light';
    const theme = isDaylight ? DAYLIGHT_THEME : DEFAULT_THEME;
    const width = Number(params.get('width')) || 760;
    const store = useSettingsAnchorStore();
    const kitTheme = useMemo(() => ({ isDaylight, theme }), [isDaylight, theme]);
    const [ready, setReady] = useState(false);
    const [chosen, setChosen] = useState('');

    useEffect(() => {
        const start = params.get('choice') ?? 'auto';
        const gone = { id: 99, label: 'Probe Panel Z', bounds: { x: 9000, y: 0, width: 1920, height: 1080 } };
        let choice: ElectronWallpaperDisplaysState['choice'] = start === 'gone'
            ? gone
            : displays.find(candidate => String(candidate.id) === start) ?? null;
        const state = (): ElectronWallpaperDisplaysState => {
            const connected = displays.find(candidate => candidate.id === choice?.id);
            return {
                displays,
                choice,
                chosenId: connected?.id ?? null,
                activeId: connected?.id ?? displays.find(candidate => candidate.primary)?.id ?? null,
            };
        };
        (window as unknown as { electron: unknown }).electron = {
            platform: 'win32',
            isLinuxX11: false,
            getWallpaperDisplays: async () => state(),
            setWallpaperDisplay: async (displayId: number | null) => {
                const picked = displays.find(candidate => candidate.id === displayId);
                choice = picked ? { id: picked.id, label: picked.label, bounds: picked.bounds } : null;
                setChosen(picked ? String(picked.id) : 'auto');
                return state();
            },
            onWallpaperDisplaysChanged: () => () => {},
        };
        setReady(true);
        return () => {
            delete (window as unknown as { electron?: unknown }).electron;
        };
    }, [displays, params]);

    return (
        <div
            className={`min-h-screen p-6 ${isDaylight ? 'bg-zinc-200' : 'bg-zinc-950'}`}
            style={{ '--text-primary': theme.primaryColor, '--text-secondary': theme.secondaryColor } as React.CSSProperties}
            data-probe-wallpaper-display={ready ? 'ready' : 'booting'}
            data-probe-choice={chosen}
        >
            <div
                data-probe-window
                className="st-window mx-auto rounded-2xl bg-[var(--st-win)] px-4 pb-6 pt-1 text-[color:var(--st-t1)]"
                style={{ ...settingsTokens(isDaylight, theme), ...kitMotionTokens(false), width, maxWidth: '100%' }}
            >
                <SettingsKitThemeContext.Provider value={kitTheme}>
                    <SettingsAnchorProvider store={store} section="desktop">
                        <Group def={WINDOW}>
                            <Row option={WALLPAPER_MODE} hint="Stand-in for the wallpaper switch">
                                <Toggle checked={false} onChange={() => {}} />
                            </Row>
                            {ready && <WallpaperDisplayRow option={WALLPAPER_DISPLAY} />}
                            <Row option={NEXT_ROW}>
                                <Toggle checked={false} onChange={() => {}} />
                            </Row>
                        </Group>
                    </SettingsAnchorProvider>
                </SettingsKitThemeContext.Provider>
            </div>
        </div>
    );
};

const probe: ProbeDefinition = {
    id: 'wallpaperDisplayRow',
    title: '设置·桌面页：壁纸显示器',
    description: '多块显示器时画出排布图和「自动」；一块时这一行不出现；选中的戴强调色的框，方向键只移焦点。',
    Component: WallpaperDisplayRowProbe,
};

export default probe;
