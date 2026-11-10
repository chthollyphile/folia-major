import React from 'react';
import { Check, FileAudio, Music, Search, X } from 'lucide-react';
import PonderSurfaceStateLayer, { PonderSurfaceBase } from '../PonderSurfaceStateLayer';
import { LYRIC_MATCH_GEOMETRY as G, LYRIC_MATCH_ROW_COUNT, lyricMatchRowRect } from './lyricMatch.geometry';
import { relativeRectStyle } from '../relativeRectStyle';
import type { PonderSurfaceDeclarations, PonderSurfaceProps as SurfaceProps } from '../surfaceDeclarations';

// src/components/ponder/surfaces/panel/lyricMatch.surface.tsx
// 匹配歌词的窗口：左边歌词来源、搜索和结果，右边选中的那一条和它的歌词预览，底边取消和保存。
//
// 画了三幅，后两幅各自替换第一幅：刚打开、还没有选（保存灰着，预览是空的）；选中了第一条
// （那一行描着边，右边换成它的封面和名字，预览里有歌词）；给本地文件匹配时选中第一条
// （多出文件名、三个开关、歌词来自哪里和底边左端的按钮）。

type Paint = Pick<SurfaceProps, 'accent' | 'line' | 'outline'>;

/** 每一条结果的歌名有多长（占一行的几成）。 */
const ROW_NAME_WIDTHS = [22, 14, 20, 16];

/** 本地文件的三个开关：封面、元数据、歌词。这里画的是封面和歌词开着、元数据关着。 */
const SWITCHES_ON = [true, false, true];

/**
 * 整个窗口。picked：选中了第一条。local：正在匹配的是本地文件，多出只有它才有的那几样。
 */
const MatchWindow: React.FC<Paint & { picked?: boolean; local?: boolean }> = ({ picked, local, accent, line, outline }) => (
    <>
        <span className="flex flex-col justify-between" style={relativeRectStyle(G.heading)}>
            <span className="h-[26%] w-[34%] rounded-full" style={{ backgroundColor: line, opacity: 0.95 }} />
            <span className="h-[14%] w-[22%] rounded-full opacity-60" style={{ backgroundColor: line }} />
            <span className="flex h-[16%] items-center gap-[2.5%]" style={{ visibility: local ? undefined : 'hidden' }}>
                <FileAudio className="h-full w-auto shrink-0 opacity-45" />
                <span className="h-[70%] w-[62%] rounded-full opacity-40" style={{ backgroundColor: line }} />
            </span>
        </span>
        <X className="opacity-60" style={relativeRectStyle(G.close)} />
        <span className="absolute inset-x-0 h-px" style={{ top: `${G.header.height * 100}%`, backgroundColor: line }} />
        <span
            className="absolute left-[62%] w-px"
            style={{ top: `${G.header.height * 100}%`, bottom: `${G.footer.height * 100}%`, backgroundColor: line }}
        />

        {/* 歌词来源：一排文字，选中的那个下面有一道线。 */}
        <span data-ponder-lyric-match-sources className="flex items-stretch gap-[7%]" style={relativeRectStyle(G.sources)}>
            {[24, 20, 19, 22].map((width, index) => (
                <span key={index} className="relative flex items-center" style={{ width: `${width}%` }}>
                    <span className="h-[20%] w-full rounded-full" style={{ backgroundColor: index === 0 ? accent : outline }} />
                    {index === 0 && <span className="absolute inset-x-0 bottom-0 h-[6%] rounded-full" style={{ backgroundColor: accent }} />}
                </span>
            ))}
        </span>

        {/* 搜索：一条输入框，右边一颗按钮。 */}
        <span data-ponder-lyric-match-search className="flex items-stretch gap-[2%]" style={relativeRectStyle(G.search)}>
            <span className="flex min-w-0 flex-1 items-center gap-[3%] rounded-xl px-[2.5%]" style={{ backgroundColor: line }}>
                <Search className="h-[38%] w-auto shrink-0 opacity-50" />
                <span className="h-[12%] w-[46%] rounded-full" style={{ backgroundColor: outline }} />
            </span>
            <span className="flex w-[10%] shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${accent}33` }}>
                <span className="h-[12%] w-[48%] rounded-full" style={{ backgroundColor: accent }} />
            </span>
        </span>

        {/* 结果：小封面，歌名和它旁边的相似度，下面歌手和专辑；选中的那一条描边，右端一个勾。 */}
        <div data-ponder-lyric-match-results style={relativeRectStyle(G.results)}>
            {Array.from({ length: LYRIC_MATCH_ROW_COUNT }, (_, index) => {
                const chosen = Boolean(picked) && index === 0;
                return (
                    <span
                        key={index}
                        data-ponder-lyric-match-row
                        className="flex items-center gap-[2.5%] rounded-lg px-[2%]"
                        style={{
                            ...relativeRectStyle(lyricMatchRowRect(index)),
                            backgroundColor: chosen ? `${accent}26` : line,
                            boxShadow: chosen ? `inset 0 0 0 1px ${accent}` : undefined,
                        }}
                    >
                        <span className="aspect-square h-[60%] shrink-0 rounded-md" style={{ backgroundColor: outline }} />
                        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                            <span className="flex items-center gap-[2.5%]">
                                <span className="h-1 rounded-full" style={{ width: `${ROW_NAME_WIDTHS[index]}%`, backgroundColor: outline }} />
                                <span className="h-1.5 w-[5%] rounded-sm" style={{ backgroundColor: `${accent}66` }} />
                                {/* 时长对得上的那一枚，只有本地文件的结果旁边有。 */}
                                {local && index === 0 && <span className="h-1.5 w-[8%] rounded-sm opacity-60" style={{ backgroundColor: 'var(--st-ok)' }} />}
                            </span>
                            <span className="h-0.5 w-[30%] rounded-full opacity-70" style={{ backgroundColor: outline }} />
                        </span>
                        {chosen && <Check className="h-[26%] w-auto shrink-0" style={{ color: accent }} />}
                    </span>
                );
            })}
        </div>

        <span
            data-ponder-lyric-match-cover
            className="flex items-center justify-center rounded-xl"
            style={{ ...relativeRectStyle(G.cover), backgroundColor: picked ? `${accent}66` : line }}
        >
            <Music className="h-[26%] w-auto opacity-45" />
        </span>
        {local && (
            <span data-ponder-lyric-match-switches className="flex items-center justify-between" style={relativeRectStyle(G.switches)}>
                {SWITCHES_ON.map((on, index) => (
                    <span key={index} className="flex h-full w-[27%] items-center gap-[14%]">
                        <span className="aspect-square h-[38%] shrink-0 rounded-full" style={{ backgroundColor: on ? accent : outline }} />
                        <span className="h-[20%] min-w-0 flex-1 rounded-full" style={{ backgroundColor: on ? accent : outline }} />
                    </span>
                ))}
            </span>
        )}
        <span className="flex flex-col items-center justify-between" style={relativeRectStyle(G.names)}>
            <span className="h-[20%] w-[40%] rounded-full" style={{ backgroundColor: line, opacity: 0.95 }} />
            <span className="h-[15%] w-[30%] rounded-full opacity-70" style={{ backgroundColor: line }} />
            <span className="h-[13%] w-[38%] rounded-full opacity-50" style={{ backgroundColor: line }} />
        </span>
        {local && (
            <span className="flex items-center justify-center gap-[8%]" style={relativeRectStyle(G.status)}>
                <span className="h-[26%] w-[18%] rounded-full opacity-60" style={{ backgroundColor: line }} />
                <span className="flex h-full w-[54%] items-center justify-center rounded-full" style={{ backgroundColor: `${accent}33` }}>
                    <span className="h-[22%] w-[62%] rounded-full" style={{ backgroundColor: accent }} />
                </span>
            </span>
        )}

        {/* 歌词预览：选了才有。当前一句走到哪儿亮到哪儿，下面一行小字，角上标着这份歌词带什么。 */}
        <span data-ponder-lyric-match-lyrics className="rounded-xl" style={{ ...relativeRectStyle(G.lyrics), boxShadow: `inset 0 0 0 1px ${line}` }}>
            {picked ? (
                <>
                    <span className="absolute right-[3%] top-[9%] h-[13%] w-[13%] rounded-sm opacity-50" style={{ backgroundColor: 'var(--st-ok)' }} />
                    <span className="absolute inset-x-[12%] top-[38%] flex h-[40%] flex-col items-center justify-between">
                        <span className="relative h-[24%] w-[72%] overflow-hidden rounded-full" style={{ backgroundColor: outline }}>
                            <span className="absolute inset-y-0 left-0 w-[24%]" style={{ backgroundColor: accent }} />
                        </span>
                        <span className="h-[16%] w-[42%] rounded-full opacity-60" style={{ backgroundColor: 'var(--st-ok)' }} />
                    </span>
                </>
            ) : (
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-[10%]">
                    <Music className="h-[22%] w-auto opacity-40" />
                    <span className="h-[7%] w-[36%] rounded-full opacity-50" style={{ backgroundColor: line }} />
                </span>
            )}
        </span>

        <span className="absolute inset-x-0 h-px" style={{ bottom: `${G.footer.height * 100}%`, backgroundColor: line }} />
        {local && (
            <span
                data-ponder-lyric-match-no-match
                className="flex items-center justify-center rounded-lg"
                style={{
                    ...relativeRectStyle(G.noMatch),
                    backgroundColor: 'color-mix(in srgb, var(--st-err) 12%, transparent)',
                    boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--st-err) 40%, transparent)',
                }}
            >
                <span className="h-[12%] w-[66%] rounded-full opacity-80" style={{ backgroundColor: 'var(--st-err)' }} />
            </span>
        )}
        <span className="flex items-center justify-center rounded-lg" style={{ ...relativeRectStyle(G.cancel), backgroundColor: line }}>
            <span className="h-[12%] w-[44%] rounded-full" style={{ backgroundColor: outline }} />
        </span>
        {/* 保存：没有选中任何一条时是灰的。 */}
        <span
            data-ponder-lyric-match-save
            className="flex items-center justify-center rounded-lg"
            style={{ ...relativeRectStyle(G.save), backgroundColor: accent, opacity: picked ? 1 : 0.45 }}
        >
            <span className="h-[12%] w-[44%] rounded-full" style={{ backgroundColor: 'var(--st-on-accent)' }} />
        </span>
    </>
);

const PonderLyricMatchSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => {
    const paint = { accent, line, outline };
    return (
        <div className="absolute inset-0 overflow-hidden" data-ponder-lyric-match-structure>
            <PonderSurfaceBase registerStateNode={registerStateNode}>
                <MatchWindow {...paint} />
            </PonderSurfaceBase>
            <PonderSurfaceStateLayer state="picked" registerStateNode={registerStateNode} replaces>
                <MatchWindow picked {...paint} />
            </PonderSurfaceStateLayer>
            <PonderSurfaceStateLayer state="local-file" registerStateNode={registerStateNode} replaces>
                <MatchWindow picked local {...paint} />
            </PonderSurfaceStateLayer>
        </div>
    );
};

export default {
    'lyric-match': PonderLyricMatchSurface,
} satisfies PonderSurfaceDeclarations;
