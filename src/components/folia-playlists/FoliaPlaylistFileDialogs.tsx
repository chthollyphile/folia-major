import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Loader2 } from 'lucide-react';
import type { LocalSong } from '../../types';
import type { FoliaPlaylist, FoliaPlaylistSummary } from '../../types/foliaPlaylist';
import { FOLIA_PLAYLIST_FILE_MAX_ENTRIES } from '../../services/foliaPlaylist/foliaPlaylistFile';
import {
    countImportableSongs,
    describeFoliaPlaylistExports,
    downloadFoliaPlaylistJson,
    downloadFoliaPlaylistM3u,
    importPlaylistFileReading,
    readPlaylistFile,
    type PlaylistFileReadError,
    type PlaylistFileReading,
} from '../../services/foliaPlaylist/foliaPlaylistFileIo';
import { setStatusMessage } from '../../stores/useStatusMessageStore';
import { SheetButton } from '../shared/Sheet';
import ThemedDialog from '../shared/ThemedDialog';
import { describeFoliaAddResult } from './foliaAddResult';
import type { FoliaImportOutcome } from './foliaPlaylistDialogStore';
import { getFoliaSourceLabel } from './foliaTransferText';

// src/components/folia-playlists/FoliaPlaylistFileDialogs.tsx
// 歌单文件的两个对话框（哪套界面都用这一份，由 FoliaPlaylistDialogsHost 画）：
// - 导出：选保存格式。JSON 是全的；M3U8 只装得下本地文件，会丢掉几首写在选项下面。
// - 导入：JSON 与 M3U 都认（按内容认）。先读文件、给出预览（歌单名、各来源各几首、哪些来源这台机器上不可用、
//   本地歌认回几首），点了「导入」才写歌单；文件不对就照实说是哪一种，什么都不写。

type RadioOption<T extends string> = { value: T; label: string; note?: string; disabled?: boolean };

/** 单选组：焦点只落在选中的那一项上，上下左右在能选的项之间换（和转存对话框里的一样）。 */
const RadioGroup = <T extends string>({ labelId, name, value, options, busy, onChange }: {
    labelId: string;
    name: string;
    value: T;
    options: readonly RadioOption<T>[];
    busy: boolean;
    onChange: (value: T) => void;
}) => {
    const selectable = options.filter(option => !option.disabled).map(option => option.value);
    const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1
            : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
        if (step === 0 || busy || selectable.length === 0) return;
        event.preventDefault();
        const at = Math.max(selectable.indexOf(value), 0);
        onChange(selectable[(at + step + selectable.length) % selectable.length]);
        const group = event.currentTarget.parentElement;
        window.requestAnimationFrame(() => group?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
    };
    return (
        <div role="radiogroup" aria-labelledby={labelId} className="flex flex-col gap-0.5">
            {options.map((option) => {
                const checked = option.value === value;
                const blocked = busy || Boolean(option.disabled);
                return (
                    <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        // 置灰的项不用原生 disabled：读屏和键盘还要能读到它下面写的原因。
                        aria-disabled={blocked}
                        tabIndex={checked ? 0 : -1}
                        data-folia-file-option={`${name}:${option.value}`}
                        onClick={() => {
                            if (!blocked) onChange(option.value);
                        }}
                        onKeyDown={onKeyDown}
                        className="st-row st-focus-inside st-t-fast flex min-h-10 w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors aria-[disabled=false]:hover:bg-[var(--st-fill)] aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
                    >
                        <span
                            aria-hidden
                            className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${checked ? 'border-[var(--st-accent)]' : 'border-[var(--st-line2)]'}`}
                        >
                            {checked && <span className="h-2 w-2 rounded-full bg-[var(--st-accent)]" />}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block text-[13px] leading-5">{option.label}</span>
                            {option.note && <span className="block text-xs leading-[18px] text-[color:var(--st-t2)]">{option.note}</span>}
                        </span>
                    </button>
                );
            })}
        </div>
    );
};

const sectionLabel = 'text-xs leading-[18px] text-[color:var(--st-t2)]';

// ---- 导出 ----

type ExportFormat = 'json' | 'm3u';

export const FoliaPlaylistExportDialog: React.FC<{
    playlist: FoliaPlaylist;
    /** 给人看的歌单名（「我喜欢的音乐」是翻译过的）。 */
    name: string;
    localSongs: readonly LocalSong[];
    isDaylight: boolean;
    onClose: () => void;
}> = ({ playlist, name, localSongs, isDaylight, onClose }) => {
    const { t } = useTranslation();
    // 打开那一刻算一遍两种格式各写得进几首。
    const [counts] = useState(() => {
        const { json, m3u } = describeFoliaPlaylistExports(playlist, localSongs, name);
        return {
            json: { exported: json.exportedCount, skipped: json.skippedCount },
            m3u: { exported: m3u.exportedCount, skipped: m3u.skippedCount },
        };
    });
    // 歌单里有 M3U 装不下的歌时默认 JSON（不让人不知不觉丢歌）；全是本地歌时默认 M3U8（别的播放器也认，和以前一样）。
    const [format, setFormat] = useState<ExportFormat>(counts.m3u.skipped > 0 || counts.m3u.exported === 0 ? 'json' : 'm3u');

    const jsonNote = counts.json.skipped > 0
        ? t('foliaPlaylistFile.formatJsonNoteSkips', { count: counts.json.exported, skipped: counts.json.skipped })
        : t('foliaPlaylistFile.formatJsonNote', { count: counts.json.exported });
    const m3uNote = counts.m3u.exported === 0
        ? t('foliaPlaylistFile.formatM3uNoteNone')
        : counts.m3u.skipped > 0
            ? t('foliaPlaylistFile.formatM3uNoteSkips', { count: counts.m3u.exported, skipped: counts.m3u.skipped })
            : t('foliaPlaylistFile.formatM3uNoteAll', { count: counts.m3u.exported });

    const run = () => {
        try {
            const exported = format === 'json'
                ? downloadFoliaPlaylistJson(playlist, localSongs, name)
                : downloadFoliaPlaylistM3u(playlist, localSongs, name);
            setStatusMessage({
                type: 'success',
                text: t('localMusic.playlistExportSuccess', { name }),
                note: exported.skippedCount > 0
                    ? t(format === 'json' ? 'foliaPlaylistFile.exportSkippedNote' : 'localMusic.playlistExportSkipped', { count: exported.skippedCount })
                    : undefined,
            });
        } catch (error) {
            console.warn('[FoliaPlaylist] Failed to export a playlist', error);
            setStatusMessage({ type: 'error', text: t('foliaPlaylistFile.exportFailed') });
        }
        onClose();
    };

    return (
        <ThemedDialog
            isOpen
            onClose={onClose}
            isDaylight={isDaylight}
            title={t('foliaPlaylistFile.exportTitle')}
            description={t('foliaPlaylistFile.exportDescription', { name, count: playlist.entries.length })}
            size="m"
            footer={(
                <>
                    <SheetButton onClick={onClose} data-folia-file-action="cancel">{t('localMusic.cancel')}</SheetButton>
                    {/* 打开时焦点落在「导出」上：默认的格式不用改时按一下回车就行。 */}
                    <SheetButton variant="primary" onClick={run} data-folia-file-action="confirm" data-autofocus>
                        {t('foliaPlaylistFile.exportConfirm')}
                    </SheetButton>
                </>
            )}
        >
            <div className="flex flex-col gap-1.5" data-folia-file-dialog="export">
                <span id="folia-file-export-format" className={sectionLabel}>{t('foliaPlaylistFile.formatLabel')}</span>
                <RadioGroup<ExportFormat>
                    labelId="folia-file-export-format"
                    name="format"
                    value={format}
                    busy={false}
                    onChange={setFormat}
                    options={[
                        { value: 'json', label: t('foliaPlaylistFile.formatJson'), note: jsonNote },
                        { value: 'm3u', label: t('foliaPlaylistFile.formatM3u'), note: m3uNote, disabled: counts.m3u.exported === 0 },
                    ]}
                />
            </div>
        </ThemedDialog>
    );
};

// ---- 导入 ----

const ERROR_KEYS: Record<PlaylistFileReadError, string> = {
    'not-json': 'foliaPlaylistFile.errorNotJson',
    'not-folia-playlist': 'foliaPlaylistFile.errorNotFoliaPlaylist',
    'newer-version': 'foliaPlaylistFile.errorNewerVersion',
    damaged: 'foliaPlaylistFile.errorDamaged',
    'too-large': 'foliaPlaylistFile.errorTooLarge',
    'unknown-format': 'foliaPlaylistFile.errorUnknownFormat',
    unreadable: 'foliaPlaylistFile.errorUnreadable',
};

const UNAVAILABLE_KEYS = {
    'source-off': 'foliaPlaylist.sourceOff',
    'source-missing': 'foliaPlaylist.sourceMissing',
    'navidrome-unconfigured': 'foliaPlaylist.navidromeUnconfigured',
} as const;

const sourceName = (source: { key: string; sourceId?: string }, t: TFunction): string => (
    source.sourceId ? getFoliaSourceLabel(source.sourceId, t) : source.key === 'navidrome' ? t('navidrome.title') : t('scratchpad.sourceLocal')
);

const nameFromFile = (fileName: string): string => fileName.replace(/(\.folia-playlist)?\.(json|m3u8?|txt)$/i, '').trim();

type MergeChoice = 'new' | 'merge';

export const FoliaPlaylistImportDialog: React.FC<{
    file: File;
    playlists: readonly FoliaPlaylistSummary[];
    localSongs: readonly LocalSong[];
    isDaylight: boolean;
    onDone: (outcome: FoliaImportOutcome) => void;
}> = ({ file, playlists, localSongs, isDaylight, onDone }) => {
    const { t } = useTranslation();
    const [reading, setReading] = useState<PlaylistFileReading | null>(null);
    const [name, setName] = useState('');
    const [choice, setChoice] = useState<MergeChoice>('new');
    const [writing, setWriting] = useState(false);

    // 读文件只在打开时做一次（用那一刻的曲库）。
    useEffect(() => {
        let alive = true;
        void readPlaylistFile(file, localSongs).then((result) => {
            if (!alive) return;
            setReading(result);
            const fromFile = result.format === 'json' ? result.preview.name : result.format === 'm3u' ? result.name : '';
            setName(fromFile || nameFromFile(file.name) || t('foliaPlaylistFile.untitled'));
            // 导出的是「我喜欢的音乐」：默认并回这台机器上的那一张。
            if (result.format === 'json' && result.preview.favorite) setChoice('merge');
        });
        return () => {
            alive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在打开时读一次：对话框按文件挂载，曲库之后的变化不重读
    }, [file]);

    const trimmedName = name.trim();
    const isFavoriteFile = reading?.format === 'json' && reading.preview.favorite;
    // 能并进去的那一张：导出的是「我喜欢的音乐」就是这台机器上的那张；否则是同名的一张（「我喜欢的音乐」不按名字算）。
    const mergeTarget = useMemo(() => (
        isFavoriteFile
            ? playlists.find(playlist => playlist.isFavorite) ?? null
            : playlists.find(playlist => !playlist.isFavorite && playlist.name === trimmedName) ?? null
    ), [isFavoriteFile, playlists, trimmedName]);
    const merging = choice === 'merge' && mergeTarget !== null;
    // 改了名字、对上了另一张歌单：回到「新建」，并入哪一张要用户再点一次。
    const mergeTargetId = mergeTarget?.id ?? null;
    const seenMergeTargetId = useRef<string | null | undefined>(undefined);
    useEffect(() => {
        if (seenMergeTargetId.current !== undefined && seenMergeTargetId.current !== mergeTargetId && !isFavoriteFile) setChoice('new');
        seenMergeTargetId.current = mergeTargetId;
    }, [mergeTargetId, isFavoriteFile]);
    // 名字框在文件读完之后才出现，对话框打开那一刻的自动聚焦落不到它上面：读完时焦点还在对话框自己身上就补上。
    const nameInput = useRef<HTMLInputElement>(null);
    const readFormat = reading?.format;
    useEffect(() => {
        const input = nameInput.current;
        if (!input || !readFormat || readFormat === 'error') return;
        const active = document.activeElement;
        const dialog = input.closest<HTMLElement>('[role="dialog"]');
        if (active && active !== document.body && active !== dialog) return;
        // 名字框禁用着（并回「我喜欢的音乐」那一张，名字不能改）：焦点给「导入」，回车照样能走。
        const target = input.disabled
            ? dialog?.querySelector<HTMLElement>('[data-folia-file-action="confirm"]:not(:disabled)') ?? null
            : input;
        target?.focus({ preventScroll: true });
    }, [readFormat]);
    const importable = reading ? countImportableSongs(reading) : 0;
    const failed = reading?.format === 'error';
    const canImport = Boolean(reading) && !failed && importable > 0 && !writing && (merging || Boolean(trimmedName));

    const close = () => {
        if (!writing) onDone({ playlistName: null, count: 0 });
    };

    const run = async () => {
        if (!reading || reading.format === 'error' || !canImport) return;
        setWriting(true);
        try {
            const { playlist, result } = await importPlaylistFileReading(reading, {
                name: trimmedName,
                ...(merging ? { mergeInto: mergeTarget.id } : {}),
            });
            // 要并入的那张歌单在这当口被删了：什么都没写。
            if (merging && !playlist) throw new Error('The playlist to merge into is gone');
            const shownName = merging && mergeTarget.isFavorite ? t('localMusic.favoritePlaylist') : playlist?.name ?? trimmedName;
            if (merging) {
                setStatusMessage(describeFoliaAddResult(result, shownName, t));
            } else {
                setStatusMessage({ type: 'success', text: t('foliaPlaylistFile.imported', { name: shownName, count: result.added }) });
            }
            onDone({ playlistName: shownName, count: result.added });
        } catch (error) {
            console.warn('[FoliaPlaylist] Failed to import a playlist file', error);
            setStatusMessage({ type: 'error', text: t('status.playlistUpdateFailed') });
            onDone({ playlistName: null, count: 0 });
        }
    };

    const notes: string[] = [];
    if (reading?.format === 'json') {
        const { preview } = reading;
        if (preview.unavailableCount > 0) notes.push(t('foliaPlaylistFile.unavailableNote', { count: preview.unavailableCount }));
        if (preview.local.unmatched > 0) {
            const titles = preview.local.unmatchedTitles.filter(Boolean).join('、');
            notes.push(titles
                ? t('foliaPlaylistFile.localUnmatchedNamed', { count: preview.local.unmatched, titles })
                : t('foliaPlaylistFile.localUnmatched', { count: preview.local.unmatched }));
        }
        if (preview.duplicateCount > 0) notes.push(t('foliaPlaylistFile.duplicateNote', { count: preview.duplicateCount }));
        if (preview.invalidCount > 0) notes.push(t('foliaPlaylistFile.invalidNote', { count: preview.invalidCount }));
        if (preview.mismatchedIdCount > 0) notes.push(t('foliaPlaylistFile.mismatchedIdNote', { count: preview.mismatchedIdCount }));
    } else if (reading?.format === 'm3u' && reading.skippedCount > 0) {
        notes.push(t('foliaPlaylistFile.m3uSkipped', { count: reading.skippedCount }));
    }

    return (
        <ThemedDialog
            isOpen
            onClose={close}
            isDaylight={isDaylight}
            title={t('foliaPlaylistFile.importTitle')}
            description={file.name}
            size="m"
            footerNote={writing || !reading ? (
                <span className="flex items-center gap-2" role="status">
                    <Loader2 size={14} className="shrink-0 animate-spin" />
                    <span className="min-w-0">{t(reading ? 'foliaPlaylistFile.writing' : 'foliaPlaylistFile.reading')}</span>
                </span>
            ) : undefined}
            footer={failed ? (
                <SheetButton variant="primary" onClick={close} data-folia-file-action="cancel">{t('foliaPlaylistFile.close')}</SheetButton>
            ) : (
                <>
                    <SheetButton onClick={close} disabled={writing} data-folia-file-action="cancel">{t('localMusic.cancel')}</SheetButton>
                    <SheetButton variant="primary" onClick={() => void run()} disabled={!canImport} data-folia-file-action="confirm">
                        {t('foliaPlaylistFile.importConfirm')}
                    </SheetButton>
                </>
            )}
        >
            <div className="flex flex-col gap-4" data-folia-file-dialog="import" data-folia-file-state={reading ? reading.format : 'reading'}>
                {reading?.format === 'error' && (
                    <div role="alert" className="flex flex-col gap-1">
                        <p className="text-[13px] leading-5" data-folia-file-error={reading.error}>
                            {t(ERROR_KEYS[reading.error], { max: FOLIA_PLAYLIST_FILE_MAX_ENTRIES })}
                        </p>
                        <p className={sectionLabel}>{t('foliaPlaylistFile.nothingWritten')}</p>
                    </div>
                )}
                {reading && reading.format !== 'error' && (
                    <>
                        <p className={sectionLabel} data-folia-file-format={reading.format}>
                            {t(reading.format === 'json' ? 'foliaPlaylistFile.detectedJson' : 'foliaPlaylistFile.detectedM3u')}
                        </p>
                        <label className="flex flex-col gap-1.5">
                            <span className={sectionLabel}>{t('foliaPlaylistFile.nameLabel')}</span>
                            <input
                                ref={nameInput}
                                data-autofocus
                                type="text"
                                value={merging && mergeTarget.isFavorite ? t('localMusic.favoritePlaylist') : name}
                                disabled={writing || (merging && Boolean(mergeTarget.isFavorite))}
                                maxLength={200}
                                onChange={event => setName(event.target.value)}
                                // 名字框里按回车就是「导入」（和转存对话框一样）；还不能导入时不动。
                                onKeyDown={(event) => {
                                    // 输入法里确认候选词的那一下回车不算。
                                    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                                    event.preventDefault();
                                    void run();
                                }}
                                placeholder={t('localMusic.enterPlaylistName')}
                                aria-label={t('localMusic.enterPlaylistName')}
                                className="st-t-fast h-9 w-full rounded-lg border border-transparent bg-[var(--st-fill)] px-3 text-[13px] text-[color:var(--st-t1)] outline-none transition-colors placeholder:text-[color:var(--st-t3)] focus:border-[var(--st-accent)] disabled:opacity-60"
                            />
                        </label>
                        <div className="flex flex-col gap-1" data-folia-file-summary>
                            {reading.format === 'json' ? (
                                <>
                                    <p className="text-[13px] leading-5">
                                        {t('foliaPlaylistFile.summary', { total: reading.preview.total, count: reading.preview.entries.length })}
                                    </p>
                                    <ul className="flex flex-col gap-0.5">
                                        {reading.preview.sources.map(source => (
                                            <li key={source.key} className="flex items-baseline justify-between gap-3 text-xs leading-[18px]" data-folia-file-source={source.key}>
                                                <span className="min-w-0 truncate text-[color:var(--st-t1)]">
                                                    {sourceName(source, t)}
                                                    {source.unavailable && (
                                                        <span className="text-[color:var(--st-t3)]"> · {t(UNAVAILABLE_KEYS[source.unavailable])}</span>
                                                    )}
                                                    {source.key === 'local' && (
                                                        <span className="text-[color:var(--st-t3)]"> · {t('foliaPlaylistFile.localMatched', { matched: reading.preview.local.matched })}</span>
                                                    )}
                                                </span>
                                                <span className="shrink-0 text-[color:var(--st-t2)]">{t('foliaPlaylistFile.songCount', { count: source.count })}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </>
                            ) : (
                                <p className="text-[13px] leading-5">
                                    {t('foliaPlaylistFile.m3uSummary', { total: reading.total, count: reading.matchedSongs.length })}
                                </p>
                            )}
                            {notes.map(note => <p key={note} className="text-xs leading-[18px] text-[color:var(--st-t2)]">{note}</p>)}
                            {importable === 0 && <p role="alert" className="text-xs leading-[18px] text-[color:var(--st-t1)]">{t('foliaPlaylistFile.nothingToImport')}</p>}
                        </div>
                        {mergeTarget && importable > 0 && (
                            <div className="flex flex-col gap-1.5">
                                <span id="folia-file-import-target" className={sectionLabel}>
                                    {t(isFavoriteFile ? 'foliaPlaylistFile.favoriteLabel' : 'foliaPlaylistFile.existingLabel')}
                                </span>
                                <RadioGroup<MergeChoice>
                                    labelId="folia-file-import-target"
                                    name="target"
                                    value={choice}
                                    busy={writing}
                                    onChange={setChoice}
                                    options={[
                                        { value: 'new', label: t('foliaPlaylistFile.asNew'), note: isFavoriteFile ? undefined : t('foliaPlaylistFile.asNewNote') },
                                        {
                                            value: 'merge',
                                            label: t('foliaPlaylistFile.mergeInto', {
                                                name: mergeTarget.isFavorite ? t('localMusic.favoritePlaylist') : mergeTarget.name,
                                            }),
                                            note: t('foliaPlaylistFile.mergeNote'),
                                        },
                                    ]}
                                />
                            </div>
                        )}
                    </>
                )}
            </div>
        </ThemedDialog>
    );
};
