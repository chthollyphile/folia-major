import React, { useCallback, useRef, useState } from 'react';
import { Download, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { TemperaLayerImage } from '../../../types';
import ThemedDialog from '../../shared/ThemedDialog';
import TemperaImageImportMenu from './TemperaImageImportMenu';
import TemperaImagePlacementEditor from './TemperaImagePlacementEditor';
import { TemperaRangeControl } from './TemperaSettingsControls';
import type { TemperaDialogTokens } from './temperaDialogTokens';
import { temperaDialogTextVars, temperaDialogTokens } from './temperaDialogTokens';

// src/components/visualizer/tempera/TemperaImageLayerDialog.tsx
// The one place canvas images are managed: upload, preview, per-image tendency and size, and
// the two pool-wide settings. Split out of the settings panel because a list of filenames with
// two sliders each is unreadable inline - the picture is the thing being chosen.
//
// Every control here edits the caller's draft, never the live tuning; the caller commits on
// close. Per-image placement lives in TemperaImagePlacementEditor so this dialog stays focused
// on pool-wide actions and composition.

interface TemperaImageLayerDialogProps {
    isOpen: boolean;
    onClose: () => void;
    isDaylight: boolean;
    t: TFunction;
    images: TemperaLayerImage[];
    thumbnails: Map<string, string>;
    depth: 'back' | 'front';
    frequency: number;
    maxImages: number;
    rangeInputClass: string;
    onAddFiles: (files: File[]) => void;
    onPatch: (id: string, next: Partial<TemperaLayerImage>) => void;
    onRemove: (id: string) => void;
    onClearAll: () => void;
    onDepthChange: (depth: 'back' | 'front') => void;
    onFrequencyChange: (frequency: number) => void;
    /** Whole-pool zip backup. `mode` decides whether incoming images replace the pool or join it. */
    onImportPool: (file: File, mode: 'replace' | 'append') => void;
    onExportPool: () => void;
    busy: TemperaPoolBusyAction;
}

/**
 * Which pool-wide file action is in flight. `adding` is a state of its own rather than an import
 * in miniature - it appends artwork the user picked, not rows of a backup - but it locks the
 * dialog all the same: both it and `importing` write the draft after their last await.
 */
export type TemperaPoolBusyAction = 'idle' | 'adding' | 'exporting' | 'importing';

/**
 * What the footer says while a run is in flight. The count it replaces is the one thing in the
 * footer that never dims, so it is also where an import that outlived its button has to show.
 */
const BUSY_LABELS: Record<Exclude<TemperaPoolBusyAction, 'idle'>, { key: string; fallback: string }> = {
    adding: { key: 'options.temperaPoolBusyAdd', fallback: '正在添加…' },
    exporting: { key: 'options.temperaPoolBusyExport', fallback: '正在导出…' },
    importing: { key: 'options.temperaPoolBusyImport', fallback: '正在导入…' },
};

/**
 * Whether the run in flight is one a close would corrupt. `exporting` is deliberately excluded:
 * it reads the draft and writes nothing, so the download landing or not leaves the pool intact.
 * `adding` and `importing` both touch the draft *after* their last await, so a close in between
 * commits the pre-run pool and strands the tail in a draft nobody is looking at.
 */
export const isTemperaPoolWriteLocked = (busy: TemperaPoolBusyAction): boolean => (
    busy === 'adding' || busy === 'importing'
);

interface ChipProps {
    label: string;
    active: boolean;
    tokens: TemperaDialogTokens;
    onClick: () => void;
}

const Chip: React.FC<ChipProps> = ({ label, active, tokens, onClick }) => (
    <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className="rounded-full border px-3 py-1.5 text-xs transition-colors"
        style={{
            borderColor: active ? tokens.textPrimary : tokens.line,
            color: tokens.textPrimary,
            opacity: active ? 1 : 0.55,
        }}
    >
        {label}
    </button>
);

interface PoolActionProps {
    label: string;
    icon: React.ReactNode;
    tokens: TemperaDialogTokens;
    disabled?: boolean;
    onClick: () => void;
}

const PoolAction: React.FC<PoolActionProps> = ({ label, icon, tokens, disabled, onClick }) => (
    <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors disabled:opacity-35 disabled:hover:bg-transparent ${tokens.hoverSurfaceClass}`}
        style={{ color: tokens.textPrimary, borderColor: tokens.line }}
    >
        {icon}
        {label}
    </button>
);

const TemperaImageLayerDialog: React.FC<TemperaImageLayerDialogProps> = ({
    isOpen,
    onClose,
    isDaylight,
    t,
    images,
    thumbnails,
    depth,
    frequency,
    maxImages,
    rangeInputClass,
    onAddFiles,
    onPatch,
    onRemove,
    onClearAll,
    onDepthChange,
    onFrequencyChange,
    onImportPool,
    onExportPool,
    busy,
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const importInputRef = useRef<HTMLInputElement>(null);
    const pendingImportModeRef = useRef<'replace' | 'append'>('append');
    const [dragging, setDragging] = useState(false);
    const full = images.length >= maxImages;
    const tokens = temperaDialogTokens(isDaylight);
    // A run outlives the click that started it and writes the draft after awaiting storage, so
    // every close path owned by this dialog funnels through the same lock.
    const writeLocked = isTemperaPoolWriteLocked(busy);

    const requestClose = useCallback(() => {
        if (writeLocked) return;
        onClose();
    }, [writeLocked, onClose]);

    const openImportPicker = useCallback((mode: 'replace' | 'append') => {
        pendingImportModeRef.current = mode;
        importInputRef.current?.click();
    }, []);

    // The drop zone is the one import path a button's `disabled` cannot reach, but it lands in the
    // same two callbacks, so the overlap guard lives there - the one place every path goes through.
    const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setDragging(false);
        const files = Array.from(event.dataTransfer.files ?? []);
        // A dropped zip is a pool backup, not an image; anything else is artwork. It always
        // appends: the picker is the only path that can choose `replace`, and a drop cannot ask.
        const archive = files.find(file => file.name.toLowerCase().endsWith('.zip'));
        if (archive) {
            onImportPool(archive, 'append');
            return;
        }
        onAddFiles(files);
    }, [onAddFiles, onImportPool]);

    return (
        <ThemedDialog
            isOpen={isOpen}
            onClose={requestClose}
            closeDisabled={writeLocked}
            closeDisabledTitle={writeLocked
                ? (t('options.temperaPoolWaitToSave') || '还有图片在处理，完成后才能保存')
                : undefined}
            isDaylight={isDaylight}
            title={t('options.temperaImageSection') || '画布图片'}
            description={`${t('options.temperaLayerImageHint') || '每个分镜会从图片池里随机取一张，位置由对齐倾向决定。'}\n${t('options.temperaLayerImageSaveHint') || '改动会在关闭本窗口时写入。'}`}
            size="l"
            fill
            headerActions={(
                <button
                    type="button"
                    disabled={images.length === 0 || busy !== 'idle'}
                    onClick={onClearAll}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors disabled:opacity-35 disabled:hover:bg-transparent ${tokens.hoverSurfaceClass}`}
                    style={{ color: tokens.textPrimary, borderColor: tokens.line }}
                >
                    <Trash2 size={13} />
                    {t('options.temperaClearLayerImages')}
                </button>
            )}
            footer={(
                <div className="flex w-full flex-wrap items-center gap-2">
                    <PoolAction
                        label={t('options.temperaAddLayerImage') || '添加图片'}
                        icon={<ImagePlus size={14} />}
                        tokens={tokens}
                        disabled={full || busy !== 'idle'}
                        onClick={() => fileInputRef.current?.click()}
                    />
                    <TemperaImageImportMenu
                        disabled={busy !== 'idle'}
                        appendDisabled={full}
                        isDaylight={isDaylight}
                        tokens={tokens}
                        t={t}
                        onChoose={openImportPicker}
                    />
                    <PoolAction
                        label={t('options.temperaExportImages') || '导出备份'}
                        icon={<Download size={14} />}
                        tokens={tokens}
                        disabled={images.length === 0 || busy !== 'idle'}
                        onClick={onExportPool}
                    />
                    <span className="ml-auto flex items-center gap-3">
                        {/* Busy takes the count's slot rather than a button's icon: a spinner
                            among several greyed-out buttons is invisible, and a run started from a
                            native picker outlives that picker. This slot never dims or moves. */}
                        {busy === 'idle' ? (
                            <span className="text-xs opacity-60" style={{ color: tokens.textSecondary }}>
                                {t('options.temperaImagePoolCount', {
                                    defaultValue: '{{count}} / {{max}}',
                                    count: images.length,
                                    max: maxImages,
                                })}
                            </span>
                        ) : (
                            <span
                                className="inline-flex items-center gap-1.5 text-xs"
                                style={{ color: tokens.textPrimary }}
                                role="status"
                            >
                                <Loader2 size={13} className="animate-spin" />
                                {t(BUSY_LABELS[busy].key) || BUSY_LABELS[busy].fallback}
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={requestClose}
                            disabled={writeLocked}
                            // Why the button is dead has to be said: once the file picker that
                            // started the run has closed, nothing else on screen mentions it.
                            // Names the consequence, where the busy label names the action.
                            title={writeLocked
                                ? (t('options.temperaPoolWaitToSave') || '还有图片在处理，完成后才能保存')
                                : undefined}
                            className={`rounded-full border px-5 py-2 text-sm transition-colors disabled:opacity-35 disabled:hover:bg-transparent ${tokens.hoverSurfaceClass}`}
                            style={{ color: tokens.textPrimary, borderColor: tokens.line }}
                        >
                            {t('options.temperaLayerImageSave') || '保存'}
                        </button>
                    </span>
                </div>
            )}
        >
            <div
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                className="flex min-h-0 flex-col gap-4 rounded-2xl border border-dashed p-4"
                style={{ borderColor: dragging ? tokens.textPrimary : 'transparent' }}
            >
                <div className="max-h-[62vh] space-y-5 overflow-y-auto pr-1" style={temperaDialogTextVars(tokens)}>
                    <div
                        className="space-y-3 rounded-2xl border p-4"
                        style={{ borderColor: tokens.line, backgroundColor: tokens.surface }}
                    >
                        <div className="space-y-2">
                            <span className="text-sm" style={{ color: tokens.textPrimary }}>
                                {t('options.temperaLayerImageDepth') || '图层位置'}
                            </span>
                            <div className="flex flex-wrap gap-2">
                                {([
                                    ['back', t('options.temperaLayerImageBack') || '歌词之后'],
                                    ['front', t('options.temperaLayerImageFront') || '歌词之前'],
                                ] as const).map(([value, label]) => (
                                    <Chip
                                        key={value}
                                        label={label}
                                        active={depth === value}
                                        tokens={tokens}
                                        onClick={() => onDepthChange(value)}
                                    />
                                ))}
                            </div>
                        </div>
                        <TemperaRangeControl
                            label={t('options.temperaLayerImageFrequency') || '出现频率'}
                            value={frequency}
                            min={0}
                            max={1}
                            step={0.05}
                            rangeInputClass={rangeInputClass}
                            onChange={onFrequencyChange}
                        />
                    </div>

                    {images.length === 0 ? (
                        <p className="py-6 text-center text-xs opacity-50" style={{ color: tokens.textSecondary }}>
                            {t('options.temperaLayerImageEmpty') || '还没有图片。加入立绘、logo 或纹理后，每个分镜会随机取用。'}
                        </p>
                    ) : (
                        <div className="grid gap-3 sm:grid-cols-2">
                            {images.map(image => (
                                <TemperaImagePlacementEditor
                                    key={image.id}
                                    image={image}
                                    thumbnail={thumbnails.get(image.id)}
                                    t={t}
                                    tokens={tokens}
                                    rangeInputClass={rangeInputClass}
                                    onPatch={onPatch}
                                    onRemove={onRemove}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {/* The drop hint stays at the bottom of the drop area: the pool can run several
                    screens long when it holds sixteen entries, and a hint that scrolled with the
                    list would be off-screen exactly when a file is being dragged in. Hidden once
                    the pool is full, because there is then nothing a drop can do - the images
                    would be refused, and the hint would be promising the opposite. The drop zone
                    itself stays live: a zip can still replace the whole pool. */}
                {!full && (
                    <p className="text-xs opacity-50" style={{ color: tokens.textSecondary }}>
                        {t('options.temperaLayerImageDropHint') || '也可以把文件拖到这里'}
                    </p>
                )}
            </div>

            <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                multiple
                className="hidden"
                onChange={(event) => {
                    onAddFiles(Array.from(event.target.files ?? []));
                    event.target.value = '';
                }}
            />
            <input
                ref={importInputRef}
                type="file"
                accept="application/zip,.zip"
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onImportPool(file, pendingImportModeRef.current);
                    event.target.value = '';
                }}
            />
        </ThemedDialog>
    );
};

export default TemperaImageLayerDialog;
