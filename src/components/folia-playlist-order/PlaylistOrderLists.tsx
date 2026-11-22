import { useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { ArrowDownToLine, ArrowUpToLine, Check, CornerDownRight, GripVertical, Layers, Minus, Music } from 'lucide-react';
import { List, type RowComponentProps } from 'react-window';
import { Tooltip } from '../modal/settings/kit';
import { SheetButton } from '../shared/Sheet';
import { orderSongTitle, type OrderDraft, type OrderSong } from './playlistOrderDraft';
import { useOrderText } from './orderText';

// The draggable staging card and the virtualized song list share the same insertion gaps.
// Every row stays on one line: cover, title, artist and album, duration.
const DRAG_TYPE = 'application/x-folia-playlist-order';
type DragSource = ReadonlySet<string> | 'staged';
type StartDrag = (event: DragEvent<HTMLElement>, source: DragSource, count: number) => void;

const ROW_HEIGHT = 48;
const STAGED_ROW_HEIGHT = 40;
const SELECTED_ROW = 'bg-[color-mix(in_srgb,var(--st-accent)_14%,transparent)]';
const ICON_BUTTON = 'st-t-fast grid h-7 w-7 shrink-0 place-items-center rounded-md transition-[background-color,color,opacity]';

const formatDuration = (ms: number | undefined): string => {
    if (!ms || !Number.isFinite(ms) || ms <= 0) return '';
    const total = Math.round(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** The kit-styled check mark; the row or label around it takes the click. */
export const OrderCheck = ({ checked, mixed = false }: { checked: boolean; mixed?: boolean }) => (
    <span aria-hidden className={`st-t-fast grid h-4 w-4 shrink-0 place-items-center rounded-[5px] transition-[background-color,box-shadow] ${checked || mixed
        ? 'bg-[var(--st-accent)] text-[color:var(--st-on-accent)]'
        : 'shadow-[inset_0_0_0_1.5px_var(--st-line2)]'}`}
    >
        {mixed ? <Minus size={11} strokeWidth={3} /> : checked && <Check size={11} strokeWidth={3} />}
    </span>
);

const Cover = ({ song, size }: { song: OrderSong; size: number }) => (
    <span className="grid shrink-0 place-items-center overflow-hidden rounded-md bg-[var(--st-fill)] text-[color:var(--st-t3)]" style={{ width: size, height: size }}>
        {song.coverUrl
            ? <img src={song.coverUrl} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />
            : <Music size={Math.round(size * 0.45)} />}
    </span>
);

const songMeta = (song: OrderSong): string => [song.artist, song.album].filter(Boolean).join(' · ');

interface ListsProps {
    draft: OrderDraft;
    selected: ReadonlySet<string>;
    onToggle: (id: string, index: number, range: boolean) => void;
    onMove: (picked: ReadonlySet<string>, destination: number | 'stage') => void;
    onInsert: (gap: number) => void;
}

type RowProps = Pick<ListsProps, 'draft' | 'selected' | 'onToggle' | 'onInsert'> & {
    gap: number | null;
    dragging: ReadonlySet<string> | null;
    startDrag: StartDrag;
};

const SongRow = ({ index, style, ariaAttributes, draft, selected, onToggle, onInsert, gap, dragging, startDrag }: RowComponentProps<RowProps>) => {
    const ot = useOrderText();
    const song = draft.list[index];
    const title = orderSongTitle(song);
    const meta = songMeta(song);
    const checked = selected.has(song.id);
    const toggle = (event: MouseEvent | KeyboardEvent) => onToggle(song.id, index, event.shiftKey);
    return (
        <div {...ariaAttributes} style={style} data-order-index={index} className="relative px-1.5">
            {gap === index && <DropLine edge="top" />}
            {gap === draft.list.length && index === gap - 1 && <DropLine edge="bottom" />}
            <div
                role="checkbox"
                aria-checked={checked}
                aria-label={title}
                tabIndex={0}
                onClick={toggle}
                onKeyDown={event => {
                    if (event.key !== ' ' && event.key !== 'Enter') return;
                    event.preventDefault();
                    toggle(event);
                }}
                className={`st-focus-inside st-t-fast group flex h-full cursor-pointer items-center gap-2.5 rounded-lg pl-1 pr-2 outline-none transition-[background-color,opacity] ${checked ? SELECTED_ROW : 'hover:bg-[var(--st-fill)]'} ${dragging?.has(song.id) ? 'opacity-35' : ''}`}
            >
                <Tooltip text={ot('dragSong')} className="inline-flex">
                    <span
                        draggable
                        onDragStart={event => startDrag(event, checked ? selected : new Set([song.id]), checked ? selected.size : 1)}
                        onClick={event => event.stopPropagation()}
                        className={`grid h-7 w-5 cursor-grab place-items-center text-[color:var(--st-t3)] transition-opacity active:cursor-grabbing ${checked ? '' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}`}
                    >
                        <GripVertical size={15} />
                    </span>
                </Tooltip>
                <OrderCheck checked={checked} />
                <span className="w-7 shrink-0 text-right text-xs tabular-nums text-[color:var(--st-t3)]">{index + 1}</span>
                <Cover song={song} size={32} />
                <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
                    <span className="max-w-[60%] shrink-0 truncate text-[13px] font-medium leading-5" title={title}>{title}</span>
                    {meta && <span className="min-w-0 flex-1 truncate text-xs text-[color:var(--st-t2)]" title={meta}>{meta}</span>}
                </span>
                <span className="w-10 shrink-0 text-right text-xs tabular-nums text-[color:var(--st-t3)]">{formatDuration(song.durationMs)}</span>
                {draft.staged.length > 0 && (
                    <Tooltip text={ot('insertBefore', { title })} className="inline-flex">
                        <button
                            type="button"
                            onClick={event => {
                                event.stopPropagation();
                                onInsert(index);
                            }}
                            aria-label={ot('insertBefore', { title })}
                            className={`${ICON_BUTTON} text-[color:var(--st-t3)] hover:bg-[var(--st-fill2)] hover:text-[color:var(--st-accent)]`}
                        >
                            <CornerDownRight size={15} />
                        </button>
                    </Tooltip>
                )}
            </div>
        </div>
    );
};

const DropLine = ({ edge }: { edge: 'top' | 'bottom' }) => (
    <span aria-hidden className={`pointer-events-none absolute inset-x-2 z-10 flex h-0.5 items-center ${edge === 'top' ? '-top-px' : '-bottom-px'}`}>
        <span className="h-2 w-2 shrink-0 rounded-full border-2 border-[var(--st-accent)] bg-[var(--st-card)]" />
        <span className="h-0.5 flex-1 rounded-full bg-[var(--st-accent)]" />
    </span>
);

const StagedRow = ({ index, style, ariaAttributes, songs }: RowComponentProps<{ songs: readonly OrderSong[] }>) => {
    const song = songs[index];
    const title = orderSongTitle(song);
    return (
        <div {...ariaAttributes} style={style} className="flex items-center gap-2.5 px-3">
            <Cover song={song} size={26} />
            <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] leading-[18px]" title={title}>{title}</span>
                {song.artist && <span className="block truncate text-[11px] leading-[15px] text-[color:var(--st-t3)]">{song.artist}</span>}
            </span>
        </div>
    );
};

// The upper and lower half of each visible row target its preceding and following gap.
const listGapAtPointer = (event: DragEvent, length: number): number => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-order-index]') : null;
    if (!row) return length;
    const { top, height } = row.getBoundingClientRect();
    return Number(row.dataset.orderIndex) + Number(event.clientY >= top + height / 2);
};

export default function PlaylistOrderLists({ draft, selected, onToggle, onMove, onInsert }: ListsProps) {
    const ot = useOrderText();
    const source = useRef<DragSource | null>(null);
    const ghost = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState<ReadonlySet<string> | null>(null);
    const [target, setTarget] = useState<number | 'stage' | null>(null);
    const finishDrag = () => {
        source.current = null;
        setDragging(null);
        setTarget(null);
    };
    const startDrag: StartDrag = (event, picked, count) => {
        event.dataTransfer.setData(DRAG_TYPE, 'move');
        event.dataTransfer.effectAllowed = 'move';
        source.current = picked;
        // The browser's own picture would only be the grip; the ghost names how many songs move.
        if (ghost.current) {
            ghost.current.textContent = ot('dragCount', { count });
            event.dataTransfer.setDragImage(ghost.current, 14, 14);
        }
        setDragging(picked === 'staged' ? null : picked);
    };
    // Accept only transfers started in this editor. Dropping outside the editor leaves the draft intact.
    const accept = (event: DragEvent, destination: number | 'stage', drop = false) => {
        const picked = source.current;
        if (!picked || !event.dataTransfer.types.includes(DRAG_TYPE) || (picked === 'staged' && destination === 'stage')) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        if (drop) {
            if (picked === 'staged') {
                if (typeof destination === 'number') onInsert(destination);
            } else {
                onMove(picked, destination);
            }
            finishDrag();
        } else {
            setTarget(destination);
        }
    };
    const hasStaged = draft.staged.length > 0;
    const stageTargeted = target === 'stage';
    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3 sm:flex-row" onDragEnd={finishDrag}
            onDragLeave={event => {
                if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setTarget(null);
            }}
        >
            <div
                aria-hidden
                ref={ghost}
                className="pointer-events-none fixed -left-[9999px] top-0 rounded-lg bg-[var(--st-accent)] px-2.5 py-1 text-xs font-medium text-[color:var(--st-on-accent)] shadow-[0_6px_16px_rgba(0,0,0,0.28)]"
            />
            <div className="st-card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-[var(--st-card)] shadow-[0_0_0_1px_var(--st-line)]"
                onDragOver={event => accept(event, listGapAtPointer(event, draft.list.length))}
                onDrop={event => accept(event, listGapAtPointer(event, draft.list.length), true)}
            >
                {draft.list.length > 0 ? (
                    <List aria-label={ot('list')} style={{ height: '100%', width: '100%' }} className="st-scroll min-h-0 flex-1 py-1.5"
                        rowCount={draft.list.length} rowHeight={ROW_HEIGHT} rowComponent={SongRow}
                        rowProps={{ draft, selected, onToggle, onInsert, gap: typeof target === 'number' ? target : null, dragging, startDrag }} />
                ) : (
                    <div className={`m-3 grid flex-1 place-items-center rounded-lg border border-dashed text-center text-xs text-[color:var(--st-t3)] ${target === 0 ? 'border-[var(--st-accent)]' : 'border-[var(--st-line2)]'}`}>
                        {ot('listEmpty')}
                    </div>
                )}
            </div>
            <div
                className={`st-card st-t-fast flex min-h-0 flex-col overflow-hidden rounded-xl bg-[var(--st-card)] transition-shadow sm:w-[248px] ${hasStaged ? 'h-[34%] sm:h-auto' : ''} ${stageTargeted
                    ? 'shadow-[0_0_0_1.5px_var(--st-accent)]'
                    : 'shadow-[0_0_0_1px_var(--st-line)]'}`}
                onDragOver={event => accept(event, 'stage')} onDrop={event => accept(event, 'stage', true)}
            >
                <div
                    draggable={hasStaged}
                    onDragStart={event => startDrag(event, 'staged', draft.staged.length)}
                    className={`flex shrink-0 items-center gap-2 px-3.5 pb-2 pt-3 ${hasStaged ? 'cursor-grab active:cursor-grabbing' : ''}`}
                >
                    <Layers size={15} className="text-[color:var(--st-t2)]" />
                    <span className="text-[13px] font-semibold">{ot('stageTitle')}</span>
                    <span className="rounded-full bg-[var(--st-fill)] px-1.5 text-[11px] leading-[18px] tabular-nums text-[color:var(--st-t2)]">{draft.staged.length}</span>
                    {hasStaged && (
                        <Tooltip text={ot('dragGroup')} className="ml-auto inline-flex">
                            <span className="grid h-6 w-5 place-items-center text-[color:var(--st-t3)]"><GripVertical size={15} /></span>
                        </Tooltip>
                    )}
                </div>
                {hasStaged ? (
                    <>
                        <p className="shrink-0 px-3.5 pb-2 text-[11px] leading-4 text-[color:var(--st-t3)]">{ot('insertHint')}</p>
                        <List style={{ height: '100%', width: '100%' }} className="st-scroll min-h-0 flex-1"
                            rowCount={draft.staged.length} rowHeight={STAGED_ROW_HEIGHT} rowComponent={StagedRow} rowProps={{ songs: draft.staged }} />
                        <div className="flex shrink-0 gap-2 border-t border-[var(--st-line)] p-2.5">
                            <div className="flex-1 [&>button]:w-full"><SheetButton onClick={() => onInsert(0)}><ArrowUpToLine size={14} />{ot('insertStart')}</SheetButton></div>
                            <div className="flex-1 [&>button]:w-full"><SheetButton onClick={() => onInsert(draft.list.length)}><ArrowDownToLine size={14} />{ot('insertEnd')}</SheetButton></div>
                        </div>
                    </>
                ) : (
                    <div className={`st-t-fast mx-3 mb-3 flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors ${stageTargeted
                        ? 'border-[var(--st-accent)] bg-[color-mix(in_srgb,var(--st-accent)_8%,transparent)]'
                        : 'border-[var(--st-line2)]'}`}
                    >
                        <Layers size={20} className="text-[color:var(--st-t3)]" />
                        <p className="text-xs leading-[18px] text-[color:var(--st-t3)]">{ot('stageHint')}</p>
                    </div>
                )}
            </div>
        </div>
    );
}
