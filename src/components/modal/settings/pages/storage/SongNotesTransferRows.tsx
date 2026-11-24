import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setStatusMessage } from '../../../../../stores/useStatusMessageStore';
import ConfirmDialog from '../../../../shared/ConfirmDialog';
import { countSongNotesImport } from '../../../../song-notes/songNotesFile';
import { countMusicNotesModSongs } from '../../../../song-notes/musicNotesModDatabase';
import {
    applySongNotesImport,
    exportSongNotesFile,
    readMusicNotesModDatabase,
    readSongNotesFile,
    type PreparedSongNotesImport,
} from '../../../../song-notes/songNotesFileIo';
import { markMusicNotesModHintDone } from '../../../../song-notes/songNotesModHint';
import { Button, Row, useSettingsKitTheme } from '../../kit';
import { O } from './options';

// src/components/modal/settings/pages/storage/SongNotesTransferRows.tsx
// 「备份与导入」里速记簿「时刻」的几行：导出成文件、导入文件（自己的格式，或「音乐笔记」模组导出的 JSON），
// 以及这台设备上有模组的库时「从模组导入」。导入先读、认歌，弹确认框写明有多少、哪些本地歌认不回来；确认之后才写。
// 导入只添加缺少的（规则在 songNotesService.importSongNotes），所以确认框不用 danger。

const FILE_ERROR_KEYS = {
    'not-json': 'songNotes.fileErrorNotJson',
    'unknown-format': 'songNotes.fileErrorUnknownFormat',
    'newer-version': 'songNotes.fileErrorNewerVersion',
    'mod-newer-version': 'songNotes.fileErrorModNewerVersion',
    damaged: 'songNotes.fileErrorDamaged',
    'too-large': 'songNotes.fileErrorTooLarge',
    unreadable: 'songNotes.fileErrorUnreadable',
} as const;

/** 在忙什么，和是哪一行起的头（「正在导入…」写在起头的那个按钮上）。 */
type Busy = 'no' | 'exporting' | 'reading-file' | 'reading-mod' | 'importing-file' | 'importing-mod';

export const SongNotesTransferRows: React.FC = () => {
    const { t } = useTranslation();
    const { isDaylight } = useSettingsKitTheme();
    const [busy, setBusy] = useState<Busy>('no');
    const [pending, setPending] = useState<PreparedSongNotesImport | null>(null);
    const [modSongs, setModSongs] = useState(0);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        let alive = true;
        void countMusicNotesModSongs().then((count) => {
            if (alive) setModSongs(count);
        });
        return () => {
            alive = false;
        };
    }, []);

    const runExport = async () => {
        setBusy('exporting');
        try {
            const exported = await exportSongNotesFile();
            if (!exported) setStatusMessage({ type: 'error', text: t('songNotes.exportFailed') });
            else if (exported === 'too-large') setStatusMessage({ type: 'error', text: t('songNotes.exportTooLarge') });
            else if (exported.exportedCount === 0 && exported.skippedCount === 0) setStatusMessage({ type: 'info', text: t('songNotes.exportEmpty') });
            else {
                setStatusMessage({
                    type: 'success',
                    text: exported.skippedCount > 0
                        ? t('songNotes.exportDoneSkipped', { count: exported.exportedCount, skipped: exported.skippedCount })
                        : t('songNotes.exportDone', { count: exported.exportedCount }),
                });
            }
        } catch (error) {
            console.warn('[SongNotes] export failed', error);
            setStatusMessage({ type: 'error', text: t('songNotes.exportFailed') });
        }
        setBusy('no');
    };

    // 读出来没有一首能导入的，不弹确认框，直接说。
    const offer = (prepared: PreparedSongNotesImport) => {
        if (prepared.songs.length === 0) {
            setStatusMessage({ type: 'info', text: t('songNotes.importEmpty') });
            return;
        }
        setPending(prepared);
    };

    const readFile = async (file: File) => {
        setBusy('reading-file');
        try {
            const read = await readSongNotesFile(file);
            if (!read.ok) setStatusMessage({ type: 'error', text: t(FILE_ERROR_KEYS[read.error]) });
            else offer(read.prepared);
        } finally {
            setBusy('no');
        }
    };

    const readMod = async () => {
        setBusy('reading-mod');
        try {
            const prepared = await readMusicNotesModDatabase();
            if (prepared) offer(prepared);
            else {
                setModSongs(0);
                setStatusMessage({ type: 'error', text: t('songNotes.importModUnreadable') });
            }
        } catch (error) {
            console.warn('[SongNotes] reading the mod database failed', error);
            setStatusMessage({ type: 'error', text: t('songNotes.importModUnreadable') });
        } finally {
            setBusy('no');
        }
    };

    const confirmImport = async () => {
        const prepared = pending;
        setPending(null);
        if (!prepared) return;
        setBusy(prepared.fromMod ? 'importing-mod' : 'importing-file');
        let result: Awaited<ReturnType<typeof applySongNotesImport>>;
        try {
            result = await applySongNotesImport(prepared);
        } catch (error) {
            console.warn('[SongNotes] import failed', error);
            result = { ok: false, error: 'failed' };
        } finally {
            setBusy('no');
        }
        if (!result.ok) {
            setStatusMessage({ type: 'error', text: t('songNotes.importFailed') });
            return;
        }
        // 从模组导入过一次，「时刻」页就不再提示。
        if (prepared.fromMod) markMusicNotesModHintDone();
        const value = result.value;
        if (value.songsAdded === 0 && value.songsMerged === 0) {
            setStatusMessage({ type: 'info', text: t('songNotes.importNothing') });
            return;
        }
        const counts = { added: value.songsAdded, merged: value.songsMerged, comments: value.commentsAdded, tags: value.tagsAdded };
        setStatusMessage({
            type: 'success',
            text: value.overLimit > 0 ? t('songNotes.importDoneOverLimit', { ...counts, over: value.overLimit }) : t('songNotes.importDone', counts),
        });
    };

    const counts = pending ? countSongNotesImport(pending) : null;
    const skipped = pending ? pending.invalidCount + pending.mismatchedIdCount : 0;
    const working = busy !== 'no';

    return (
        <>
            <Row option={O.songNotes} hint={t('songNotes.transferHint')}>
                <Button onClick={() => void runExport()} disabled={working}>
                    {busy === 'exporting' ? t('songNotes.exporting') : t('songNotes.exportFile')}
                </Button>
                <Button onClick={() => fileInputRef.current?.click()} disabled={working}>
                    {busy === 'importing-file' ? t('songNotes.importing') : t('songNotes.importFile')}
                </Button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        // 清空，同一个文件可以再选一次。
                        event.target.value = '';
                        if (file) void readFile(file);
                    }}
                />
            </Row>
            {modSongs > 0 && (
                <Row option={O.musicNotesMod} hint={t('songNotes.importModHint', { count: modSongs })}>
                    <Button onClick={() => void readMod()} disabled={working}>
                        {busy === 'importing-mod' ? t('songNotes.importing') : t('songNotes.importModButton')}
                    </Button>
                </Row>
            )}
            <ConfirmDialog
                isOpen={pending !== null}
                title={t('songNotes.importConfirmTitle')}
                description={pending && counts ? (
                    <div className="space-y-2 text-sm leading-relaxed">
                        <p>{t('songNotes.importConfirmBody', counts)}</p>
                        {pending.unmatched > 0 && (
                            <p>{t('songNotes.importConfirmUnmatched', { count: pending.unmatched, titles: pending.unmatchedTitles.join('、') })}</p>
                        )}
                        {skipped > 0 && <p>{t('songNotes.importConfirmInvalid', { count: skipped })}</p>}
                        {pending.fromMod && pending.songs.some(item => item.song.sourceRef?.kind === 'online') && <p>{t('songNotes.importConfirmLookup')}</p>}
                    </div>
                ) : undefined}
                confirmText={t('songNotes.importModButton')}
                isDaylight={isDaylight}
                onConfirm={() => void confirmImport()}
                onClose={() => setPending(null)}
            />
        </>
    );
};

export default SongNotesTransferRows;
