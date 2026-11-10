import React, { useEffect, useId, useState } from 'react';
import { motion } from 'framer-motion';
import { RotateCcw, X } from 'lucide-react';
import { usePlayerSubtitleBottomPx } from '../../../hooks/usePlayerBottomBarBottomPx';
import type { Theme } from '../../../types';
import { Button, Segmented, Slider, Tabs, Toggle } from '../../modal/settings/kit';
import { SettingsKitThemeContext, settingsTokens } from '../../modal/settings/kit/kitTheme';
import { percent, times } from '../panelRows';
import {
    apertureReadout,
    MACHI_APERTURE_TRACK_MAX,
    MACHI_CAMERA_LABEL_KEYS,
    MACHI_FOCUS_LABEL_KEYS,
    MACHI_VIEW_SLIDERS,
    machiApertureFromTrack,
    machiApertureToTrack,
    signedReadout,
} from './cameraControls';
import {
    DEFAULT_MACHI_TUNING,
    DEFAULT_MACHI_VIEW,
    MACHI_CAMERA_MODES,
    MACHI_DOF_LIMITS,
    MACHI_FOCUS_MODES,
    MACHI_MOTION_SPEED_LIMITS,
    MACHI_VIEW_LIMITS,
    type MachiCameraMode,
    type MachiCameraView,
    type MachiFocusMode,
    type MachiSceneId,
    type MachiTuning,
} from './types';

// src/components/visualizer/machi/MachiCameraBar.tsx
// 播放页上町景的取景控制条（像游戏里的拍照模式）：画面上叠取景框的四角、三分线和画面中心（镜头绕着转、对焦“画面中心”
// 对的那一点）；底部一条半透明的横条分三页：视角（默认构图 / 自定义，正在画的这个场景的五个滑块，一动就固定成自定义
// 视角；默认构图下滑块从默认构图读、从默认构图改起）、对焦与光圈（光圈、对焦在哪、手动对焦的前后、清晰范围、景深强度、
// 移轴）、运镜（开关、快慢）。右端是这一页的复位和收起。改的都是 tuning 里的同一套值（和设置面板一样）：滑块拖动时只经
// onPreview 推给画面，松手（指针抬起、键盘改完）再 onCommit 存下，免得每动一格都写存储、整个应用跟着重渲染；
// 选项和开关一点就经 onTuningChange 存。横条放在底部字幕的位置（开着时字幕让开），跟字幕一样让开播放页底部的控制条。
// 横条的控件用设置窗口的那套（kit），颜色固定成深色玻璃上的浅色字，不跟主题的明暗走。

type BarTab = 'view' | 'lens' | 'motion';

const TABS: { id: BarTab; labelKey: string }[] = [
    { id: 'view', labelKey: 'options.machiCameraBarView' },
    { id: 'lens', labelKey: 'options.machiCameraBarLens' },
    { id: 'motion', labelKey: 'options.machiCameraBarMotion' },
];

/** 上次停在哪一页：收起再打开还在那一页。 */
let lastTab: BarTab = 'view';

interface MachiCameraBarProps {
    tuning: MachiTuning;
    /** 正在画的场景：视角的滑块调它那一份。 */
    scene: MachiSceneId;
    theme: Theme;
    t: (key: string) => string;
    /** 播放页底部的控制条藏着没有：横条按它让位。 */
    isPlayerChromeHidden: boolean;
    /** 滑块拖动中：只推给画面，不存。 */
    onPreview: (patch: Partial<MachiTuning>) => void;
    /** 滑块松手：把拖动中的改动存下。 */
    onCommit: () => void;
    /** 选项、开关、复位：立即存下。 */
    onTuningChange: (patch: Partial<MachiTuning>) => void;
    onClose: () => void;
}

/** 一格：上面一行是名字和读数，下面是滑块（名字包着整格，滑块读得出自己叫什么）。 */
const BarSlider: React.FC<{ label: string } & React.ComponentProps<typeof Slider>> = ({ label, ...slider }) => (
    <label className="flex min-w-0 flex-wrap items-center gap-x-2">
        <span className={`text-[12px] text-[color:var(--st-t2)]${slider.disabled ? ' opacity-40' : ''}`}>{label}</span>
        <Slider stacked {...slider} />
    </label>
);

/** 一格里放的是一组选择（或开关）：名字在上，控件在下。 */
const BarChoice: React.FC<{ label: string; labelId?: string; children: React.ReactNode }> = ({ label, labelId, children }) => (
    <div className="flex min-w-0 flex-col gap-1.5">
        <span id={labelId} className="text-[12px] text-[color:var(--st-t2)]">{label}</span>
        <div className="flex min-h-8 items-center">{children}</div>
    </div>
);

/** 取景框：四角、三分线、画面中心的准星。 */
const Viewfinder: React.FC = () => (
    <div aria-hidden className="pointer-events-none absolute inset-0">
        {[['left-6 top-6', 'border-l-2 border-t-2'], ['right-6 top-6', 'border-r-2 border-t-2'], ['bottom-6 left-6', 'border-b-2 border-l-2'], ['bottom-6 right-6', 'border-b-2 border-r-2']].map(([place, sides]) => (
            <span key={place} className={`absolute h-7 w-7 border-white/70 ${place} ${sides}`} />
        ))}
        <span className="absolute inset-y-0 left-1/3 w-px bg-white/15" />
        <span className="absolute inset-y-0 left-2/3 w-px bg-white/15" />
        <span className="absolute inset-x-0 top-1/3 h-px bg-white/15" />
        <span className="absolute inset-x-0 top-2/3 h-px bg-white/15" />
        <span className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/60" />
        <span className="absolute left-1/2 top-1/2 h-px w-3 -translate-x-1/2 -translate-y-1/2 bg-white/80" />
        <span className="absolute left-1/2 top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-white/80" />
    </div>
);

const MachiCameraBar: React.FC<MachiCameraBarProps> = ({ tuning, scene, theme, t, isPlayerChromeHidden, onPreview, onCommit, onTuningChange, onClose }) => {
    const [tab, setTab] = useState<BarTab>(lastTab);
    const motionLabelId = useId();
    const bottom = usePlayerSubtitleBottomPx(isPlayerChromeHidden);
    // 默认构图下画面就是默认构图：滑块从它读，拖哪一项就从它改起（不是存着的旧自定义视角，不然一拖画面会跳过去）。
    const view = tuning.camera === 'custom' ? tuning.views[scene] : DEFAULT_MACHI_VIEW;
    const setView = (next: MachiCameraView) => onPreview({ camera: 'custom', views: { ...tuning.views, [scene]: next } });
    // 指针在哪抬起都算松手（拖出滑块外抬起时滑块自己不一定收得到）。
    useEffect(() => {
        window.addEventListener('pointerup', onCommit);
        return () => window.removeEventListener('pointerup', onCommit);
    }, [onCommit]);
    const selectTab = (id: string) => {
        const next = id as BarTab;
        lastTab = next;
        setTab(next);
    };
    const reset = () => {
        if (tab === 'view') {
            onTuningChange({ camera: 'default', views: { ...tuning.views, [scene]: DEFAULT_MACHI_VIEW } });
        } else if (tab === 'lens') {
            const { aperture, dof, dofRange, tiltShift, focus, focusOffset } = DEFAULT_MACHI_TUNING;
            onTuningChange({ aperture, dof, dofRange, tiltShift, focus, focusOffset });
        } else {
            onTuningChange({ motion: DEFAULT_MACHI_TUNING.motion, motionSpeed: DEFAULT_MACHI_TUNING.motionSpeed });
        }
    };
    const dofOff = tuning.dof === 0;
    // 深色玻璃上的浅色字：kit 的颜色变量按深色算，文字色不跟主题走。
    const tokens = { ...settingsTokens(false, theme), '--text-primary': '#f4f4f5' } as React.CSSProperties;

    return (
        <div className="pointer-events-none absolute inset-0 z-30">
            <Viewfinder />
            <motion.div className="absolute inset-x-0 flex justify-center px-4" style={{ bottom }}>
                <SettingsKitThemeContext.Provider value={{ isDaylight: false, theme }}>
                    <div
                        role="region"
                        aria-label={t('options.machiCameraBar')}
                        style={tokens}
                        className="pointer-events-auto w-full max-w-[920px] rounded-2xl border border-white/10 bg-[rgba(18,18,20,0.74)] text-[13px] text-[color:var(--st-t1)] shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl"
                        // Esc 收起（只在焦点在横条里时：别处的 Esc 还归原来的用处）；空格、回车是横条里按钮和开关的，
                        // 不让播放页的全局快捷键拿去暂停。
                        onKeyDown={event => {
                            if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
                            if (event.key !== 'Escape') return;
                            event.stopPropagation();
                            onClose();
                        }}
                        // 键盘改完一格：存下。
                        onKeyUp={onCommit}
                    >
                        <Tabs
                            tabs={TABS.map(item => ({ id: item.id, label: t(item.labelKey) }))}
                            activeId={tab}
                            onSelect={selectTab}
                            label={t('options.machiCameraBar')}
                            className="px-3"
                            action={(
                                <div className="flex items-center gap-1 pr-2">
                                    <Button variant="quiet" icon={RotateCcw} onClick={reset}>{t('options.machiCameraBarReset')}</Button>
                                    <Button variant="quiet" icon={X} tip={t('options.machiCameraBarClose')} onClick={onClose} />
                                </div>
                            )}
                        />
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] items-end gap-x-6 gap-y-2 px-5 pb-4 pt-3">
                            {tab === 'view' && (
                                <>
                                    <BarChoice label={t('options.machiCameraMode')}>
                                        <Segmented<MachiCameraMode>
                                            value={tuning.camera}
                                            options={MACHI_CAMERA_MODES.map(mode => ({ value: mode, label: t(MACHI_CAMERA_LABEL_KEYS[mode]) }))}
                                            onChange={camera => onTuningChange({ camera })}
                                        />
                                    </BarChoice>
                                    {MACHI_VIEW_SLIDERS.map(slider => (
                                        <BarSlider
                                            key={slider.key}
                                            label={t(slider.labelKey)}
                                            value={view[slider.key]}
                                            min={MACHI_VIEW_LIMITS[slider.key].min}
                                            max={MACHI_VIEW_LIMITS[slider.key].max}
                                            step={slider.step}
                                            format={slider.format}
                                            onChange={value => setView({ ...view, [slider.key]: value })}
                                        />
                                    ))}
                                </>
                            )}
                            {tab === 'lens' && (
                                <>
                                    <BarSlider
                                        label={t('options.machiAperture')}
                                        value={machiApertureToTrack(tuning.aperture)}
                                        min={0}
                                        max={MACHI_APERTURE_TRACK_MAX}
                                        step={1}
                                        format={index => apertureReadout(machiApertureFromTrack(index))}
                                        disabled={dofOff}
                                        onChange={index => onPreview({ aperture: machiApertureFromTrack(index) })}
                                    />
                                    <BarChoice label={t('options.machiFocus')}>
                                        <Segmented<MachiFocusMode>
                                            value={tuning.focus}
                                            options={MACHI_FOCUS_MODES.map(focus => ({ value: focus, label: t(MACHI_FOCUS_LABEL_KEYS[focus]) }))}
                                            onChange={focus => onTuningChange({ focus })}
                                        />
                                    </BarChoice>
                                    <BarSlider
                                        label={t('options.machiFocusOffset')}
                                        value={tuning.focusOffset}
                                        min={MACHI_DOF_LIMITS.focusOffset.min}
                                        max={MACHI_DOF_LIMITS.focusOffset.max}
                                        step={0.1}
                                        format={signedReadout(' m', 1)}
                                        disabled={tuning.focus !== 'manual'}
                                        onChange={focusOffset => onPreview({ focusOffset })}
                                    />
                                    <BarSlider
                                        label={t('options.machiDofRange')}
                                        value={tuning.dofRange}
                                        min={MACHI_DOF_LIMITS.dofRange.min}
                                        max={MACHI_DOF_LIMITS.dofRange.max}
                                        step={0.05}
                                        format={times}
                                        disabled={dofOff}
                                        onChange={dofRange => onPreview({ dofRange })}
                                    />
                                    <BarSlider
                                        label={t('options.machiDof')}
                                        value={tuning.dof}
                                        min={MACHI_DOF_LIMITS.dof.min}
                                        max={MACHI_DOF_LIMITS.dof.max}
                                        step={0.05}
                                        format={percent}
                                        onChange={dof => onPreview({ dof })}
                                    />
                                    <BarSlider
                                        label={t('options.machiTiltShift')}
                                        value={tuning.tiltShift}
                                        min={MACHI_DOF_LIMITS.tiltShift.min}
                                        max={MACHI_DOF_LIMITS.tiltShift.max}
                                        step={0.05}
                                        format={percent}
                                        onChange={tiltShift => onPreview({ tiltShift })}
                                    />
                                </>
                            )}
                            {tab === 'motion' && (
                                <>
                                    <BarChoice label={t('options.machiCameraMotion')} labelId={motionLabelId}>
                                        <Toggle checked={tuning.motion} labelledBy={motionLabelId} onChange={motion => onTuningChange({ motion })} />
                                    </BarChoice>
                                    <BarSlider
                                        label={t('options.machiCameraMotionSpeed')}
                                        value={tuning.motionSpeed}
                                        min={MACHI_MOTION_SPEED_LIMITS.min}
                                        max={MACHI_MOTION_SPEED_LIMITS.max}
                                        step={0.05}
                                        format={times}
                                        disabled={!tuning.motion}
                                        onChange={motionSpeed => onPreview({ motionSpeed })}
                                    />
                                </>
                            )}
                        </div>
                    </div>
                </SettingsKitThemeContext.Provider>
            </motion.div>
        </div>
    );
};

export default MachiCameraBar;
