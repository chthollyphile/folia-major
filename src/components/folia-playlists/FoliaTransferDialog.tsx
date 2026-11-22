import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type { FoliaPlaylistSummary, FoliaPlaylistOrigin } from '../../types/foliaPlaylist';
import type { FoliaPlayViaTarget } from '../../library/core/foliaPlaylist/foliaPlaylist.contract';
import { createFoliaPlaylistPort } from '../../library/app/createFoliaPlaylistPort';
import {
    collectionOfFoliaOrigin,
    describeFoliaOrigin,
    isAbortError,
    readFoliaOriginSongs,
    resolveFoliaOriginSourceState,
    type FoliaOriginReadProgress,
} from '../../library/app/foliaOriginSongs';
import { readTrackSourcesVersion, subscribeTrackSources } from '../../services/foliaPlaylist/trackSourceState';
import { setStatusMessage } from '../../stores/useStatusMessageStore';
import { FoliaNothingToSaveError, foliaOriginNeedsConfirmation } from '../../utils/foliaPlaylistTransfer';
import { SheetButton } from '../shared/Sheet';
import ThemedDialog from '../shared/ThemedDialog';
import type { FoliaTransferRequest } from './foliaPlaylistDialogStore';
import {
    describeFoliaNothingSavable,
    describeFoliaOriginUnreadable,
    describeFoliaProvenance,
    describeFoliaRefreshResult,
    describeFoliaSaveResult,
    describePlayViaUnavailable,
    getFoliaSourceLabel,
} from './foliaTransferText';

// src/components/folia-playlists/FoliaTransferDialog.tsx
// 转存的对话框，两种用法共用一个：
// - 把一张平台歌单 / 专辑存成 Folia 歌单：歌单名（默认原名）、「改由……播放」的选择；
// - 转存来的歌单从原歌单更新：写着出处，可以改「改由……播放」的选择。
// 确认之后读原歌单（一页页读，报进度）、问目标音源（服务层分批问，有时限），这段时间对话框显示进行中的状态，
// 可以取消：取消就关掉，已经发出去的请求答回来也不再写任何东西。结果用应用的状态提示说。
// 「改由……播放」只列声明了能替这个来源答「对应歌曲」的音源；没配好的列出来但置灰并写明原因；一个都没有时不显示这一项。

const port = createFoliaPlaylistPort();

type Props = {
    request: FoliaTransferRequest;
    /** 更新时用：这张歌单此刻的样子（打开对话框那一刻就不在了的话，对话框不画）。 */
    playlists: readonly FoliaPlaylistSummary[];
    isDaylight: boolean;
    onClose: () => void;
};

type Phase =
    | { step: 'choose' }
    | { step: 'reading'; progress: FoliaOriginReadProgress | null }
    | { step: 'writing' };

/** 没选目标音源（按原来的来源播放）在单选里的值。 */
const KEEP_ORIGIN = '';

const usePlayViaTargets = (originSourceId: string): FoliaPlayViaTarget[] => {
    // 同步读此刻的状态；订阅只是为了音源增减、开关、配置变了时重画一遍、重读一遍（列表很短，不值得缓存）。
    useSyncExternalStore(subscribeTrackSources, readTrackSourcesVersion);
    return port.getPlayViaTargets(originSourceId);
};

const FoliaTransferDialog: React.FC<Props> = ({ request, playlists, isDaylight, onClose }) => {
    const { t, i18n } = useTranslation();
    // 打开那一刻的歌单与出处：对话框开着的时候歌单被别处改了也不换（写的时候服务层按歌单此刻的条目算）。
    const [playlist] = useState<FoliaPlaylistSummary | null>(() => (
        request.mode === 'refresh' ? playlists.find(item => item.id === request.playlistId) ?? null : null
    ));
    const [origin] = useState<Pick<FoliaPlaylistOrigin, 'sourceId' | 'collectionId' | 'name' | 'collectionType' | 'collectionData'> | null>(() => (
        request.mode === 'save' ? describeFoliaOrigin(request.collection) : playlist?.origin ?? null
    ));
    const originSourceId = origin?.sourceId ?? '';
    const targets = usePlayViaTargets(originSourceId);
    const rememberedPlayVia = playlist?.origin?.playVia ?? KEEP_ORIGIN;
    const [name, setName] = useState(() => (request.mode === 'save' ? request.collection.name : playlist?.name ?? ''));
    // 出处是读入的文件说的、还没确认过：对话框里写明会向哪个音源读哪张歌单，点「确认并更新」才记下确认并去读。
    const needsOriginConfirmation = request.mode === 'refresh' && foliaOriginNeedsConfirmation(playlist?.origin);
    const [playVia, setPlayVia] = useState(rememberedPlayVia);
    const [phase, setPhase] = useState<Phase>({ step: 'choose' });
    const abortRef = useRef<AbortController | null>(null);
    // 关掉对话框（含取消）时让进行中的那一趟停在动笔之前。
    useEffect(() => () => abortRef.current?.abort(), []);

    // 要更新的歌单已经不在了（或者它不是转存来的）：没有可画的，把请求收掉。
    const isInvalid = !origin || (request.mode === 'refresh' && !playlist);
    useEffect(() => {
        if (isInvalid) onClose();
    }, [isInvalid, onClose]);

    if (!origin || isInvalid) return null;

    // 上次记着的目标音源现在已经不在可选的里面（模组卸了、停用了）：仍然列出来，写明现在问不了。
    const options: FoliaPlayViaTarget[] = rememberedPlayVia && !targets.some(target => target.sourceId === rememberedPlayVia)
        ? [...targets, { sourceId: rememberedPlayVia, unavailable: resolveFoliaOriginSourceState(rememberedPlayVia) === 'source-off' ? 'switched-off' : 'not-registered' }]
        : targets;
    const isBusy = phase.step !== 'choose';
    const chosenPlayVia = playVia || undefined;
    const trimmedName = name.trim();

    const run = async () => {
        if (isBusy) return;
        if (request.mode === 'save' && !trimmedName) return;
        const controller = new AbortController();
        abortRef.current = controller;
        const { signal } = controller;
        const onProgress = (progress: FoliaOriginReadProgress) => {
            if (!signal.aborted) setPhase({ step: 'reading', progress });
        };
        setPhase({ step: 'reading', progress: null });
        try {
            if (request.mode === 'save') {
                const songs = await readFoliaOriginSongs(request.collection, { signal, onProgress });
                if (signal.aborted) return;
                // 原歌单读回来是空的：不建一张空歌单，说一声，留在对话框里。
                if (songs.length === 0) {
                    setStatusMessage({ type: 'error', text: t('foliaTransfer.savedNothing') });
                    setPhase({ step: 'choose' });
                    return;
                }
                setPhase({ step: 'writing' });
                const { playlist: saved, result } = await port.saveCollection({ name: trimmedName, songs, origin, playVia: chosenPlayVia, signal });
                // 写成了就照实说，哪怕取消踩在动笔之后（那时已经拦不住了）。
                setStatusMessage(describeFoliaSaveResult(result, saved.name, chosenPlayVia, t));
            } else if (playlist) {
                if (needsOriginConfirmation && !(await port.confirmOrigin(playlist.id, origin))) {
                    setStatusMessage({ type: 'error', text: t('foliaTransfer.failed'), note: t('foliaTransfer.nothingWritten') });
                    onClose();
                    return;
                }
                const answer = await port.refreshFromOrigin(
                    playlist.id,
                    async stored => {
                        const songs = await readFoliaOriginSongs(collectionOfFoliaOrigin(stored), { signal, onProgress });
                        if (!signal.aborted) setPhase({ step: 'writing' });
                        return songs;
                    },
                    // 没改选择就不传：服务层沿用歌单上记着的那个。
                    { signal, ...(playVia === rememberedPlayVia ? {} : { playVia: chosenPlayVia ?? null }) },
                );
                setStatusMessage(answer
                    ? describeFoliaRefreshResult(answer.result, answer.playlist.name, answer.playlist.origin?.playVia, t)
                    : { type: 'error', text: t('foliaTransfer.failed'), note: t('foliaTransfer.nothingWritten') });
            }
            // 取消的那一趟对话框早就关了；这时再关，关掉的可能是之后打开的另一个。
            if (!signal.aborted) onClose();
        } catch (error) {
            // 取消的：对话框已经关了，什么都没写，不用再说。
            if (signal.aborted || isAbortError(error)) return;
            // 一首都放不进歌单（全是舞台歌）：服务层没有建歌单，照实说，留在对话框里。
            if (error instanceof FoliaNothingToSaveError) {
                setStatusMessage(describeFoliaNothingSavable(error, t));
                setPhase({ step: 'choose' });
                return;
            }
            console.warn('[FoliaPlaylist] The transfer failed', error);
            setStatusMessage(describeFoliaOriginUnreadable(error, originSourceId, t));
            setPhase({ step: 'choose' });
        }
    };

    const cancel = () => {
        abortRef.current?.abort();
        onClose();
    };

    const sourceLabel = getFoliaSourceLabel(originSourceId, t);
    const progressText = (() => {
        if (phase.step === 'reading') {
            if (!phase.progress) return t('foliaTransfer.reading', { source: sourceLabel });
            return typeof phase.progress.total === 'number' && phase.progress.total > 0
                ? t('foliaTransfer.readingProgress', { loaded: phase.progress.loaded, total: phase.progress.total })
                : t('foliaTransfer.readingCount', { loaded: phase.progress.loaded });
        }
        if (phase.step === 'writing') {
            return chosenPlayVia
                ? t('foliaTransfer.asking', { source: getFoliaSourceLabel(chosenPlayVia, t) })
                : t('foliaTransfer.writing');
        }
        return '';
    })();

    const provenance = request.mode === 'refresh' && playlist?.origin
        ? describeFoliaProvenance(playlist.origin, t, i18n.language)
        : origin.collectionType === 'album'
            ? t('foliaTransfer.fromAlbum', { source: sourceLabel, name: origin.name })
            : t('foliaTransfer.fromPlaylist', { source: sourceLabel, name: origin.name });

    // 单选组的键盘约定：焦点只落在选中的那一项上，上下左右在能选的项之间换。
    const selectableValues = [KEEP_ORIGIN, ...options.filter(target => !target.unavailable).map(target => target.sourceId)];
    const onRadioKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1
            : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
        if (step === 0 || isBusy) return;
        event.preventDefault();
        const at = Math.max(selectableValues.indexOf(playVia), 0);
        setPlayVia(selectableValues[(at + step + selectableValues.length) % selectableValues.length] ?? KEEP_ORIGIN);
        const group = event.currentTarget.parentElement;
        window.requestAnimationFrame(() => group?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
    };

    const optionRow = (value: string, label: string, note: string | undefined, disabled: boolean) => {
        const checked = playVia === value;
        // 记着的那个现在问不了时仍是选中的：能看见、能改选别的，但不能重新选回它。
        const blocked = isBusy || (disabled && !checked);
        return (
            <button
                key={value || 'keep'}
                type="button"
                role="radio"
                aria-checked={checked}
                // 置灰的项不用原生 disabled：读屏和键盘还要能读到它旁边写的原因。
                aria-disabled={blocked}
                tabIndex={checked ? 0 : -1}
                data-folia-play-via={value || 'keep'}
                onClick={() => {
                    if (!blocked) setPlayVia(value);
                }}
                onKeyDown={onRadioKeyDown}
                className="st-row st-focus-inside st-t-fast flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors aria-[disabled=false]:hover:bg-[var(--st-fill)] aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            >
                <span
                    aria-hidden
                    className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${checked ? 'border-[var(--st-accent)]' : 'border-[var(--st-line2)]'}`}
                >
                    {checked && <span className="h-2 w-2 rounded-full bg-[var(--st-accent)]" />}
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] leading-5">{label}</span>
                    {note && <span className="block text-xs leading-[18px] text-[color:var(--st-t2)]">{note}</span>}
                </span>
            </button>
        );
    };

    return (
        <ThemedDialog
            isOpen
            onClose={cancel}
            isDaylight={isDaylight}
            title={request.mode === 'save' ? t('foliaTransfer.saveTitle') : t('foliaTransfer.refreshTitle')}
            description={provenance}
            size="m"
            footerNote={isBusy ? (
                <span className="flex items-center gap-2" role="status" data-folia-transfer-progress={phase.step}>
                    <Loader2 size={14} className="shrink-0 animate-spin" />
                    <span className="min-w-0">{progressText}</span>
                </span>
            ) : undefined}
            footer={(
                <>
                    <SheetButton onClick={cancel} data-folia-transfer-action="cancel">
                        {t('localMusic.cancel')}
                    </SheetButton>
                    <SheetButton
                        variant="primary"
                        onClick={() => void run()}
                        disabled={isBusy || (request.mode === 'save' && !trimmedName)}
                        data-folia-transfer-action="confirm"
                        // 更新时没有名字框：打开时焦点落在「更新」上，不改选择的话按一下回车就行。
                        {...(request.mode === 'refresh' ? { 'data-autofocus': true } : {})}
                    >
                        {request.mode === 'save' ? t('foliaTransfer.saveConfirm') : needsOriginConfirmation ? t('foliaTransfer.fileOriginConfirm') : t('foliaTransfer.refreshConfirm')}
                    </SheetButton>
                </>
            )}
        >
            <div className="flex flex-col gap-4" data-folia-transfer={request.mode}>
                {request.mode === 'save' && (
                    <label className="flex flex-col gap-1.5">
                        <span className="text-xs leading-[18px] text-[color:var(--st-t2)]">{t('foliaTransfer.nameLabel')}</span>
                        <input
                            data-autofocus
                            type="text"
                            value={name}
                            disabled={isBusy}
                            onChange={event => setName(event.target.value)}
                            onKeyDown={event => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    void run();
                                }
                            }}
                            placeholder={t('localMusic.enterPlaylistName')}
                            aria-label={t('localMusic.enterPlaylistName')}
                            className="st-t-fast h-9 w-full rounded-lg border border-transparent bg-[var(--st-fill)] px-3 text-[13px] text-[color:var(--st-t1)] outline-none transition-colors placeholder:text-[color:var(--st-t3)] focus:border-[var(--st-accent)] disabled:opacity-60"
                        />
                    </label>
                )}
                {options.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                        <span id="folia-transfer-play-via" className="text-xs leading-[18px] text-[color:var(--st-t2)]">{t('foliaTransfer.playViaLabel')}</span>
                        <div role="radiogroup" aria-labelledby="folia-transfer-play-via" className="flex flex-col gap-0.5">
                            {optionRow(KEEP_ORIGIN, t('foliaTransfer.playViaKeep', { source: sourceLabel }), undefined, false)}
                            {options.map(target => optionRow(
                                target.sourceId,
                                t('foliaTransfer.playViaTarget', { source: getFoliaSourceLabel(target.sourceId, t) }),
                                target.unavailable ? describePlayViaUnavailable(target.unavailable, t) : undefined,
                                Boolean(target.unavailable),
                            ))}
                        </div>
                        <p className="text-xs leading-[18px] text-[color:var(--st-t3)]">{t('foliaTransfer.playViaHint')}</p>
                    </div>
                )}
                {needsOriginConfirmation && (
                    <p className="rounded-lg bg-[var(--st-fill)] px-3 py-2 text-xs leading-[18px] text-[color:var(--st-t1)]" role="note" data-folia-transfer-file-origin>
                        {t('foliaTransfer.fileOriginNotice', { source: sourceLabel, name: origin.name || origin.collectionId, id: origin.collectionId })}
                    </p>
                )}
                {request.mode === 'refresh' && (
                    <p className="text-xs leading-[18px] text-[color:var(--st-t2)]">{t('foliaTransfer.refreshHint')}</p>
                )}
            </div>
        </ThemedDialog>
    );
};

export default FoliaTransferDialog;
