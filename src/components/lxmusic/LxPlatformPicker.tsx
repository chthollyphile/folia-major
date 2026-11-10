import { useEffect, useRef, useState, type CSSProperties, type FC, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { LX_PUBLIC_PLATFORMS, type LxPublicPlatform } from '../../services/onlineMusic/lxmusic/lxFacade';

// src/components/lxmusic/LxPlatformPicker.tsx
// 洛雪那几家平台（网易云 / QQ / 酷狗 / 酷我，外加「全部平台」）的统一选择器。
//
// 之前每家页面都把这五颗胶囊平铺成一整排：横向占一行高度，五颗挤在一起看着乱，
// 卡片流还被往下压。现在收成一颗「当前平台」胶囊，点开才在浮层里铺开，选完自动收起，
// 页面排版一点不动。歌单页、推荐页、专辑页共用这一个组件，免得几处长得不一样。
//
// 胶囊与浮层都挂全局那套液态玻璃（data-glass / -jelly / -light + 页头搜索框同款底子）：
// 半透明底 + 上下描边 + 外描边 + 投影，玻璃层由 shinoinject 的 useGlass 补上高光与折射。
// 浮层是 createPortal 挂到 body 的，Grid3D 那一次 useGlass 扫不到它，所以自己再扫一遍。

/** 「全部平台」没有单一品牌色，用一条灰度渐变占位。 */
const ALL_DOT = 'linear-gradient(135deg,#a3a3a3,#525252)';
const ALL_LABEL = '全部平台';

export type LxPlatformKey = LxPublicPlatform | 'all';

const platformLabel = (key: LxPlatformKey): string => (
    key === 'all' ? ALL_LABEL : (LX_PUBLIC_PLATFORMS.find((item) => item.key === key)?.label ?? key)
);

const platformDot = (key: LxPlatformKey): string => (
    key === 'all' ? ALL_DOT : (LX_PUBLIC_PLATFORMS.find((item) => item.key === key)?.color ?? ALL_DOT)
);

/** 和首页页头那排胶囊同一套玻璃底子（搜索框、视图胶囊用的就是这几行）。 */
export const glassSurface = (isDaylight: boolean): CSSProperties => ({
    backgroundColor: isDaylight ? 'rgba(255,255,255,0.42)' : 'rgba(0,0,0,0.42)',
    borderTop: isDaylight ? '1px solid rgba(0,0,0,0.08)' : '1px solid rgba(255,255,255,0.12)',
    borderBottom: isDaylight ? '1px solid rgba(0,0,0,0.08)' : '1px solid rgba(255,255,255,0.12)',
    outline: '1px solid rgba(40,40,40,0.2)',
    boxShadow: '2px 2px 8px 2px rgba(40,40,40,0.4)',
    color: isDaylight ? '#000' : '#fff',
});

export const LxPlatformPicker: FC<{
    keys: ReadonlyArray<LxPlatformKey>;
    value: LxPlatformKey;
    onSelect: (key: LxPlatformKey) => void;
    /** 浮层里那行小标题，默认「选择平台」。 */
    heading?: string;
    /** 日间/夜间：决定玻璃底色与文字颜色，跟着首页主题走。 */
    isDaylight?: boolean;
    /** 紧跟在这颗胶囊右边、同处一行的另一颗触发器（歌单页的「分类」就是挂在这儿）。 */
    trailing?: ReactNode;
}> = ({ keys, value, onSelect, heading = '选择平台', isDaylight = false, trailing }) => {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
    const anchor = useRef<HTMLButtonElement | null>(null);

    // 条件渲染的面板只能等一次 commit 之后才被扫到：浮层一开，自己再挂一遍玻璃。

    // 面板挂到 body 上：这排胶囊大多处在横向滚动容器里，直接挂在里面会被裁掉。
    const openSheet = (): void => {
        const el = anchor.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const width = 224;
        // 贴着那颗胶囊居中，左右各留 12px；窄窗口时自动往里收。
        const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.left + rect.width / 2 - width / 2));
        setPos({ left, top: Math.round(rect.bottom + 8) });
        setOpen(true);
    };

    useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') setOpen(false);
        };
        // 页面一滚动/改窗口大小，锚点就变了：直接收起，比跟一个错位的面板好。
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
        <div className="w-full flex items-center justify-center gap-1.5 pt-0.5" data-lx-platform-picker>
            <button
                ref={anchor}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => (open ? setOpen(false) : openSheet())}
                data-glass
                data-glass-jelly
                data-glass-light
                className="snap-center shrink-0 inline-flex items-center justify-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-all duration-300 cursor-pointer select-none whitespace-nowrap leading-none hover:scale-105"
                data-lx-chip-height="26"
                style={{
                    height: 26,
                    ...glassSurface(isDaylight),
                }}
            >
                <span className="shrink-0 rounded-full" style={{ width: 7, height: 7, background: platformDot(value) }} />
                {platformLabel(value)}
                <ChevronDown
                    size={12}
                    style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.18s ease' }}
                />
            </button>
            {trailing}
            {open && pos && createPortal(
                <div className="fixed inset-0 z-[90]" role="presentation" onClick={() => setOpen(false)}>
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label={heading}
                        onClick={(event) => event.stopPropagation()}
                        data-glass
                        data-glass-jelly
                        data-glass-light
                        style={{
                            position: 'absolute',
                            left: pos.left,
                            top: pos.top,
                            width: 224,
                            padding: 8,
                            borderRadius: 16,
                            ...glassSurface(isDaylight),
                            backgroundColor: isDaylight ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)',
                            boxShadow: '0 18px 44px -18px rgba(0,0,0,0.6), 2px 2px 8px 2px rgba(40,40,40,0.35)',
                        }}
                    >
                        <div className="px-2 pt-0.5 pb-1.5 text-[11px] opacity-55">{heading}</div>
                        <div className="flex flex-col gap-0.5">
                            {keys.map((key) => {
                                const active = key === value;
                                return (
                                    <button
                                        key={key}
                                        type="button"
                                        onClick={() => {
                                            setOpen(false);
                                            if (!active) onSelect(key);
                                        }}
                                        className="flex w-full items-center gap-2 rounded-[10px] px-2 text-left text-[12.5px] leading-none transition-colors duration-150 hover:bg-white/10"
                                        style={{
                                            height: 34,
                                            color: 'var(--text-primary)',
                                            background: active ? (isDaylight ? 'rgba(0,0,0,0.10)' : 'rgba(127,127,127,0.18)') : 'transparent',
                                        }}
                                    >
                                        <span className="shrink-0 rounded-full" style={{ width: 8, height: 8, background: platformDot(key) }} />
                                        <span className="flex-1 truncate">{platformLabel(key)}</span>
                                        {active && <Check size={13} />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
};

export default LxPlatformPicker;
