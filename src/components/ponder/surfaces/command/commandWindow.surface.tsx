import React from 'react';
import { Command, GripVertical, Search, Volume2 } from 'lucide-react';
import type { PonderSurfaceDeclarations } from '../surfaceDeclarations';

// src/components/ponder/surfaces/command/commandWindow.surface.tsx
// 命令窗口的三副面孔：命令列表、播放队列、音量。三张都顶着同一条搜索栏。

const PaletteHeader: React.FC<{ line: string; outline: string }> = ({ line, outline }) => (
    <div data-ponder-palette-header className="flex h-[22%] items-center gap-2 border-b px-[4%]" style={{ borderColor: outline }}>
        <Search className="h-[34%] w-auto opacity-50" />
        <div className="h-[24%] flex-1 rounded-full" style={{ backgroundColor: line }} />
        <div className="h-[38%] w-[9%] rounded-full border" style={{ borderColor: outline }} />
    </div>
);

const PaletteContents: React.FC<{ line: string; outline: string }> = ({ line, outline }) => (
    <div className="absolute inset-0">
        <PaletteHeader line={line} outline={outline} />
        <div className="flex h-[78%] flex-col justify-evenly px-[4%] py-[2%]">
            {[78, 92, 68].map((width, index) => (
                <div key={width} className="flex h-[27%] min-h-0 items-center gap-[3%] rounded-lg px-[2%]" style={{ backgroundColor: index === 0 ? line : undefined }}>
                    <span className="flex aspect-square h-[68%] items-center justify-center rounded-md border" style={{ borderColor: outline }}>
                        <Command className="h-1/2 w-1/2 opacity-55" />
                    </span>
                    <span className="flex flex-1 flex-col gap-1">
                        <span className="h-1.5 rounded-full" style={{ width: `${width}%`, backgroundColor: line }} />
                        <span className="h-1 rounded-full opacity-70" style={{ width: `${Math.max(42, width - 24)}%`, backgroundColor: line }} />
                    </span>
                </div>
            ))}
        </div>
    </div>
);

const QueueContents: React.FC<{ line: string; outline: string; accent: string }> = ({ line, outline, accent }) => (
    <div className="absolute inset-0">
        <PaletteHeader line={line} outline={outline} />
        <div className="flex h-[78%] flex-col px-[4%] py-[2%]">
            {[82, 64, 74, 56].map((width, index) => (
                <div key={width} data-ponder-queue-row className="flex min-h-0 flex-1 items-center gap-2 border-b" style={{ borderColor: outline }}>
                    <GripVertical className="h-3 w-3 opacity-30" />
                    <span className="aspect-square h-[68%] rounded-md" style={{ backgroundColor: index === 0 ? accent : line, opacity: index === 0 ? 0.35 : 1 }} />
                    <span className="flex flex-1 flex-col gap-1.5">
                        <span className="h-1.5 rounded-full" style={{ width: `${width}%`, backgroundColor: line }} />
                        <span className="h-1 rounded-full opacity-65" style={{ width: `${Math.max(34, width - 28)}%`, backgroundColor: line }} />
                    </span>
                    <span className="h-4 w-4 rounded-full border" style={{ borderColor: outline }} />
                </div>
            ))}
        </div>
    </div>
);

const VolumeContents: React.FC<{ line: string; outline: string; accent: string }> = ({ line, outline, accent }) => (
    <div className="absolute inset-0">
        <PaletteHeader line={line} outline={outline} />
        <div className="flex h-[78%] flex-col justify-center gap-[16%] px-[10%]">
            <div className="flex items-center gap-3">
                <Volume2 className="h-5 w-5" style={{ color: accent }} />
                <div className="flex flex-1 flex-col gap-1.5">
                    <div className="h-2 w-[38%] rounded-full" style={{ backgroundColor: line }} />
                    <div className="h-1.5 w-[62%] rounded-full opacity-65" style={{ backgroundColor: line }} />
                </div>
                <div className="h-3 w-[13%] rounded-full" style={{ backgroundColor: line }} />
            </div>
            <div data-ponder-volume-track className="relative h-2 rounded-full" style={{ backgroundColor: line }}>
                <div className="absolute inset-y-0 left-0 w-[68%] rounded-full" style={{ backgroundColor: accent, opacity: 0.55 }} />
                <div className="absolute left-[68%] top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border" style={{ borderColor: outline, backgroundColor: accent }} />
            </div>
        </div>
    </div>
);

export default {
    palette: PaletteContents,
    queue: QueueContents,
    volume: VolumeContents,
} satisfies PonderSurfaceDeclarations;
