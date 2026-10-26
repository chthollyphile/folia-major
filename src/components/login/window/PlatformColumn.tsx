import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import type { OnlineProviderId, ProviderAccountSummary } from '../../../types/onlineMusic';
import { Tooltip } from '../../modal/settings/kit';
import { AccountPicture, PlatformMark, platformMarkOf } from '../PlatformMark';
import { rowStatus, type RowStatus } from '../platformRows';
import { filterRows } from './loginView';

// src/components/login/window/PlatformColumn.tsx
// 登录窗口里平台的那一列：每个平台一行（记号、名字和它下面的登录状态、已登录的头像），各行平分列的高，
// 选中的行左边有一道平台的颜色。一块高亮跟着指针和方向键在行
// 之间滑。点一行或者在高亮的行上按回车才是选中；方向键只移动高亮，不开始登录。够不着的平台是灰的，
// 不能选，悬停时说原因。从 12 个平台起上面有搜索框。窗口窄的时候它横在窗口上面，成一排。

/** 从这么多个平台起有搜索框。 */
const SEARCH_FROM = 12;

/**
 * 竖着的那一列里一行的高：平台们平分列的高，每行在 46 到 68 之间。平台少时行到 68 就不再长，下面留空；
 * 多到挤不下 46 就滚。
 */
const ROW_SIZE = 'min-h-[46px] max-h-[68px] flex-[1_1_0]';

/** 竖着的一行名字下面那一句：登录着的是谁，或者这个平台此刻的状态。 */
const RowNote: React.FC<{ row: ProviderAccountSummary; status: RowStatus }> = ({ row, status }) => {
    const { t } = useTranslation();
    if (status === 'signed-in') {
        return (
            <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] leading-4 text-[color:var(--st-t3)]">
                <i aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--st-ok)]" />
                <span className="truncate">{row.user?.nickname || t('login.rowSignedIn')}</span>
            </span>
        );
    }
    const text = status === 'ran-out' ? t('login.rowRanOut')
        : status === 'accountless' ? t('home.providerNoAccount')
            : status === 'off' ? t('home.providerNotConfigured') : t('login.rowSignedOut');
    return (
        <span className={`truncate text-[11.5px] leading-4 ${status === 'ran-out' ? 'text-[color:var(--st-warn)]' : 'text-[color:var(--st-t3)]'}`}>{text}</span>
    );
};

type PlatformColumnProps = {
    /** 排好顺序的平台。 */
    rows: ProviderAccountSummary[];
    chosenId: OnlineProviderId | null;
    onChoose: (provider: ProviderAccountSummary) => void;
    /** 'row'：横着一排，左右滚。 */
    lie: 'column' | 'row';
};

export const PlatformColumn: React.FC<PlatformColumnProps> = ({ rows, chosenId, onChoose, lie }) => {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const shown = rows.length >= SEARCH_FROM ? filterRows(rows, query) : rows;
    // 高亮在哪一行：指针或方向键指着的；都没有指着就是选中的那一行。
    const [pointed, setPointed] = useState<OnlineProviderId | null>(null);
    const lit = shown.find(row => row.providerId === pointed) ?? shown.find(row => row.providerId === chosenId) ?? null;
    const listRef = useRef<HTMLDivElement>(null);
    const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
    // 列表的哪一头后面还有行：那一头淡出。
    const [more, setMore] = useState({ before: false, after: false });
    const rowOf = (providerId: OnlineProviderId | null | undefined) => (
        providerId ? listRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(providerId)}"]`) ?? null : null
    );

    // 高亮那一块的位置和大小，每次画完从它所在的行量一遍（行的宽度跟着名字、头像和语言变）；数没变就不动。
    useLayoutEffect(() => {
        const row = rowOf(lit?.providerId);
        const next = row ? { x: row.offsetLeft, y: row.offsetTop, w: row.offsetWidth, h: row.offsetHeight } : null;
        setBox(current => (current?.x === next?.x && current?.y === next?.y && current?.w === next?.w && current?.h === next?.h ? current : next));
        // 依赖数组：只在高亮行、横竖排布、平台数量变化时才重新测量。
        // 无数组时登录状态变化引发行重排 → 量-写-量循环 → 黑屏（复现见 chthollyphile/folia-major#185）。
    }, [lit?.providerId, lie, shown.length, rows.length]);

    // 选中的行换了，把它滚进来。指针指着的行不滚：列表不在指针底下自己动，指针移开也不跳回去。
    useLayoutEffect(() => {
        rowOf(chosenId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [chosenId, lie]);

    const readMore = () => {
        const list = listRef.current;
        if (!list) return;
        const [at, room, all] = lie === 'column' ? [list.scrollTop, list.clientHeight, list.scrollHeight] : [list.scrollLeft, list.clientWidth, list.scrollWidth];
        const next = { before: at > 1, after: at + room < all - 1 };
        setMore(current => (current.before === next.before && current.after === next.after ? current : next));
    };
    // 行数变了、横竖换了，和列表自己的大小变了（窗口变宽变窄）的时候都重看一遍。
    useEffect(() => {
        readMore();
        const list = listRef.current;
        if (!list || typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(readMore);
        observer.observe(list);
        return () => observer.disconnect();
    }, [shown.length, lie]);

    // 横着的那一排：竖着滚的滚轮也让它左右走（它没有滚动条）。已经到了那一头就不拦：滚轮照常去滚窗口里的内容。
    useEffect(() => {
        const list = listRef.current;
        if (!list || lie !== 'row') return undefined;
        const onWheel = (event: WheelEvent) => {
            const room = list.scrollWidth - list.clientWidth;
            if (event.deltaX !== 0 || event.deltaY === 0 || room <= 0) return;
            if (event.deltaY < 0 ? list.scrollLeft <= 0 : list.scrollLeft >= room - 1) return;
            list.scrollLeft += event.deltaY;
            event.preventDefault();
        };
        list.addEventListener('wheel', onWheel, { passive: false });
        return () => list.removeEventListener('wheel', onWheel);
    }, [lie]);

    const canChoose = (row: ProviderAccountSummary) => rowStatus(row) !== 'off';
    const handleKeyDown = (event: React.KeyboardEvent) => {
        // 搜索框里左右键、Home、End 和空格是打字用的，不是移动高亮。
        const inField = event.target instanceof HTMLInputElement;
        const choosable = shown.filter(canChoose);
        const at = lit ? choosable.findIndex(row => row.providerId === lit.providerId) : -1;
        const to = event.key === 'ArrowDown' || (!inField && event.key === 'ArrowRight') ? at + 1
            : event.key === 'ArrowUp' || (!inField && event.key === 'ArrowLeft') ? at - 1
                : inField ? null : event.key === 'Home' ? 0 : event.key === 'End' ? choosable.length - 1 : null;
        if (to !== null) {
            const next = choosable[Math.max(0, Math.min(choosable.length - 1, to))];
            if (next) {
                setPointed(next.providerId);
                // 键盘移过去的行要看得见。
                rowOf(next.providerId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
            event.preventDefault();
        } else if (event.key === 'Enter' || (!inField && event.key === ' ')) {
            const target = lit ?? shown.find(canChoose);
            if (target && canChoose(target)) onChoose(target);
            event.preventDefault();
        }
    };

    const fade = (more.before || more.after) ? `linear-gradient(${lie === 'column' ? 'to bottom' : 'to right'}, ${more.before ? 'transparent, #000 30px' : '#000'}, ${more.after ? '#000 calc(100% - 30px), transparent' : '#000'})` : undefined;
    const stateText = (status: ReturnType<typeof rowStatus>): string | null => (
        status === 'signed-in' ? t('login.rowSignedIn') : status === 'ran-out' ? t('login.rowRanOut') : status === 'off' ? t('home.providerNotConfigured') : null
    );

    return (
        <div className={`flex min-h-0 min-w-0 ${lie === 'column' ? 'h-full w-full flex-col' : 'flex-col'}`}>
            {rows.length >= SEARCH_FROM && (
                <label className="st-t-fast mb-1.5 flex h-8 shrink-0 items-center gap-2 rounded-lg bg-[var(--st-fill)] px-2.5 text-[color:var(--st-t3)] transition-shadow focus-within:shadow-[inset_0_0_0_1.5px_var(--st-line2)]">
                    <Search size={14} className="shrink-0" />
                    <input
                        value={query}
                        onChange={event => { setQuery(event.target.value); setPointed(null); }}
                        onKeyDown={handleKeyDown}
                        placeholder={t('login.searchPlatforms')}
                        aria-label={t('login.searchPlatforms')}
                        className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-[color:var(--st-t1)] outline-none placeholder:text-[color:var(--st-t3)]"
                    />
                </label>
            )}
            <div
                ref={listRef}
                role="listbox"
                tabIndex={0}
                aria-label={t('home.onlineProvider')}
                aria-activedescendant={lit ? `login-row-${lit.providerId}` : undefined}
                onKeyDown={handleKeyDown}
                onScroll={readMore}
                onMouseLeave={() => setPointed(null)}
                className={`relative min-h-0 rounded-lg outline-none ${lie === 'column' ? 'st-scroll flex flex-1 flex-col overflow-y-auto overscroll-contain' : 'login-row-scroll flex gap-1 overflow-x-auto overscroll-x-contain'}`}
                style={fade ? { WebkitMaskImage: fade, maskImage: fade } : undefined}
            >
                <div
                    aria-hidden
                    className="st-t-move pointer-events-none absolute left-0 top-0 rounded-lg bg-[var(--st-fill2)] transition-[transform,width,opacity]"
                    style={box ? { width: box.w, height: box.h, transform: `translate(${box.x}px, ${box.y}px)`, opacity: 1 } : { opacity: 0 }}
                />
                {shown.map(row => {
                    const status = rowStatus(row);
                    const state = stateText(status);
                    const name = row.shortName || row.displayName;
                    const chosen = row.providerId === chosenId;
                    const bright = chosen || row.providerId === lit?.providerId;
                    const tall = lie === 'column';
                    const item = (
                        <div
                            id={`login-row-${row.providerId}`}
                            data-row={row.providerId}
                            role="option"
                            // 黄点和头像是画出来的：读屏的人从这一句知道这一行是已登录、登录失效还是不能选。
                            aria-label={state ? `${name} · ${state}` : undefined}
                            aria-selected={chosen}
                            aria-disabled={status === 'off' || undefined}
                            onMouseEnter={() => { if (status !== 'off') setPointed(row.providerId); }}
                            onClick={() => { if (status !== 'off') onChoose(row); }}
                            className={`st-t-fast relative flex items-center rounded-lg transition-colors ${tall ? `${ROW_SIZE} w-full gap-3 px-2.5` : 'h-9 max-w-[168px] shrink-0 gap-2.5 px-2'} ${status === 'off' ? 'cursor-default opacity-[0.42]' : 'cursor-pointer'} ${bright ? 'text-[color:var(--st-t1)]' : 'text-[color:var(--st-t2)]'}`}
                        >
                            {/* 选中的那一行左边一道平台的颜色：高亮跟着指针走，这一道留在选中的行上。 */}
                            {tall && (
                                <i
                                    aria-hidden
                                    className={`st-t-fast absolute left-0 top-1/2 h-[38%] w-[3px] -translate-y-1/2 rounded-full transition-opacity ${chosen ? 'opacity-100' : 'opacity-0'}`}
                                    style={{ background: platformMarkOf(row.providerId, row.shortName).color }}
                                />
                            )}
                            <PlatformMark providerId={row.providerId} label={row.shortName} size={tall ? 30 : 22} ranOut={status === 'ran-out'} />
                            {tall ? (
                                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                    <span className="truncate text-[13px] font-medium leading-[18px]">{name}</span>
                                    <RowNote row={row} status={status} />
                                </span>
                            ) : (
                                <span className="min-w-0 flex-1 truncate text-[13px]">{name}</span>
                            )}
                            {status === 'signed-in' && row.user && <AccountPicture user={row.user} size={tall ? 24 : 18} />}
                        </div>
                    );
                    return status === 'off'
                        ? <Tooltip key={row.providerId} text={t('home.providerNotConfigured')} className={tall ? `flex ${ROW_SIZE}` : 'shrink-0'}>{item}</Tooltip>
                        : <React.Fragment key={row.providerId}>{item}</React.Fragment>;
                })}
                {shown.length === 0 && (
                    <p className="py-6 text-center text-[13px] text-[color:var(--st-t3)]">{t('login.noPlatformMatch')}</p>
                )}
            </div>
        </div>
    );
};

export default PlatformColumn;
