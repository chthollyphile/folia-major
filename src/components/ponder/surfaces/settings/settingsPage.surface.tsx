import React from 'react';
import { CircleHelp, Search, X } from 'lucide-react';
import type { PonderSurfaceDeclarations } from '../surfaceDeclarations';

// src/components/ponder/surfaces/settings/settingsPage.surface.tsx
// 设置窗口整体：左边一列是搜索框、分成四组的各页（界面、音乐、应用、高级）和最底下的帮助；
// 右边上面是这一页的名字和页内几组的名字，下面是这一页的几组设置，一组一张卡。

/** 左边那一列里四组各有几页：界面 3、音乐 2、应用 6、高级 2。 */
const NAV_GROUPS = [3, 2, 6, 2];

/** 右边那一页画几组，每组几行。第一组没有小标题。 */
const PAGE_GROUPS = [1, 3, 4];

const SettingsPageContents: React.FC<{ line: string; outline: string; accent: string }> = ({ line, outline, accent }) => (
    <div className="absolute inset-0 flex">
        <div data-ponder-settings-side className="flex w-[23%] flex-col gap-[1.1%] border-r p-[2.2%]" style={{ borderColor: outline }}>
            <span className="flex h-[6%] shrink-0 items-center gap-[6%] rounded-md px-[6%]" style={{ backgroundColor: line }}>
                <Search className="h-[46%] w-auto shrink-0 opacity-50" />
                <span className="h-[14%] w-[44%] rounded-full" style={{ backgroundColor: outline }} />
            </span>
            {NAV_GROUPS.map((count, group) => (
                <React.Fragment key={group}>
                    <span className="mt-[4%] h-[1.2%] w-[22%] shrink-0 rounded-full opacity-45" style={{ backgroundColor: line }} />
                    {Array.from({ length: count }, (_, index) => {
                        const active = group === 0 && index === 0;
                        return (
                            <span
                                key={index}
                                data-ponder-settings-nav-item
                                data-active={active || undefined}
                                className="flex h-[4.3%] shrink-0 items-center gap-[7%] rounded-md px-[6%]"
                                style={{ backgroundColor: active ? `${accent}33` : undefined }}
                            >
                                <span className="aspect-square h-[44%] shrink-0 rounded-sm" style={{ backgroundColor: active ? accent : line }} />
                                <span
                                    className="h-[16%] rounded-full"
                                    style={{ width: `${34 + ((group * 3 + index) % 4) * 9}%`, backgroundColor: active ? accent : line }}
                                />
                            </span>
                        );
                    })}
                </React.Fragment>
            ))}
            <span className="min-h-0 flex-1" />
            <span data-ponder-settings-help className="flex h-[4.3%] shrink-0 items-center gap-[7%] px-[6%]">
                <CircleHelp className="h-[60%] w-auto shrink-0 opacity-50" />
                <span className="h-[16%] w-[22%] rounded-full" style={{ backgroundColor: line }} />
            </span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
            <div data-ponder-settings-header className="relative flex h-[16%] shrink-0 flex-col justify-center gap-[18%] border-b px-[4.5%]" style={{ borderColor: outline }}>
                <span className="h-[14%] w-[9%] rounded-full" style={{ backgroundColor: line, opacity: 0.95 }} />
                <span className="flex h-[10%] items-stretch gap-[3%]">
                    {[9, 5, 9].map((width, index) => (
                        <span
                            key={index}
                            className="rounded-full"
                            style={{ width: `${width}%`, backgroundColor: index === 0 ? accent : line, opacity: index === 0 ? 1 : 0.7 }}
                        />
                    ))}
                </span>
                <X className="absolute right-[4%] top-[26%] h-[16%] w-auto opacity-50" />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-[3.5%] px-[4.5%] py-[3%]">
                {PAGE_GROUPS.map((rows, group) => (
                    <div key={group} data-ponder-settings-group className="flex min-h-0 flex-col gap-[6%]" style={{ flex: rows + 0.5 }}>
                        {group > 0 && <span className="h-1 w-[8%] shrink-0 rounded-full opacity-55" style={{ backgroundColor: line }} />}
                        <div className="flex min-h-0 flex-1 flex-col rounded-xl border px-[2.5%]" style={{ borderColor: outline }}>
                            {Array.from({ length: rows }, (_, row) => (
                                <span
                                    key={row}
                                    className={`flex min-h-0 flex-1 items-center justify-between ${row > 0 ? 'border-t' : ''}`}
                                    style={{ borderColor: outline }}
                                >
                                    <span className="h-1 rounded-full" style={{ width: `${14 + ((group + row) % 3) * 5}%`, backgroundColor: line }} />
                                    {(group + row) % 2 === 0
                                        ? <span className="h-2.5 w-[20%] rounded-md" style={{ backgroundColor: line }} />
                                        : <span className="h-2.5 w-5 rounded-full" style={{ backgroundColor: row === 1 ? accent : line, opacity: row === 1 ? 0.75 : 1 }} />}
                                </span>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    </div>
);

export default {
    'settings-page': SettingsPageContents,
} satisfies PonderSurfaceDeclarations;
