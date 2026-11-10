import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TemperaLayerImage } from '../../../types';
import { Row, Value } from '../../modal/settings/kit';
import { DEFAULT_TEMPERA_LAYER_IMAGE, TEMPERA_MAX_LAYER_IMAGES } from '../../../types';
import {
    clearTemperaLayerImage,
    isSupportedTemperaLayerImageFile,
    prepareTemperaLayerImage,
    saveTemperaLayerImage,
    type StoredTemperaLayerImage,
} from '../../../services/temperaLayerImages';
import {
    createTemperaImageArchive,
    readTemperaImageArchiveFile,
    TemperaArchiveTooLargeError,
} from '../../../services/temperaImageArchive';
import { createSafeObjectUrl } from '../../../utils/blobGuards';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';
import { formatLocalDateStamp, sanitizeDownloadFileName } from '../../../utils/downloadFileName';
import TemperaImageLayerDialog, {
    isTemperaPoolWriteLocked,
    type TemperaPoolBusyAction,
} from './TemperaImageLayerDialog';
import { useTemperaLayerImageThumbnails } from './useTemperaLayerImageThumbnails';

// src/components/visualizer/tempera/TemperaImageLayerControls.tsx
// Summary row for the user's own canvas images (character art, logos, textures): a row of the
// settings kit with a strip of previews, and the way into the dialog where they are actually managed. The files go straight
// to IndexedDB; only ids and placement are written back to the tuning.
//
// Everything the dialog edits is held here as a draft and written to the tuning only when the
// dialog closes. Editing the live tuning instead meant a synchronous localStorage write and a
// global store update on every pointermove of a slider, which pinned a core; the card preview
// is what gives feedback during the edit, so nothing is lost by holding the commit back.
export interface TemperaImageLayerCommit {
    layerImages: TemperaLayerImage[];
    layerImageDepth: 'back' | 'front';
    layerImageFrequency: number;
}

interface TemperaImageLayerControlsProps {
    images: TemperaLayerImage[];
    depth: 'back' | 'front';
    frequency: number;
    rangeInputClass: string;
    isDaylight: boolean;
    /** One patch for the whole layer, so a session of edits costs a single store write. */
    onCommit: (next: TemperaImageLayerCommit) => void;
}

/**
 * The two ways the pool is refilled, and the wording each gets in the result toast. They are the
 * same two numbers either way - what landed and what did not - but sharing one line across a
 * drag-and-drop and a backup restore misdescribes one of them.
 */
const POOL_RESULT_WORDS = {
    add: {
        addedKey: 'options.temperaLayerImagesAdded',
        addedDefault: '已添加 {{count}} 张图片',
        notAddedKey: 'options.temperaLayerImagesNotAdded',
        notAddedDefault: '未添加 {{count}} 张图片',
    },
    import: {
        addedKey: 'options.temperaPoolImported',
        addedDefault: '已导入 {{count}} 张图片',
        notAddedKey: 'options.temperaPoolImportNotAdded',
        notAddedDefault: '未导入 {{count}} 张图片',
    },
} as const;

type PoolResultVerb = keyof typeof POOL_RESULT_WORDS;

const sameImages = (a: TemperaLayerImage[], b: TemperaLayerImage[]) => (
    a.length === b.length && a.every((image, index) => (
        image.id === b[index].id
        && image.align === b[index].align
        && image.verticalAlign === b[index].verticalAlign
        && image.scale === b[index].scale
        && image.opacity === b[index].opacity
    ))
);

const TemperaImageLayerControls: React.FC<TemperaImageLayerControlsProps> = ({
    images,
    depth,
    frequency,
    rangeInputClass,
    isDaylight,
    onCommit,
}) => {
    const { t } = useTranslation();
    const [isDialogOpen, setDialogOpen] = useState(false);
    const [draft, setDraft] = useState<TemperaImageLayerCommit>({
        layerImages: images,
        layerImageDepth: depth,
        layerImageFrequency: frequency,
    });
    // Files deleted in the draft. The record is only dropped from IndexedDB on commit, so a
    // removal is undone by simply not committing it.
    const [removedIds, setRemovedIds] = useState<string[]>([]);
    const [busy, setBusy] = useState<TemperaPoolBusyAction>('idle');
    const activeWriteAbortRef = useRef<AbortController | null>(null);

    const previewImages = isDialogOpen ? draft.layerImages : images;
    const thumbnails = useTemperaLayerImageThumbnails(previewImages);

    const open = useCallback(() => {
        setDraft({ layerImages: images, layerImageDepth: depth, layerImageFrequency: frequency });
        setRemovedIds([]);
        setDialogOpen(true);
    }, [depth, frequency, images]);

    const commit = useCallback(() => {
        // The dialog blocks its own close paths, but an outer unmount goes through none of them.
        // Its cleanup aborts the write and leaves the live tuning untouched.
        if (isTemperaPoolWriteLocked(busy)) return;
        setDialogOpen(false);
        void Promise.all(removedIds.map(id => clearTemperaLayerImage(id).catch(() => undefined)));
        setRemovedIds([]);
        const changed = draft.layerImageDepth !== depth
            || draft.layerImageFrequency !== frequency
            || !sameImages(draft.layerImages, images);
        if (changed) onCommit(draft);
    }, [busy, depth, draft, frequency, images, onCommit, removedIds]);

    // Closing the whole playground while the dialog is open must not strand an upload the user
    // already made in IndexedDB with nothing in the tuning pointing at it. Unmount only - keying
    // this on `isDialogOpen` would fire the same commit a second time on every ordinary close.
    const commitRef = useRef(commit);
    commitRef.current = commit;
    const isOpenRef = useRef(isDialogOpen);
    isOpenRef.current = isDialogOpen;
    // An outer settings close can unmount this component without going through ThemedDialog. Abort
    // first so an in-flight write rolls back its newly stored blobs; the locked commit then leaves
    // the unchanged live tuning alone.
    const isMountedRef = useRef(true);
    useEffect(() => {
        // StrictMode replays setup after its development-only cleanup, so restore the live marker.
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            activeWriteAbortRef.current?.abort();
            if (isOpenRef.current) commitRef.current();
        };
    }, []);

    // Files the pool cannot take are invisible otherwise: the strip looks exactly as it did, so
    // "three of your five files went in" has to be said rather than inferred. The toast carries
    // only the two counts - a mixed drop can be part unsupported, part over the cap, part
    // unreadable, and a one-line reason that is wrong misdirects - so the breakdown goes to the
    // console. `verb` only picks the wording: "imported" for a drop misdescribes what happened.
    const reportPoolResult = useCallback((
        verb: PoolResultVerb,
        added: number,
        notAdded: number,
        detail: Record<string, unknown>,
    ) => {
        // A run cancelled by unmount has been rolled back, so it has no result to report.
        if (!isMountedRef.current) return;
        const words = POOL_RESULT_WORDS[verb];
        const notes: string[] = [];
        // A batch where nothing landed has no plus side to state, and a leading "0 张" only
        // buries the one count that does matter.
        if (added > 0) {
            notes.push(t(words.addedKey, { defaultValue: words.addedDefault, count: added }));
        }
        if (notAdded > 0) {
            notes.push(t(words.notAddedKey, { defaultValue: words.notAddedDefault, count: notAdded }));
            console.info('[Tempera] canvas image pool left files out', detail);
        }
        setStatusMessage({ type: added === 0 ? 'error' : 'success', text: notes.join(' · ') });
    }, [t]);

    // Every way artwork reaches the pool - the footer button, its file input, a drop - ends up
    // here, which is what makes this the only place that can refuse a second run. Two overlapping
    // is not just a wasted pass: each reads the same free-slot count before either writes, so both
    // prepare files for slots the other is about to take, and the loser's tail stays in IndexedDB
    // as blobs no placement points at.
    const handleFiles = useCallback(async (files: File[]) => {
        if (files.length === 0 || busy !== 'idle') return;
        const abortController = new AbortController();
        activeWriteAbortRef.current = abortController;
        setBusy('adding');
        let saved: StoredTemperaLayerImage[] = [];
        try {
            const room = Math.max(0, TEMPERA_MAX_LAYER_IMAGES - draft.layerImages.length);
            const supported = files.filter(isSupportedTemperaLayerImageFile);
            const accepted = supported.slice(0, room);
            // `accepted` is what fit the free slots, so the supported tail behind it is the cap's
            // doing. Counting what was taken in and then lost instead always reads zero: preparing
            // a record only fails on a thumbnail it can live without.
            const overCap = supported.length - accepted.length;
            const unsupported = files.length - supported.length;
            if (accepted.length === 0) {
                reportPoolResult('add', 0, files.length, { total: files.length, unsupported, overCap });
                return;
            }
            const stored = await Promise.all(accepted.map(file => (
                prepareTemperaLayerImage(file).catch(error => {
                    console.error('[Tempera] canvas image could not be stored:', error);
                    return null;
                })
            )));
            const prepared = stored.filter((image): image is StoredTemperaLayerImage => image !== null);
            // Only what IndexedDB accepted may enter the pool. A refused write used to reach no
            // further than the console while the id still landed in the draft, so the pool showed
            // a picture it cannot resolve - an id with nothing behind it.
            if (abortController.signal.aborted) return;
            saved = (await Promise.all(prepared.map(image => (
                saveTemperaLayerImage(image)
                    .then(() => image)
                    .catch(error => {
                        console.error('[Tempera] canvas image could not be saved:', error);
                        return null;
                    })
            )))).filter((image): image is StoredTemperaLayerImage => image !== null);
            if (abortController.signal.aborted || !isMountedRef.current) {
                await Promise.all(saved.map(image => clearTemperaLayerImage(image.id).catch(() => undefined)));
                return;
            }
            setDraft(current => ({
                ...current,
                layerImages: [
                    ...current.layerImages,
                    ...saved.map(image => ({
                        ...DEFAULT_TEMPERA_LAYER_IMAGE,
                        id: image.id,
                        name: image.name,
                    })),
                ].slice(0, TEMPERA_MAX_LAYER_IMAGES),
            }));
            reportPoolResult(
                'add',
                saved.length,
                unsupported + overCap + (accepted.length - saved.length),
                {
                    total: files.length,
                    unsupported,
                    overCap,
                    // Taken in and then lost before a record existed: the file could not be read.
                    unreadable: accepted.length - prepared.length,
                    // A record was built but IndexedDB refused it, and nothing can resolve this id.
                    unsaved: prepared.length - saved.length,
                },
            );
        } finally {
            if (activeWriteAbortRef.current === abortController) activeWriteAbortRef.current = null;
            if (isMountedRef.current) setBusy('idle');
        }
    }, [busy, draft.layerImages.length, reportPoolResult]);

    const patch = useCallback((id: string, next: Partial<TemperaLayerImage>) => {
        setDraft(current => ({
            ...current,
            layerImages: current.layerImages.map(image => (image.id === id ? { ...image, ...next } : image)),
        }));
    }, []);

    const remove = useCallback((id: string) => {
        setDraft(current => ({
            ...current,
            layerImages: current.layerImages.filter(image => image.id !== id),
        }));
        setRemovedIds(current => (current.includes(id) ? current : [...current, id]));
    }, []);

    const clearAll = useCallback(() => {
        setDraft(current => ({ ...current, layerImages: [] }));
        setRemovedIds(current => Array.from(new Set([
            ...current,
            ...draft.layerImages.map(image => image.id),
        ])));
    }, [draft.layerImages]);

    const exportPool = useCallback(async () => {
        // Not a live path - the button's `disabled` already blocks this - but all three write
        // `busy`, and an asymmetry here is a second run waiting to be found.
        if (busy !== 'idle') return;
        setBusy('exporting');
        try {
            const archive = await createTemperaImageArchive({ layerImages: draft.layerImages });
            if (archive.exported === 0) throw new Error('Tempera pool export held no image');
            const url = createSafeObjectUrl(archive.blob);
            if (!url) throw new TypeError('Tempera pool export must produce a Blob');
            const link = document.createElement('a');
            link.href = url;
            link.download = `${sanitizeDownloadFileName(
                // Falls back to the shipped Chinese name: the key is new and a stale locale
                // file would otherwise name the file after the raw key.
                t('options.temperaExportBaseName') || '凝彩参数-画布图片备份',
            )}-${formatLocalDateStamp()}.zip`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 0);

            // A picture whose file has gone missing is left out of the zip, so the count the
            // pool shows and the one the backup holds can differ; say so instead of letting the
            // user discover it on a restore.
            const notes = [t('options.temperaPoolExported', {
                defaultValue: '已导出 {{count}} 张图片',
                count: archive.exported,
            })];
            if (archive.skipped > 0) {
                notes.push(t('options.temperaPoolExportSkipped', {
                    defaultValue: '{{count}} 张的原文件已丢失，未写入备份',
                    count: archive.skipped,
                }));
            }
            setStatusMessage({ type: 'success', text: notes.join(' · ') });
        } catch (error) {
            console.error('[Tempera] canvas image pool export failed:', error);
            setStatusMessage({ type: 'error', text: t('options.temperaPoolExportFailed') || '导出失败' });
        } finally {
            setBusy('idle');
        }
    }, [busy, draft.layerImages, t]);

    // Same single-gate shape as `handleFiles`, and the native picker is why the guard cannot live
    // in the dialog: it stays open after the click that opened it, so a drop can start an import
    // while a picker is still waiting, and both resolve into the same draft.
    const importPool = useCallback(async (file: File, mode: 'replace' | 'append') => {
        if (busy !== 'idle') return;
        // Replacement is destructive once the resulting draft is committed, so confirm the mode
        // before reading or writing the selected archive.
        if (mode === 'replace' && draft.layerImages.length > 0
            && !window.confirm(t('options.temperaImportConfirmReplace', {
                defaultValue: '替换导入会先清空当前 {{count}} 张图片，确定继续？',
                count: draft.layerImages.length,
            }))) {
            return;
        }

        const abortController = new AbortController();
        activeWriteAbortRef.current = abortController;
        setBusy('importing');
        try {
            const result = await readTemperaImageArchiveFile(file, {
                existing: mode === 'append' ? draft.layerImages : [],
                signal: abortController.signal,
            });
            if (abortController.signal.aborted || !isMountedRef.current) {
                await Promise.all(result.layerImages.map(image => (
                    clearTemperaLayerImage(image.id).catch(() => undefined)
                )));
                return;
            }
            // A backup that yields nothing is a failure the user has to hear about, but there are
            // two very different reasons for it: a pool that was already full when the zip landed
            // (every entry was counted as left out) and a zip that simply held no picture worth
            // restoring. Saying "no usable image" for the first would send the user looking for a
            // better backup when the fix is to make room.
            if (result.layerImages.length === 0) {
                console.warn('[Tempera] canvas image pool import added nothing', {
                    file: file.name,
                    skipped: result.skipped,
                    truncated: result.truncated,
                });
                // `truncated > 0` picks the wording - the cap is a "make room" problem, missing
                // bytes a "bad backup" one - but the count is every row that failed to land.
                const notAdded = result.skipped + result.truncated;
                setStatusMessage({
                    type: 'error',
                    text: result.truncated > 0
                        ? t('options.temperaPoolImportNotAdded', {
                            defaultValue: '未导入 {{count}} 张图片',
                            count: notAdded,
                        })
                        : (t('options.temperaPoolImportEmpty') || '这份备份里没有可用的图片'),
                });
                return;
            }

            if (mode === 'replace') {
                // Old files stay intact until the new draft is committed. This makes replacing
                // transactional across the React boundary too: an outer unmount can abandon the
                // draft without breaking the live tuning's existing ids.
                setRemovedIds(current => Array.from(new Set([
                    ...current,
                    ...draft.layerImages.map(image => image.id),
                ])));
            }

            // Only the pool travels in the zip: depth and frequency are pool-wide tuning the user
            // is looking at, and restoring a backup must not move them.
            setDraft(current => ({
                ...current,
                layerImages: (mode === 'append' ? current.layerImages : []).concat(result.layerImages),
            }));

            // `skipped` is manifest rows whose bytes are missing and `truncated` entries the cap
            // refused - disjoint, so together they are every backup row that did not land.
            reportPoolResult(
                'import',
                result.layerImages.length,
                result.skipped + result.truncated,
                {
                    file: file.name,
                    mode,
                    skipped: result.skipped,
                    truncated: result.truncated,
                },
            );
        } catch (error) {
            if ((error as Error)?.name === 'AbortError') return;
            console.error('[Tempera] canvas image pool import failed:', error);
            setStatusMessage({
                type: 'error',
                text: error instanceof TemperaArchiveTooLargeError
                    ? (t('options.temperaPoolImportTooLarge') || '已取消导入：备份解压后预计超过 512 MB，疑似损坏或压缩炸弹')
                    : (t('options.temperaPoolImportFailed') || '导入失败'),
            });
        } finally {
            if (activeWriteAbortRef.current === abortController) activeWriteAbortRef.current = null;
            if (isMountedRef.current) setBusy('idle');
        }
    }, [busy, draft.layerImages, reportPoolResult, t]);

    return (
        <>
            <Row
                onClick={open}
                note={t('options.temperaLayerImageHint')}
                label={images.length === 0 ? t('options.temperaAddLayerImage') : (
                    <span className="flex -space-x-2">
                        {images.slice(0, 4).map(image => (
                            <span key={image.id} className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-[var(--st-fill)] shadow-[0_0_0_1px_var(--st-line)]">
                                {thumbnails.get(image.id) && (
                                    <img
                                        src={thumbnails.get(image.id)}
                                        alt={image.name}
                                        className="h-full w-full object-cover"
                                    />
                                )}
                            </span>
                        ))}
                    </span>
                )}
            >
                {images.length > 0 && (
                    <Value>
                        {t('options.temperaImagePoolCount', {
                            defaultValue: '{{count}} / {{max}}',
                            count: images.length,
                            max: TEMPERA_MAX_LAYER_IMAGES,
                        })}
                    </Value>
                )}
            </Row>

            <TemperaImageLayerDialog
                isOpen={isDialogOpen}
                onClose={commit}
                isDaylight={isDaylight}
                t={t}
                images={draft.layerImages}
                thumbnails={thumbnails}
                depth={draft.layerImageDepth}
                frequency={draft.layerImageFrequency}
                maxImages={TEMPERA_MAX_LAYER_IMAGES}
                rangeInputClass={rangeInputClass}
                onAddFiles={files => void handleFiles(files)}
                onPatch={patch}
                onRemove={remove}
                onClearAll={clearAll}
                onDepthChange={layerImageDepth => setDraft(current => ({ ...current, layerImageDepth }))}
                onFrequencyChange={layerImageFrequency => setDraft(current => ({ ...current, layerImageFrequency }))}
                onImportPool={(file, mode) => void importPool(file, mode)}
                onExportPool={() => void exportPool()}
                busy={busy}
            />
        </>
    );
};

export default TemperaImageLayerControls;
