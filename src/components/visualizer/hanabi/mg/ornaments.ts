// Copyright (c) 2026 chthollyphile
import type { CreateOrnament, OrnamentKind } from '../types';
import { createKit, type OrnamentBuilder } from './ornamentKit';
import { dotsLineOrnament, underlineOrnament, waveOrnament, zigzagOrnament } from './ornamentLines';
import {
    chevronsOrnament, confettiOrnament, crossOrnament, glintsOrnament, petalsOrnament, shardsOrnament, sparkleOrnament, streaksOrnament,
} from './ornamentParticles';
import {
    bracketsOrnament, dashCircleOrnament, halftoneOrnament, orbitOrnament, raysOrnament, ringOrnament, spokesOrnament, squaresOrnament, stampOrnament,
} from './ornamentShapes';

// src/components/visualizer/hanabi/mg/ornaments.ts
// MG 装饰件入口：按 OrnamentKind 选实现，统一处理可见时间窗（入场前、退场后整件隐藏、不更新）。
// 坐标与文字视图的本地坐标一致；placement = 'screen' 时假设文字区中心大致在画面中心（多铺 10% 兜住偏移）。

export const ORNAMENT_BUILDERS: Record<OrnamentKind, OrnamentBuilder> = {
    ring: ringOrnament,
    spokes: spokesOrnament,
    sparkle: sparkleOrnament,
    orbit: orbitOrnament,
    chevrons: chevronsOrnament,
    brackets: bracketsOrnament,
    cross: crossOrnament,
    zigzag: zigzagOrnament,
    wave: waveOrnament,
    halftone: halftoneOrnament,
    confetti: confettiOrnament,
    shards: shardsOrnament,
    'dash-circle': dashCircleOrnament,
    squares: squaresOrnament,
    streaks: streaksOrnament,
    petals: petalsOrnament,
    stamp: stampOrnament,
    rays: raysOrnament,
    underline: underlineOrnament,
    'dots-line': dotsLineOrnament,
    glints: glintsOrnament,
};

export const createOrnament: CreateOrnament = (spec, context) => {
    const kit = createKit(spec, context);
    const empty = context.amount <= 0;
    const draw = empty ? null : ORNAMENT_BUILDERS[spec.kind](kit);
    // 跟字触发的件可能比 enterAt + delay 更早（delay 为负）或更晚开始：以两者中较早的为窗口起点。
    const firstSung = kit.glyphs.reduce((min, glyph) => Math.min(min, glyph.sungAt), Number.POSITIVE_INFINITY);
    const from = Math.min(kit.start, firstSung) - 0.05;
    const update = (time: number) => {
        const visible = draw !== null && time >= from && time <= kit.end;
        kit.view.visible = visible;
        if (visible) draw!(time);
    };
    return {
        view: kit.view,
        update,
        destroy: () => kit.view.destroy({ children: true, context: true }),
    };
};
