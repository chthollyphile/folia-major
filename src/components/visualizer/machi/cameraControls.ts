import { times } from '../panelRows';
import {
    MACHI_APERTURE_STOPS,
    type MachiCameraMode,
    type MachiCameraView,
    type MachiFocusMode,
} from './types';

// src/components/visualizer/machi/cameraControls.ts
// 町景镜头与景深那几项控件的定义：设置面板（MachiSettingsPanel）和播放页的取景控制条（MachiCameraBar）共用一套
// 文案、读数格式和光圈的档。

export const MACHI_CAMERA_LABEL_KEYS: Record<MachiCameraMode, string> = {
    default: 'options.machiCameraDefault',
    custom: 'options.machiCameraCustom',
};

export const MACHI_FOCUS_LABEL_KEYS: Record<MachiFocusMode, string> = {
    center: 'options.machiFocusCenter',
    lyrics: 'options.machiFocusLyrics',
    manual: 'options.machiFocusManual',
};

/** 带正负号的读数：+12°、−0.5 m。 */
export const signedReadout = (unit: string, digits = 0) => (value: number) => {
    const text = Math.abs(value).toFixed(digits);
    const sign = Number(text) === 0 ? '' : value > 0 ? '+' : '−';
    return `${sign}${text}${unit}`;
};

/** 自定义视角的五个滑块：转角、俯仰（度）、远近（倍数）、左右与前后平移（米）。 */
export const MACHI_VIEW_SLIDERS: { key: keyof MachiCameraView; labelKey: string; step: number; format: (value: number) => string }[] = [
    { key: 'azimuth', labelKey: 'options.machiViewAzimuth', step: 1, format: signedReadout('°') },
    { key: 'elevation', labelKey: 'options.machiViewElevation', step: 1, format: signedReadout('°') },
    { key: 'zoom', labelKey: 'options.machiViewZoom', step: 0.05, format: times },
    { key: 'panX', labelKey: 'options.machiViewPanX', step: 0.1, format: signedReadout(' m', 1) },
    { key: 'panZ', labelKey: 'options.machiViewPanZ', step: 0.1, format: signedReadout(' m', 1) },
];

/** 光圈滑块往右光圈越大：第 0 格是 f/16，最后一格是 f/1.4。 */
const APERTURE_TRACK = [...MACHI_APERTURE_STOPS].reverse();

/** 光圈滑块的格数上限（下限是 0）。 */
export const MACHI_APERTURE_TRACK_MAX = APERTURE_TRACK.length - 1;

/** 光圈（f 值）在滑块上的格：不在档上的取最近的一档。 */
export const machiApertureToTrack = (aperture: number) => APERTURE_TRACK.reduce((best, stop, index) => (
    Math.abs(Math.log(stop / aperture)) < Math.abs(Math.log(APERTURE_TRACK[best]! / aperture)) ? index : best
), 0);

/** 滑块的格 → 光圈（f 值）。 */
export const machiApertureFromTrack = (index: number) => APERTURE_TRACK[Math.min(MACHI_APERTURE_TRACK_MAX, Math.max(0, Math.round(index)))]!;

/** 光圈读数：f/2.8。 */
export const apertureReadout = (aperture: number) => `f/${aperture}`;
