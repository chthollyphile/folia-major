// Copyright (c) 2026 chthollyphile
import type { Container } from 'pixi.js';
import type { Theme } from '../../../types';
import { createHanabiCredits, hasHanabiCredits, resolveHanabiCreditsFrame, type HanabiCredits } from './credits';
import type { CreditsFrame, SongMetadata } from './hanabiKernel';
import type { HanabiProgram } from './hanabiProgram';
import type { HanabiTextures, HanabiTuning, PixiModule } from './types';

// src/components/visualizer/hanabi/hanabiCreditsLayer.ts
// 运行时里的片尾卡层（同绘光的 lumiereCreditsLayer）：最后一句唱完前几秒才建，歌曲信息、主题、尺寸或 tuning 变了就作废，
// 下次需要时再建。纯音乐（lyricEndTime 为 null）与没有任何歌曲信息时没有片尾卡，歌词也不会淡出。

/** 最后一句唱完前多少秒开始预建。 */
const PREBUILD_SECONDS = 4;

const INACTIVE: CreditsFrame = { active: false, lyricAlpha: 1, lyricBlur: 0, posterAlpha: 0, posterOffsetY: 0, posterScale: 1 };

export interface HanabiCreditsMetadata {
    title?: string | null;
    artist?: string | null;
    album?: string | null;
}

export interface HanabiCreditsBuildContext {
    width: number;
    height: number;
    resolution: number;
    theme: Theme;
    metadata: HanabiCreditsMetadata;
    tuning: HanabiTuning;
    textures: HanabiTextures;
    icons: readonly string[];
}

const toSongMetadata = (metadata: HanabiCreditsMetadata): SongMetadata => ({
    title: metadata.title ?? null,
    artist: metadata.artist ?? null,
    album: metadata.album ?? null,
});

export class HanabiCreditsLayer {
    readonly holder: Container;
    private credits: HanabiCredits | null = null;
    private lyricEndTime = 0;

    constructor(private readonly pixi: PixiModule) {
        this.holder = new pixi.Container();
        this.holder.visible = false;
    }

    get built() {
        return this.credits !== null;
    }

    hasMetadata(metadata: HanabiCreditsMetadata) {
        return hasHanabiCredits(toSongMetadata(metadata));
    }

    /** 片尾时间线帧；没有片尾卡时恒为 inactive（歌词不淡出）。 */
    resolveFrame(time: number, program: HanabiProgram, metadata: HanabiCreditsMetadata): CreditsFrame {
        if (program.lyricEndTime === null || !this.hasMetadata(metadata)) return INACTIVE;
        this.lyricEndTime = program.lyricEndTime;
        return resolveHanabiCreditsFrame(time, program.lyricEndTime);
    }

    needsBuild(time: number, program: HanabiProgram, metadata: HanabiCreditsMetadata) {
        return !this.credits
            && program.lyricEndTime !== null
            && time >= program.lyricEndTime - PREBUILD_SECONDS
            && this.hasMetadata(metadata);
    }

    build(context: HanabiCreditsBuildContext) {
        this.invalidate();
        this.credits = createHanabiCredits(this.pixi, {
            width: context.width,
            height: context.height,
            resolution: context.resolution,
            theme: context.theme,
            metadata: toSongMetadata(context.metadata),
            tuning: context.tuning,
            textures: context.textures,
            icons: context.icons,
        });
        this.holder.addChild(this.credits.view);
        this.holder.pivot.set(context.width / 2, context.height / 2);
    }

    /** 片尾卡以画面中心缩放、上下偏移；没激活时整层不画。 */
    update(time: number, frame: CreditsFrame, width: number, height: number) {
        const credits = this.credits;
        this.holder.visible = Boolean(credits) && frame.active && frame.posterAlpha > 0.002;
        if (!credits || !this.holder.visible) return;
        this.holder.alpha = frame.posterAlpha;
        this.holder.position.set(width / 2, height / 2 + frame.posterOffsetY * height);
        this.holder.scale.set(frame.posterScale);
        credits.update(time - this.lyricEndTime);
    }

    /** 作废当前片尾卡（下次需要时重建）。 */
    invalidate() {
        if (!this.credits) return;
        const credits = this.credits;
        this.credits = null;
        this.holder.removeChild(credits.view);
        credits.destroy();
        this.holder.visible = false;
    }

    destroy() {
        this.invalidate();
        this.holder.destroy({ children: true });
    }
}
