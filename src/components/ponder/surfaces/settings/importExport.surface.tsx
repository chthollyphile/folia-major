import React from 'react';
import { AlertTriangle, Check, Copy, Download, Minus, Palette } from 'lucide-react';
import PonderSurfaceStateLayer, { PonderSurfaceBase } from '../PonderSurfaceStateLayer';
import { SettingsHeading as Heading, type PonderSettingsSurfaceProps as SurfaceProps } from './ponderSettingsParts';
import { IMPORT_EXPORT_GEOMETRY as G } from './importExport.geometry';
import { relativeRectStyle } from '../relativeRectStyle';
import type { PonderSurfaceDeclarations } from '../surfaceDeclarations';

// src/components/ponder/surfaces/settings/importExport.surface.tsx
// 设置 · 存储与备份里的「备份与导入」。
//
// 单独一个文件而不是并进 PonderAppearanceSettingsSurfaces：那三组都是「一卡几行开关」，
// 而这一组的主体是一块文本框加一排按钮，再加一个整屏的逐项确认框 —— 共用不了那边的小件，
// 挤进去只会让那个文件里多出一组谁也用不上的形状。

/**
 * 确认框里的一行改动：左边一颗勾选，中间是字段名，右边是「原值 → 新值」。
 *
 * `derived` 那种没有勾选框 —— 它是你没挑、但会被连带改掉的那些，勾不掉才是重点。
 */
const ChangeRow: React.FC<{
    line: string;
    outline: string;
    accent: string;
    width: number;
    derived?: boolean;
}> = ({ line, outline, accent, width, derived }) => (
    <span
        data-ponder-import-change-row
        data-ponder-import-derived={derived || undefined}
        className="flex items-center gap-[2%]"
    >
        {derived ? (
            <AlertTriangle className="h-2.5 w-2.5 shrink-0" style={{ color: '#f59e0b' }} />
        ) : (
            <span
                className="flex aspect-square h-2.5 shrink-0 items-center justify-center rounded-sm border"
                style={{ borderColor: outline, backgroundColor: `${accent}33` }}
            >
                <Check className="h-1.5 w-1.5" style={{ color: accent }} />
            </span>
        )}
        <span className="h-1 rounded-full" style={{ width: `${width}%`, backgroundColor: line }} />
        <Minus className="h-2 w-2 shrink-0 opacity-30" />
        <span className="h-1 w-[18%] rounded-full" style={{ backgroundColor: derived ? '#f59e0b' : accent, opacity: 0.8 }} />
    </span>
);

/**
 * 备份与导入。
 *
 * 结果层是这一组的重点：按下导入不会照单全收，先弹一个逐项对照框，按组列出
 * 「原值 → 新值」可以逐条勾；底下还有一截是你没勾、却会被连带改掉的那些。
 */
const PonderImportExportSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-import-export-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <Heading rect={G.heading} line={line} />
            <div className="rounded-xl border" style={{ ...relativeRectStyle(G.card), borderColor: outline }} />
            <div className="flex flex-col justify-center gap-[20%]" style={relativeRectStyle(G.copy)}>
                <span className="h-1.5 w-[30%] rounded-full" style={{ backgroundColor: line }} />
                <span className="h-1 w-[58%] rounded-full opacity-45" style={{ backgroundColor: line }} />
            </div>

            {/* 导出前先选带哪个主题：AI 的、自定义的、或者一个都不带。 */}
            <div data-ponder-import-theme-chips className="flex items-center gap-[3%]" style={relativeRectStyle(G.themeChips)}>
                {[0, 1, 2].map(index => (
                    <span
                        key={index}
                        data-ponder-import-theme-chip
                        className="flex h-[74%] items-center gap-[8%] rounded-lg border px-[3%]"
                        style={{
                            borderColor: index === 1 ? accent : outline,
                            backgroundColor: index === 1 ? `${accent}14` : undefined,
                        }}
                    >
                        <Palette className="h-2.5 w-2.5 shrink-0 opacity-70" style={index === 1 ? { color: accent } : undefined} />
                        <span className="h-1 w-8 rounded-full" style={{ backgroundColor: index === 1 ? accent : line }} />
                    </span>
                ))}
            </div>

            {/* 粘贴别人那串短码的地方，也是导出后短码出现的地方。 */}
            <div
                data-ponder-import-textarea
                className="flex flex-col justify-start gap-[10%] rounded-lg border p-[3%]"
                style={{ ...relativeRectStyle(G.textarea), borderColor: outline, backgroundColor: 'rgba(255,255,255,0.04)' }}
            >
                {[62, 78, 44].map(width => (
                    <span key={width} className="h-1 rounded-full opacity-35" style={{ width: `${width}%`, backgroundColor: line }} />
                ))}
            </div>

            <div data-ponder-import-export-buttons className="flex items-center gap-[5%]" style={relativeRectStyle(G.exportButtons)}>
                {[0, 1].map(index => (
                    <span
                        key={index}
                        className="flex h-full flex-1 items-center justify-center gap-[8%] rounded-lg"
                        style={{ backgroundColor: 'rgba(255,255,255,0.12)' }}
                    >
                        <Copy className="h-2.5 w-2.5 opacity-70" />
                        <span className="h-1 w-[40%] rounded-full" style={{ backgroundColor: line }} />
                    </span>
                ))}
            </div>
            {/* 导入单独摆在右端：这一排里只有它会改动本机的设置。 */}
            <span
                data-ponder-import-button
                className="flex items-center justify-center gap-[8%] rounded-lg border"
                style={{ ...relativeRectStyle(G.importButton), borderColor: accent, backgroundColor: `${accent}1f` }}
            >
                <Download className="h-2.5 w-2.5" style={{ color: accent }} />
                <span className="h-1 w-[36%] rounded-full" style={{ backgroundColor: accent }} />
            </span>
        </PonderSurfaceBase>

        {/* 按下导入先弹这个：按组摊开的逐项对照，勾哪条才改哪条。 */}
        <PonderSurfaceStateLayer state="import-plan" registerStateNode={registerStateNode} replaces>
            {/* 分组和衍生那两块的几何是「相对 dialog」的，所以它们必须画在这个框**里面** ——
                摆到外面去，百分比就按整块面板算，内容会从对话框两侧长出去。 */}
            <div
                data-ponder-import-dialog
                /* 描边走 inset box-shadow：1px 的 border 会把里面按百分比定位的两块各挪掉 1px。 */
                className="rounded-2xl"
                style={{ ...relativeRectStyle(G.dialog), boxShadow: `inset 0 0 0 1px ${outline}`, backgroundColor: 'rgba(0,0,0,0.45)' }}
            >
                <span className="absolute left-[6%] top-[6%] h-[5%] w-[38%] rounded-full" style={{ backgroundColor: line }} />
                <div data-ponder-import-groups className="flex flex-col justify-evenly" style={relativeRectStyle(G.dialogGroups)}>
                    {[['theme', 84], ['visualizer', 70], ['fonts', 62]].map(([group, width]) => (
                        <span key={group} className="flex flex-col gap-[8%]">
                            <span className="h-1 w-[22%] rounded-full opacity-55" style={{ backgroundColor: accent }} />
                            <ChangeRow line={line} outline={outline} accent={accent} width={Number(width) * 0.6} />
                        </span>
                    ))}
                </div>
                {/* 衍生改动：配置里根本没提、却会被连带改掉的那些，所以总是摊开、也勾不掉。 */}
                <div
                    data-ponder-import-derived-block
                    className="flex flex-col justify-evenly rounded-lg border px-[4%]"
                    style={{ ...relativeRectStyle(G.dialogDerived), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.10)' }}
                >
                    <ChangeRow line={line} outline={outline} accent={accent} width={52} derived />
                    <ChangeRow line={line} outline={outline} accent={accent} width={44} derived />
                </div>
            </div>
        </PonderSurfaceStateLayer>
    </div>
);

export default {
    'import-export-settings': PonderImportExportSurface,
} satisfies PonderSurfaceDeclarations;
