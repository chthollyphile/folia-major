import { describe, expect, it } from 'vitest';
import { compressConfig, decompressConfig } from '../../../src/utils/appearanceCodec';
import { DEFAULT_PENDOLO_TUNING } from '../../../src/types';

// test/unit/visualizer/pendoloAppearanceCodec.test.ts
// 时计的镜像、倾斜、分层视差和轮心视角随外观短码带走，旧短码导入后是平放的表盘。

describe('Pendolo appearance codec', () => {
    it('carries mirror, tilt, parallax and hub view through a short code', () => {
        const tuning = {
            ...DEFAULT_PENDOLO_TUNING,
            mirrorLayout: true,
            tiltDeg: -53,
            tiltAxisDeg: 66,
            parallaxDepth: 1.65,
            hubView: true,
            hubViewHeight: 1.8,
            hubViewBack: 0.6,
        };
        const decoded = decompressConfig(compressConfig({ pendoloTuning: tuning }));
        expect(decoded.pendoloTuning).toMatchObject({
            mirrorLayout: true,
            tiltDeg: -53,
            tiltAxisDeg: 66,
            parallaxDepth: 1.65,
            hubView: true,
            hubViewHeight: 1.8,
            hubViewBack: 0.6,
        });
    });

    it('reads a short code from before these fields as a flat, unmirrored dial', () => {
        const decoded = decompressConfig(compressConfig({ pendoloTuning: { showGearDecor: 'full' } }));
        expect(decoded.pendoloTuning).toMatchObject({
            showGearDecor: 'full',
            mirrorLayout: false,
            tiltDeg: 0,
            hubView: false,
            parallaxDepth: DEFAULT_PENDOLO_TUNING.parallaxDepth,
        });
    });
});
