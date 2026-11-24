import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDownAZ, Layers, Redo2, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '../modal/settings/kit';
import ConfirmDialog from '../shared/ConfirmDialog';
import Sheet, { SheetButton } from '../shared/Sheet';
import PlaylistOrderLists, { OrderCheck } from './PlaylistOrderLists';
import {
    commitOrderDraft,
    insertStagedSongs,
    moveOrderSongs,
    redoOrderDraft,
    sortPlaylistByTitle,
    startOrderHistory,
    undoOrderDraft,
    type OrderDraft,
    type OrderSong,
} from './playlistOrderDraft';
import { OrderNounContext, useOrderText, type OrderNoun } from './orderText';

// Each opening edits its own snapshot. Only Save hands the finished order back to the playlist.
// Every edit is a step of the history: the header's undo and redo, and Ctrl+Z / Ctrl+Shift+Z, walk it.
interface Props {
    name: string;
    songs: readonly OrderSong[];
    isDaylight: boolean;
    onClose: () => void;
    onSave: (songIds: string[]) => Promise<boolean>;
    /** 排的是什么（缺省是歌）：排歌单本身时文案里的「歌」换成「歌单」。 */
    noun?: OrderNoun;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';

const HeaderIconButton = ({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) => (
    <Tooltip text={label} className="inline-flex">
        <button type="button" onClick={onClick} disabled={disabled} aria-label={label}
            className="st-t-fast grid h-8 w-8 place-items-center rounded-lg text-[color:var(--st-t2)] transition-[background-color,color,opacity] enabled:hover:bg-[var(--st-fill)] enabled:hover:text-[color:var(--st-t1)] disabled:cursor-default disabled:opacity-30"
        >
            {children}
        </button>
    </Tooltip>
);

export default function FoliaPlaylistOrderDialog(props: Props) {
    return (
        <OrderNounContext.Provider value={props.noun ?? 'songs'}>
            <OrderDialogBody {...props} />
        </OrderNounContext.Provider>
    );
}

function OrderDialogBody({ name, songs, isDaylight, onClose, onSave }: Props) {
    const { t, i18n } = useTranslation();
    const ot = useOrderText();
    const [history, setHistory] = useState(() => startOrderHistory({ list: songs, staged: [] }));
    const draft = history.present;
    const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
    const anchor = useRef<number | null>(null);
    const [confirmSort, setConfirmSort] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<'changed' | 'failed' | null>(null);
    const changed = draft.staged.length > 0 || draft.list.some((song, i) => song.id !== songs[i]?.id);
    // After a conflict this snapshot can never be saved again; the editor has to be reopened.
    const canSave = error !== 'changed' && draft.staged.length === 0 && changed;
    const allSelected = selected.size > 0 && selected.size === draft.list.length;
    const canUndo = history.past.length > 0 && !saving;
    const canRedo = history.future.length > 0 && !saving;

    // Selection only ever names songs in the list: staging, undo and redo drop the rest.
    const keepSelectionIn = (next: OrderDraft) => {
        const ids = new Set(next.list.map(song => song.id));
        setSelected(current => (Array.from(current).every(id => ids.has(id)) ? current : new Set(Array.from(current).filter(id => ids.has(id)))));
        anchor.current = null;
    };
    const commit = (edit: (current: OrderDraft) => OrderDraft) => {
        const next = edit(draft);
        setHistory(current => commitOrderDraft(current, next));
        keepSelectionIn(next);
    };
    const walk = (step: typeof undoOrderDraft) => {
        const next = step(history);
        if (next === history) return;
        setHistory(next);
        keepSelectionIn(next.present);
    };

    const walkRef = useRef(walk);
    walkRef.current = walk;
    const blockedRef = useRef(false);
    blockedRef.current = saving || confirmSort;
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (blockedRef.current || !(event.ctrlKey || event.metaKey) || event.altKey) return;
            const key = event.key.toLowerCase();
            const redo = key === 'y' || (key === 'z' && event.shiftKey);
            if (key !== 'z' && key !== 'y') return;
            event.preventDefault();
            event.stopPropagation();
            walkRef.current(redo ? redoOrderDraft : undoOrderDraft);
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, []);

    // A plain click toggles one song; Shift extends from the last plain click to this one.
    const toggle = (id: string, index: number, range: boolean) => {
        const from = anchor.current;
        if (range && from !== null) {
            const [start, end] = from < index ? [from, index] : [index, from];
            setSelected(current => new Set([...current, ...draft.list.slice(start, end + 1).map(song => song.id)]));
            return;
        }
        anchor.current = index;
        setSelected(current => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };
    const sort = () => {
        commit(current => sortPlaylistByTitle(current, i18n.language));
        setSelected(new Set());
        setConfirmSort(false);
    };
    const save = async () => {
        if (saving || !canSave) return;
        setSaving(true);
        setError(null);
        try {
            if (await onSave(draft.list.map(song => song.id))) onClose();
            else setError('changed');
        } catch (saveError) {
            console.warn('[FoliaPlaylistOrder] Failed to save playlist order', saveError);
            setError('failed');
        } finally {
            setSaving(false);
        }
    };

    const footerNote = error
        ? <span role="alert" className="text-[color:var(--st-err)]">{ot(error)}</span>
        : draft.staged.length > 0
            ? ot('finishStaging')
            : changed ? ot('unsaved') : undefined;

    return (
        <>
            <Sheet isOpen isDaylight={isDaylight} onClose={onClose} size="l" body="fill"
                title={ot('edit')}
                subtitle={<span className="select-none">{name} · {ot('songCount', { count: songs.length })}</span>}
                closeDisabled={saving}
                headerActions={<>
                    <HeaderIconButton label={`${ot('undo')}  ${MOD}Z`} disabled={!canUndo} onClick={() => walk(undoOrderDraft)}>
                        <Undo2 size={16} />
                    </HeaderIconButton>
                    <HeaderIconButton label={`${ot('redo')}  ${MOD}${isMac ? '⇧Z' : 'Shift+Z'}`} disabled={!canRedo} onClick={() => walk(redoOrderDraft)}>
                        <Redo2 size={16} />
                    </HeaderIconButton>
                    <span aria-hidden className="mx-1 h-4 w-px bg-[var(--st-line2)]" />
                </>}
                footerNote={footerNote && <span className="select-none">{footerNote}</span>}
                footer={<>
                    <SheetButton onClick={onClose} disabled={saving}>{t('status.cancel')}</SheetButton>
                    <SheetButton variant="primary" onClick={() => { void save(); }} disabled={saving || !canSave}>
                        {t(saving ? 'localPlaylistOrder.saving' : 'localMusic.save')}
                    </SheetButton>
                </>}
            >
                <div inert={saving} className="flex min-h-0 flex-1 select-none flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <button type="button" role="checkbox" aria-checked={allSelected ? true : selected.size > 0 ? 'mixed' : false}
                            disabled={draft.list.length === 0}
                            onClick={() => {
                                anchor.current = null;
                                setSelected(allSelected ? new Set() : new Set(draft.list.map(song => song.id)));
                            }}
                            className="st-t-fast mr-auto flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors enabled:hover:bg-[var(--st-fill)] disabled:opacity-40"
                        >
                            <OrderCheck checked={allSelected} mixed={selected.size > 0 && !allSelected} />
                            {selected.size > 0
                                ? <span>{ot('selectedCount', { count: selected.size })}</span>
                                : <span className="text-[color:var(--st-t2)]">{ot('selectAll')}</span>}
                        </button>
                        <SheetButton disabled={selected.size === 0} onClick={() => commit(current => moveOrderSongs(current, selected, 'stage'))}>
                            <Layers size={14} />{ot('stageSelected')}
                        </SheetButton>
                        <SheetButton disabled={songs.length < 2} onClick={() => setConfirmSort(true)}>
                            <ArrowDownAZ size={15} />{ot('sort')}
                        </SheetButton>
                    </div>
                    <PlaylistOrderLists draft={draft} selected={selected} onToggle={toggle}
                        onMove={(picked, destination) => commit(current => moveOrderSongs(current, picked, destination))}
                        onInsert={gap => commit(current => insertStagedSongs(current, gap))} />
                </div>
            </Sheet>
            <ConfirmDialog isOpen={confirmSort} isDaylight={isDaylight}
                title={ot('sortTitle')} description={ot('sortNotice', { count: songs.length })}
                confirmText={ot('sort')} onConfirm={sort} onClose={() => setConfirmSort(false)} />
        </>
    );
}
