import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, ImageOff, ImageUp, Loader2, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LocalSong } from '../../types';
import type { LocalGridViewCollectionDescriptor } from '../../library/core/collection/collection.contract';
import {
    localCollectionCoverKey,
    resolveLocalCollectionPosterFolder,
    resolveLocalSongCoverCandidates,
    type LocalCollectionCoverOrigin,
} from '../../library/core/collection/cover/localCollectionCover';
import { localCollectionCovers } from '../../library/core/collection/cover/localCollectionCovers.service';
import {
    findLocalFolderPoster,
    loadLocalSongCoverBlob,
    prepareLocalCollectionCoverImage,
    type LocalFolderPosterLookup,
} from '../../services/localCollectionCoverSources';
import { useLocalCollectionCoverUrls } from '../../library/core/collection/cover/useLocalCollectionCoverUrls';
import { getLocalCoverUrl } from '../../library/core/home/localHomeModel';
import { getLocalCoverAssetUrl } from '../../services/localCoverAssetUrl';
import { setStatusMessage } from '../../stores/useStatusMessageStore';
import { errorMessage } from '../../utils/errorText';
import ThemedDialog from '../shared/ThemedDialog';
import { SheetButton } from '../shared/Sheet';
import LocalCollectionCoverSongPicks from './LocalCollectionCoverSongPicks';

// src/components/local-collection-cover/LocalCollectionCoverDialog.tsx
// 本地文件夹 / 专辑 / 歌单的「设置封面」对话框：用文件夹里的 poster.png、上传一张图、选集合里一首歌的封面，
// 或恢复默认（自动封面）。图片在这一刻读出来、缩好、存下（core/collection/cover），之后集合封面固定，
// 与歌曲文件和集合里的歌都无关。宿主（library/app/GridViewOverlayHost）在变更端口的 editCover 里打开它。

type PosterState = { status: 'checking' } | LocalFolderPosterLookup;

type LocalCollectionCoverDialogProps = {
    collection: LocalGridViewCollectionDescriptor;
    /** 集合里的歌，按集合的顺序。 */
    songs: LocalSong[];
    isDaylight: boolean;
    onClose: () => void;
};

const KIND_KEYS: Record<string, string> = {
    folder: 'localCollectionCover.kindFolder',
    album: 'localCollectionCover.kindAlbum',
    playlist: 'localCollectionCover.kindPlaylist',
};

const LocalCollectionCoverDialog: React.FC<LocalCollectionCoverDialogProps> = ({ collection, songs, isDaylight, onClose }) => {
    const { t } = useTranslation();
    const coverKey = localCollectionCoverKey(collection);
    const overrides = useLocalCollectionCoverUrls();
    const customCoverUrl = coverKey ? overrides.get(coverKey) : undefined;
    const automaticCoverUrl = useMemo(() => getLocalCoverUrl(songs, getLocalCoverAssetUrl), [songs]);
    const previewUrl = customCoverUrl ?? automaticCoverUrl;
    const posterFolder = useMemo(() => resolveLocalCollectionPosterFolder(collection, songs), [collection, songs]);
    const [poster, setPoster] = useState<PosterState | null>(posterFolder ? { status: 'checking' } : null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 打开时看一眼文件夹里有没有 poster（不要权限：没给时显示「允许读取」，点按钮时再要）。
    useEffect(() => {
        if (!posterFolder) {
            setPoster(null);
            return;
        }
        let cancelled = false;
        setPoster({ status: 'checking' });
        findLocalFolderPoster(posterFolder)
            .then(result => { if (!cancelled) setPoster(result); })
            .catch(lookupError => {
                console.warn('[LocalCollectionCover] Failed to look for poster.png:', lookupError);
                if (!cancelled) setPoster({ status: 'unavailable' });
            });
        return () => { cancelled = true; };
    }, [posterFolder]);

    // 读图 → 缩好 → 存下；成功后关掉对话框并提示一句，失败时留在对话框里说原因。
    const apply = async (origin: LocalCollectionCoverOrigin, read: () => Promise<Blob>) => {
        if (!coverKey || busy) return;
        setBusy(true);
        setError(null);
        try {
            const source = await read();
            let image: Blob;
            try {
                image = await prepareLocalCollectionCoverImage(source);
            } catch (decodeError) {
                console.warn('[LocalCollectionCover] The chosen image could not be decoded:', decodeError);
                throw new Error(t('localCollectionCover.notImage'));
            }
            await localCollectionCovers.set(coverKey, image, origin);
            setStatusMessage({ type: 'success', text: t('localCollectionCover.saved') });
            onClose();
        } catch (applyError) {
            console.warn(`[LocalCollectionCover] Failed to set the cover of ${coverKey} from ${origin}:`, applyError);
            setError(t('localCollectionCover.failed', { error: errorMessage(applyError) }));
        } finally {
            setBusy(false);
        }
    };

    const applyPoster = () => {
        if (!posterFolder) return;
        // 点的这一刻重新读一遍（打开对话框之后文件可能换过）；没有权限就在这次点击里要。
        void apply('poster', async () => {
            const result = await findLocalFolderPoster(posterFolder, { requestAccess: true });
            setPoster(result);
            if (result.status !== 'found') throw new Error(t(posterHintKey(result)));
            return result.file;
        });
    };

    const restore = async () => {
        if (!coverKey || busy) return;
        setBusy(true);
        setError(null);
        try {
            await localCollectionCovers.clear(coverKey);
            setStatusMessage({ type: 'success', text: t('localCollectionCover.restored') });
            onClose();
        } catch (restoreError) {
            console.warn(`[LocalCollectionCover] Failed to restore the cover of ${coverKey}:`, restoreError);
            setError(t('localCollectionCover.failed', { error: errorMessage(restoreError) }));
        } finally {
            setBusy(false);
        }
    };

    const posterDisabled = busy || !poster || poster.status === 'checking' || poster.status === 'missing' || poster.status === 'unavailable';

    return (
        <ThemedDialog
            isOpen
            onClose={onClose}
            isDaylight={isDaylight}
            size="m"
            fill
            title={t('localCollectionCover.title', { name: collection.name })}
            description={t('localCollectionCover.description', { kind: t(KIND_KEYS[collection.type] ?? KIND_KEYS.folder) })}
            closeDisabled={busy}
            footerNote={busy
                ? <span className="flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" />{t('localCollectionCover.saving')}</span>
                : error && <span className="text-[color:var(--st-err)]">{error}</span>}
            footer={customCoverUrl ? (
                <SheetButton onClick={() => void restore()} disabled={busy}>
                    <RotateCcw size={14} className="mr-1.5 inline" />
                    {t('localCollectionCover.restore')}
                </SheetButton>
            ) : undefined}
        >
            <div className="mb-3.5 flex shrink-0 items-center gap-3.5">
                <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--st-fill)] shadow-[0_0_0_1px_var(--st-line)]">
                    {previewUrl
                        ? <img src={previewUrl} alt="" className="h-full w-full object-cover" />
                        : <ImageOff size={22} className="text-[color:var(--st-t3)]" />}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="text-[13px] text-[color:var(--st-t2)]">
                        {customCoverUrl
                            ? t('localCollectionCover.currentCustom')
                            : previewUrl ? t('localCollectionCover.currentAutomatic') : t('localCollectionCover.noCover')}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {posterFolder && (
                            <SheetButton onClick={applyPoster} disabled={posterDisabled}>
                                <FolderOpen size={14} className="mr-1.5 inline" />
                                {t('localCollectionCover.usePoster')}
                            </SheetButton>
                        )}
                        <SheetButton onClick={() => fileInputRef.current?.click()} disabled={busy}>
                            <ImageUp size={14} className="mr-1.5 inline" />
                            {t('localCollectionCover.upload')}
                        </SheetButton>
                    </div>
                    {poster && (
                        <div className="text-xs text-[color:var(--st-t3)]">
                            {poster.status === 'found'
                                ? t('localCollectionCover.posterFound', { name: poster.file.name })
                                : t(posterHintKey(poster))}
                        </div>
                    )}
                </div>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={event => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (file) void apply('upload', async () => file);
                    }}
                />
            </div>
            <LocalCollectionCoverSongPicks
                songs={songs}
                disabled={busy}
                onPick={song => void apply('song', () => loadLocalSongCoverBlob(
                    resolveLocalSongCoverCandidates(song, getLocalCoverAssetUrl),
                    song.id,
                ))}
            />
        </ThemedDialog>
    );
};

/** poster 查找结果（找到以外）对应的提示。 */
const posterHintKey = (state: PosterState): string => {
    if (state.status === 'checking') return 'localCollectionCover.posterChecking';
    if (state.status === 'no-access') return 'localCollectionCover.posterNoAccess';
    if (state.status === 'unavailable') return 'localCollectionCover.posterUnavailable';
    return 'localCollectionCover.posterMissing';
};

export default LocalCollectionCoverDialog;
