import React from 'react';
import { Check, Download, Loader2, PackageOpen, X } from 'lucide-react';
import PonderSurfaceStateLayer, { PonderSurfaceBase, type PonderSurfaceStateRegistrar } from '../PonderSurfaceStateLayer';
import { LYRIC_EXPORT_GEOMETRY as E } from './lyricExport.geometry';
import { relativeRectStyle } from '../relativeRectStyle';
import type { PonderSurfaceDeclarations } from '../surfaceDeclarations';

// src/components/ponder/surfaces/command/lyricExport.surface.tsx
// 命令面板里「导出歌词缓存」那一页。
//
// 只画结构：三节各一个小标题；「导出范围」和「导出格式」是并排两张可多选的卡，
// 选中的卡描边加勾；LRC 的附带项是格式那一节右下一小块；开始按钮钉在底边操作栏。
// 运行中那一层只换操作栏：按钮变成转圈的取消，进度文字亮起来。

type SurfaceProps = {
    accent: string;
    line: string;
    outline: string;
    registerStateNode?: PonderSurfaceStateRegistrar;
};

type Rect = Parameters<typeof relativeRectStyle>[0];

const SectionHeading: React.FC<{ line: string; width: number }> = ({ line, width }) => (
    <span className="h-1 shrink-0 rounded-full opacity-45" style={{ width: `${width}%`, backgroundColor: line }} />
);

/** 一张可多选的卡：左上一行标题，下面一行说明，右上角一枚勾。 */
const OptionCard: React.FC<{ accent: string; line: string; outline: string; selected: boolean; width: number }> = ({
    accent, line, outline, selected, width,
}) => (
    <span
        className="relative flex flex-1 flex-col justify-center gap-1.5 rounded-lg border px-[5%]"
        style={selected
            ? { borderColor: accent, backgroundColor: `${accent}1a` }
            : { borderColor: outline }}
    >
        <span className="h-1.5 rounded-full" style={{ width: `${width}%`, backgroundColor: selected ? accent : line }} />
        <span className="h-1 w-[78%] rounded-full opacity-40" style={{ backgroundColor: line }} />
        <span
            className="absolute right-[5%] top-[12%] flex aspect-square h-2.5 items-center justify-center rounded-full border"
            style={selected ? { backgroundColor: accent, borderColor: accent } : { borderColor: outline }}
        >
            {selected && <Check className="h-1.5 w-1.5 text-white" strokeWidth={4} />}
        </span>
    </span>
);

const CardSection: React.FC<{
    rect: Rect;
    marker: string;
    accent: string;
    line: string;
    outline: string;
    extras?: boolean;
}> = ({ rect, marker, accent, line, outline, extras }) => (
    <div {...{ [marker]: true }} className="flex flex-col gap-[4%]" style={relativeRectStyle(rect)}>
        <SectionHeading line={line} width={16} />
        <span className="flex min-h-0 flex-1 gap-[3%]" style={extras ? { flexGrow: 1.6 } : undefined}>
            <OptionCard accent={accent} line={line} outline={outline} selected width={36} />
            <OptionCard accent={accent} line={line} outline={outline} selected width={44} />
        </span>
        {/* LRC 的附带项：缩在右半边，读起来就是「属于 LRC 那张卡的」。 */}
        {extras && (
            <span className="ml-auto flex min-h-0 w-[48.5%] flex-1 items-center gap-[6%] rounded-lg border px-[4%]" style={{ borderColor: outline }}>
                {[0, 1].map(index => (
                    <span key={index} className="flex items-center gap-1">
                        <span className="flex aspect-square h-2 items-center justify-center rounded-sm" style={{ backgroundColor: accent }}>
                            <Check className="h-1.5 w-1.5 text-white" strokeWidth={4} />
                        </span>
                        <span className="h-1 w-5 rounded-full" style={{ backgroundColor: line }} />
                    </span>
                ))}
            </span>
        )}
    </div>
);

const RunBar: React.FC<{ accent: string; line: string; outline: string; running?: boolean }> = ({ accent, line, outline, running }) => (
    <div
        data-ponder-lyric-export-run-row
        className="flex items-center justify-between gap-[4%] border-t px-[12%]"
        style={{ ...relativeRectStyle(E.run), borderColor: outline }}
    >
        <span className="h-1 w-[40%] rounded-full opacity-50" style={{ backgroundColor: running ? accent : line }} />
        {running ? (
            <span className="flex h-[56%] items-center gap-[6%] rounded-lg px-[3%]" style={{ backgroundColor: 'rgba(255,255,255,0.12)' }}>
                <Loader2 className="h-2.5 w-2.5 animate-spin opacity-70" />
                <X className="h-2.5 w-2.5 opacity-70" />
                <span className="h-1 w-6 rounded-full" style={{ backgroundColor: line }} />
            </span>
        ) : (
            <span className="flex h-[56%] items-center gap-[6%] rounded-lg px-[3%]" style={{ backgroundColor: accent }}>
                <Download className="h-2.5 w-2.5 text-white" />
                <span className="h-1 w-6 rounded-full bg-white/80" />
            </span>
        )}
    </div>
);

const Body: React.FC<SurfaceProps & { running?: boolean }> = ({ accent, line, outline, running }) => (
    <>
        <div
            className="flex items-center gap-[2%] rounded-xl border px-[3%]"
            style={{ ...relativeRectStyle(E.input), borderColor: outline, backgroundColor: 'rgba(255,255,255,0.03)' }}
        >
            <PackageOpen className="h-[42%] w-auto shrink-0 opacity-55" style={{ color: accent }} />
            <span className="h-1.5 w-[38%] rounded-full" style={{ backgroundColor: line, opacity: 0.6 }} />
        </div>
        <div className="flex flex-col justify-center gap-[22%]" style={relativeRectStyle(E.copy)}>
            <span className="h-1 w-[88%] rounded-full opacity-40" style={{ backgroundColor: line }} />
            <span className="h-1 w-[52%] rounded-full opacity-40" style={{ backgroundColor: line }} />
        </div>
        <CardSection marker="data-ponder-lyric-export-scope-group" rect={E.scope} accent={accent} line={line} outline={outline} />
        <CardSection marker="data-ponder-lyric-export-formats-group" rect={E.formats} accent={accent} line={line} outline={outline} extras />
        <div data-ponder-lyric-export-names-group className="flex flex-col gap-[8%]" style={relativeRectStyle(E.names)}>
            <SectionHeading line={line} width={14} />
            <span className="flex min-h-0 flex-1 items-center justify-between rounded-lg border px-[4%]" style={{ borderColor: outline }}>
                <span className="h-1.5 w-[30%] rounded-full" style={{ backgroundColor: line }} />
                <span className="flex h-[46%] max-h-3 aspect-[2/1] items-center justify-end rounded-full px-[1px]" style={{ backgroundColor: accent }}>
                    <span className="aspect-square h-[80%] rounded-full bg-white" />
                </span>
            </span>
        </div>
        <RunBar accent={accent} line={line} outline={outline} running={running} />
    </>
);

/** 批量导出歌词。运行中那一层只换底边操作栏：按钮变成取消，进度文字亮起来。 */
const PonderLyricExportSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-lyric-export-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <Body accent={accent} line={line} outline={outline} />
        </PonderSurfaceBase>
        <PonderSurfaceStateLayer state="running" registerStateNode={registerStateNode} replaces>
            <Body accent={accent} line={line} outline={outline} running />
        </PonderSurfaceStateLayer>
    </div>
);

export default {
    'lyric-export': PonderLyricExportSurface,
} satisfies PonderSurfaceDeclarations;
