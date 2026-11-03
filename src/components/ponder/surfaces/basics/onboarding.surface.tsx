import React from 'react';
import { Lightbulb, Pause, Play } from 'lucide-react';
import PonderSurfaceStateLayer, { PonderSurfaceBase, type PonderSurfaceStateRegistrar } from '../PonderSurfaceStateLayer';
import { PONDER_ONBOARDING_GEOMETRY as G } from './onboarding.geometry';
import { relativeRectStyle } from '../relativeRectStyle';
import type { PonderSurfaceDeclarations } from '../surfaceDeclarations';

// src/components/ponder/surfaces/basics/onboarding.surface.tsx
// 入门教程的示意图：思索自己是怎么用的。
//
// 它不对应任何一个真实页面。入门教程要讲的是一套机制 —— 指针停在某个组件上会浮出提示、
// 按住 G 打开它、触屏上换成右下角那颗灯泡 —— 而这套机制没有「所在页面」可言。
// 之前这里借用的是通用页面轮廓，图上只有几个色块，字幕等于对着空白念。

type PonderOnboardingSurfaceProps = {
    accent: string;
    line: string;
    outline: string;
    registerStateNode?: PonderSurfaceStateRegistrar;
};

/** 提示胶囊：灯泡、两行字、一枚 G 键帽。和真实的 PonderHintCapsule 同构。 */
const HintCapsule: React.FC<{
    accent: string;
    line: string;
    outline: string;
    /** 长按进行中：擦除铺满，第二行换成「进入思索」。 */
    holding?: boolean;
}> = ({ accent, line, outline, holding }) => (
    <div
        data-ponder-onboarding-capsule
        className="flex items-center gap-[4%] overflow-hidden rounded-full border px-[4%]"
        style={{ ...relativeRectStyle(G.capsule), borderColor: outline, backgroundColor: 'rgba(24,24,27,0.94)' }}
    >
        {/* 长按时从左往右铺满的那道擦除。 */}
        <span
            data-ponder-onboarding-capsule-wipe
            className="absolute inset-y-0 left-0"
            style={{ width: holding ? '100%' : '0%', backgroundColor: accent, opacity: 0.22 }}
        />
        <Lightbulb className="relative h-[44%] w-auto shrink-0" style={{ color: accent }} />
        <span className="relative flex flex-1 flex-col gap-1">
            <span className="h-1.5 w-[58%] rounded-full" style={{ backgroundColor: line }} />
            <span className="h-1.5 w-[42%] rounded-full" style={{ backgroundColor: accent, opacity: holding ? 1 : 0.7 }} />
        </span>
        <span
            className="relative flex aspect-square h-[52%] shrink-0 items-center justify-center rounded-md border font-mono text-[9px]"
            style={{ borderColor: outline, color: accent }}
        >
            G
        </span>
    </div>
);

/** 三张卡加上下两条，一眼读得出「这是一页界面」。被指的是最右那张。 */
const PageShell: React.FC<{ accent: string; line: string; outline: string }> = ({ accent, line, outline }) => (
    <>
        <span className="rounded-full" style={{ ...relativeRectStyle(G.topBar), backgroundColor: line, opacity: 0.6 }} />
        {([
            ['data-ponder-onboarding-card-a', G.cardA, false],
            ['data-ponder-onboarding-card-b', G.cardB, false],
            ['data-ponder-onboarding-card-c', G.cardC, true],
        ] as const).map(([marker, rect, marked]) => (
            <span
                key={marker}
                {...{ [marker]: true }}
                className={`rounded-xl border${marked ? ' border-dashed' : ''}`}
                style={{
                    ...relativeRectStyle(rect),
                    borderColor: marked ? accent : outline,
                    backgroundColor: line,
                    opacity: marked ? 0.9 : 0.45,
                }}
            />
        ))}
        <span
            className="flex items-center gap-[3%] rounded-full border px-[3%]"
            style={{ ...relativeRectStyle(G.bottomBar), borderColor: outline, backgroundColor: 'rgba(255,255,255,0.04)' }}
        >
            <span className="flex aspect-square h-[54%] items-center justify-center rounded-full" style={{ backgroundColor: accent }}>
                <Pause className="h-1/2 w-1/2" style={{ color: 'rgba(9,9,11,0.85)' }} />
            </span>
            <span className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: line }} />
        </span>
    </>
);

const PonderOnboardingSurface: React.FC<PonderOnboardingSurfaceProps> = ({
    accent,
    line,
    outline,
    registerStateNode,
}) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-onboarding-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <PageShell accent={accent} line={line} outline={outline} />
            {/* 图上始终画出来：真实那颗露四秒就收，但示意图要能一直被指着讲。 */}
            <span
                data-ponder-onboarding-touch-bulb
                className="flex items-center justify-center rounded-full border"
                style={{
                    ...relativeRectStyle(G.touchBulb),
                    borderColor: outline,
                    backgroundColor: 'rgba(24,24,27,0.88)',
                    color: accent,
                }}
            >
                <Lightbulb className="h-1/2 w-1/2" />
            </span>
        </PonderSurfaceBase>

        {/* 指针停满 600ms：胶囊浮在那个组件旁边。 */}
        <PonderSurfaceStateLayer state="hint-shown" registerStateNode={registerStateNode}>
            <HintCapsule accent={accent} line={line} outline={outline} />
        </PonderSurfaceStateLayer>

        {/* 按住 G：擦除铺满，文案换成「进入思索」。 */}
        <PonderSurfaceStateLayer state="hint-holding" registerStateNode={registerStateNode} replaces="hint-shown">
            <HintCapsule accent={accent} line={line} outline={outline} holding />
        </PonderSurfaceStateLayer>

        {/* 教程打开之后的样子：一整屏接管，底下的界面退成轮廓。 */}
        <PonderSurfaceStateLayer state="ponder-open" registerStateNode={registerStateNode} replaces>
            <div
                data-ponder-onboarding-stage
                className="absolute inset-[4%] flex flex-col gap-[4%] rounded-[4%] border bg-zinc-950/96 p-[4%]"
                style={{ borderColor: outline }}
            >
                <span className="flex h-[10%] shrink-0 items-center gap-[2%]">
                    <Lightbulb className="h-full w-auto" style={{ color: accent }} />
                    <span className="h-[34%] w-[26%] rounded-full" style={{ backgroundColor: line }} />
                </span>
                <div className="relative min-h-0 flex-1">
                    <span className="absolute inset-x-[18%] inset-y-[10%] rounded-xl border border-dashed" style={{ borderColor: accent, opacity: 0.8 }} />
                    <span className="absolute inset-x-[26%] bottom-[16%] h-[18%] rounded-lg border" style={{ borderColor: outline, backgroundColor: 'rgba(24,24,27,0.94)' }} />
                </div>
                <span className="flex h-[9%] shrink-0 items-center gap-[2%]">
                    <Play className="h-[70%] w-auto opacity-55" />
                    <span className="relative h-1 flex-1 rounded-full" style={{ backgroundColor: line }}>
                        <span className="absolute inset-y-0 left-0 w-[38%] rounded-full" style={{ backgroundColor: accent }} />
                    </span>
                </span>
            </div>
        </PonderSurfaceStateLayer>
    </div>
);

export default {
    'ponder-onboarding': PonderOnboardingSurface,
} satisfies PonderSurfaceDeclarations;
