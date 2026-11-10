import { useEffect, useRef, useState, type FC } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { glassSurface } from './LxPlatformPicker';

// src/components/lxmusic/LxCategoryPicker.tsx
// 歌单页的「分类组 + 标签」收进浮层。
//
// 原先这两行是两条横向芯片导轨（组一行、标签一行），一屏里同时躺着十几颗胶囊，
// 跟平台那一排挤在一起，正是用户说的「太乱」。现在收成一颗小胶囊，就贴在「当前平台」
// 右边同一个高度上：平时只显示「热门标签」这样的当前组，点开才铺开整棵目录——
// 上半层是组，下半层是这组的标签，选完自动收起，页面高度一格不动。
//
// 玻璃壳、定位、Esc/滚轮/点遮罩收起都跟平台浮层同一套（glassSurface + useGlass），
// 浮层挂 body，免得被横向滚动容器裁掉。

export type LxCategoryGroup = { title: string; tags: ReadonlyArray<{ id: string; name: string }> };

interface LxCategoryPickerProps {
    groups: ReadonlyArray<LxCategoryGroup>;
    /** 当前所在的组（找不到时由调用方兜底成第一组）。 */
    groupTitle: string;
    /** 当前选中的标签 id，'' 表示这一组的「全部」。 */
    tagId: string;
    onSelectGroup: (title: string) => void;
    onSelectTag: (tagId: string) => void;
    isDaylight?: boolean;
}

const SHEET_WIDTH = 292;
const MAX_SHEET_HEIGHT = 340;

export const LxCategoryPicker: FC<LxCategoryPickerProps> = ({
    groups,
    groupTitle,
    tagId,
    onSelectGroup,
    onSelectTag,
    isDaylight = false,
}) => {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
    const anchor = useRef<HTMLButtonElement | null>(null);

    const activeGroup = groups.find((group) => group.title === groupTitle) ?? groups[0] ?? null;
    const activeTagName = activeGroup?.tags.find((tag) => tag.id === tagId)?.name ?? '全部';

    const openSheet = (): void => {
        const el = anchor.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const left = Math.min(window.innerWidth - SHEET_WIDTH - 12, Math.max(12, rect.left + rect.width / 2 - SHEET_WIDTH / 2));
        const top = Math.round(rect.bottom + 8);
        setPos({ left, top, maxHeight: Math.max(160, Math.min(MAX_SHEET_HEIGHT, window.innerHeight - top - 16)) });
        setOpen(true);
    };

    useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') setOpen(false);
        };
        const onShift = (): void => setOpen(false);
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('resize', onShift);
        window.addEventListener('wheel', onShift, { passive: true });
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('resize', onShift);
            window.removeEventListener('wheel', onShift);
        };
    }, [open]);

    return (
        <>
            <button
                ref={anchor}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label="选择分类"
                onClick={() => (open ? setOpen(false) : openSheet())}
                data-glass
                data-glass-jelly
                data-glass-light
                data-lx-category-picker
                className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-all duration-300 cursor-pointer select-none whitespace-nowrap leading-none hover:scale-105"
                style={{ height: 26, ...glassSurface(isDaylight) }}
            >
                <span className="shrink-0 opacity-70">{activeGroup?.title ?? '分类'}</span>
                <span className="shrink-0 opacity-40">·</span>
                <span className="shrink-0 max-w-[72px] truncate">{activeTagName}</span>
                <ChevronDown
                    size={12}
                    style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.18s ease' }}
                />
            </button>
            {open && pos && createPortal(
                <div className="fixed inset-0 z-[90]" role="presentation" onClick={() => setOpen(false)}>
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label="选择分类"
                        onClick={(event) => event.stopPropagation()}
                        data-glass
                        data-glass-jelly
                        data-glass-light
                        data-lx-category-sheet
                        style={{
                            position: 'absolute',
                            left: pos.left,
                            top: pos.top,
                            width: SHEET_WIDTH,
                            maxHeight: pos.maxHeight,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                            padding: 10,
                            borderRadius: 16,
                            ...glassSurface(isDaylight),
                            backgroundColor: isDaylight ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)',
                            boxShadow: '0 18px 44px -18px rgba(0,0,0,0.6), 2px 2px 8px 2px rgba(40,40,40,0.35)',
                        }}
                    >
                        <div className="flex items-center justify-between px-1 text-[11px] opacity-55">
                            <span>选择分类</span>
                            {activeGroup && <span className="truncate pl-2">{activeGroup.tags.length} 个标签</span>}
                        </div>
                        <div className="flex flex-wrap gap-1" data-lx-cat-groups>
                            {groups.map((group) => {
                                const active = group.title === activeGroup?.title;
                                return (
                                    <button
                                        key={group.title}
                                        type="button"
                                        onClick={() => {
                                            if (!active) onSelectGroup(group.title);
                                        }}
                                        className="rounded-full px-2 text-[11.5px] leading-none transition-colors duration-150 hover:bg-white/10"
                                        style={{
                                            height: 24,
                                            color: 'var(--text-primary)',
                                            background: active
                                                ? (isDaylight ? 'rgba(0,0,0,0.12)' : 'rgba(127,127,127,0.22)')
                                                : 'transparent',
                                            opacity: active ? 1 : 0.7,
                                        }}
                                    >
                                        {group.title}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="h-px w-full" style={{ background: isDaylight ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.10)' }} />
                        <div
                            data-lx-cat-tags
                            className="grid gap-1 overflow-y-auto overscroll-contain"
                            style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
                        >
                            {activeGroup && [{ id: '', name: '全部' }, ...activeGroup.tags].map((tag) => {
                                const active = tag.id === tagId;
                                return (
                                    <button
                                        key={tag.id || '__all'}
                                        type="button"
                                        onClick={() => {
                                            if (active) {
                                                setOpen(false);
                                                return;
                                            }
                                            onSelectTag(tag.id);
                                            setOpen(false);
                                        }}
                                        className="flex items-center justify-center gap-1 rounded-[9px] px-1.5 text-[11.5px] leading-none transition-colors duration-150 hover:bg-white/10"
                                        style={{
                                            height: 28,
                                            color: 'var(--text-primary)',
                                            background: active
                                                ? (isDaylight ? 'rgba(0,0,0,0.12)' : 'rgba(127,127,127,0.22)')
                                                : 'transparent',
                                        }}
                                    >
                                        <span className="truncate">{tag.name}</span>
                                        {active && <Check size={11} className="shrink-0" />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
};

export default LxCategoryPicker;
