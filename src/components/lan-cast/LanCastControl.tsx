import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence, useTransform, type MotionValue } from 'framer-motion';
import { Cast, Check, Loader2, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePlaybackStore, selectDisplaySong, selectDisplayCoverUrl } from '../../stores/usePlaybackStore';
import { getSongArtistLabel } from '../../services/onlineMusic/songMetadata';
import {
    castTrackToSpeaker,
    discoverLanSpeakers,
    ensureCastingMute,
    getCastingSpeaker,
    isLanCastAvailable,
    lanCastErrorText,
    markPushedCast,
    stopCastingToSpeaker,
    subscribeCasting,
    type LanSpeaker,
} from '../../services/lanCast';

// src/components/lan-cast/LanCastControl.tsx
// 局域网音响投送：播放页左侧那颗镜像 PanelHandle 的圆钮，点开是一块设备列表面板。
//
// 桌面与安卓共用这一个组件：能不能用由 isLanCastAvailable() 决定（桌面端是主进程的
// electron/lanCast，安卓是 FoliaLanCast 原生插件），不可用的平台整块不渲染。
// 投送成功后本机静音但继续走进度与歌词，切歌自动跟着推给同一台音响。

type LanCastControlProps = {
    hidden: boolean;
    /** 与 PanelHandle 同一套底边距（播放进度联动），面板再往上让 64px。 */
    bottom: MotionValue<number>;
    isDaylight: boolean;
    isCommandPaletteOpen: boolean;
};

const PANEL_GAP_PX = 64;
const SEARCH_TIMEOUT_MS = 3200;

const LanCastControl: React.FC<LanCastControlProps> = ({
    hidden,
    bottom,
    isDaylight,
    isCommandPaletteOpen,
}) => {
    const { t } = useTranslation();
    const song = usePlaybackStore(selectDisplaySong);
    const audioSrc = usePlaybackStore(state => state.audioSrc);
    const coverUrl = usePlaybackStore(selectDisplayCoverUrl);

    const available = isLanCastAvailable();
    const [panelOpen, setPanelOpen] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [speakers, setSpeakers] = useState<LanSpeaker[]>([]);
    const [casting, setCasting] = useState<LanSpeaker | null>(() => getCastingSpeaker());
    const [error, setError] = useState('');
    const panelBottom = useTransform(bottom, value => value + PANEL_GAP_PX);

    // 跨组件共享的会话：离开播放页再回来仍然显示「正在投送」。
    useEffect(() => subscribeCasting(() => setCasting(getCastingSpeaker())), []);

    const scan = useCallback(async () => {
        if (scanning) return;
        setScanning(true);
        setError('');
        try {
            const found = await discoverLanSpeakers(SEARCH_TIMEOUT_MS);
            setSpeakers(found);
        } catch (scanError) {
            setSpeakers([]);
            setError(lanCastErrorText(scanError));
        } finally {
            setScanning(false);
        }
    }, [scanning]);

    const pushCurrentSong = useCallback(async (speaker: LanSpeaker) => {
        if (!song || !audioSrc) throw new Error(t('lanCastNoTrack'));
        await castTrackToSpeaker(speaker, {
            url: audioSrc,
            title: song.name,
            artist: getSongArtistLabel(song),
            album: song.album.name,
            // 音响只认公网可达的封面地址；协议地址（folia-*）与本地文件它拉不到。
            coverUrl: /^https:\/\//i.test(coverUrl || '') ? coverUrl || undefined : undefined,
            durationMs: song.durationMs,
        });
        setCasting(speaker);
        // 记下已推的这首：全局跟随（LanCastFollower）看到记录就不再重复推一次。
        markPushedCast(`${song.id}::${song.name}`, audioSrc);
        setError('');
    }, [audioSrc, coverUrl, song, t]);

    const openPanel = useCallback(() => {
        setPanelOpen(true);
        // 打开就扫一轮，省掉一次多余的点击。
        if (!scanning) void scan();
    }, [scan, scanning]);

    const handlePick = useCallback(async (speaker: LanSpeaker) => {
        try {
            await pushCurrentSong(speaker);
        } catch (pickError) {
            setError(lanCastErrorText(pickError));
        }
    }, [pushCurrentSong]);

    const handleStop = useCallback(async () => {
        try {
            await stopCastingToSpeaker();
            setCasting(null);
            setError('');
        } catch (stopError) {
            setCasting(null);
            setError(lanCastErrorText(stopError));
        }
    }, []);

    // 切歌跟随不在这里做：面板只在播放页挂载，挪去全局的 LanCastFollower 才能在别的页面也跟上。

    // 投送中若本机被解除静音（例如拖了音量条），这里再压一次。
    useEffect(() => {
        if (!casting) return;
        const timer = setInterval(() => ensureCastingMute(), 800);
        return () => clearInterval(timer);
    }, [casting]);

    // 面板开着时点播放页其余位置（或被命令面板顶掉）就收起。
    useEffect(() => {
        if (isCommandPaletteOpen && panelOpen) setPanelOpen(false);
    }, [isCommandPaletteOpen, panelOpen]);

    if (!available) return null;

    const hideButton = hidden || panelOpen;

    return (    <>
        {!hideButton && (
            <motion.div
                className="pointer-events-auto fixed left-0 z-30 pl-4 md:pl-8"
                style={{ bottom }}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.2 }}
                data-testid="lan-cast-toggle"
            >
                <button
                    type="button"
                    title={casting ? (t('lanCastFollowed', { name: casting.name })) : (t('lanCastTitle'))}
                    aria-label={t('lanCastTitle')}
                    onClick={openPanel}
                    className={`w-12 h-12 rounded-full flex items-center justify-center border backdrop-blur-xl transition-colors ${
                        casting
                            ? 'bg-white text-black border-white/60'
                            : isDaylight
                                ? 'bg-white/70 text-zinc-900 border-black/10 hover:bg-white'
                                : 'bg-black/40 text-white border-white/15 hover:bg-black/60'
                    }`}
                    style={{
                        outline: '1px solid rgba(40,40,40,0.2)',
                        boxShadow: '2px 2px 8px 2px rgba(40,40,40,0.4)',
                    }}
                >
                    <Cast size={20} />
                </button>
            </motion.div>
        )}

        <AnimatePresence>
            {panelOpen && (
                <motion.div
                    className="pointer-events-auto fixed left-0 z-40 pl-4 md:pl-8"
                    style={{ bottom: panelBottom }}
                    initial={{ opacity: 0, y: 12, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 12, scale: 0.96 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                >
                    <div
                        className={`w-[300px] rounded-2xl border p-4 backdrop-blur-2xl shadow-2xl ${
                            isDaylight
                                ? 'bg-white/85 border-black/10 text-zinc-900'
                                : 'bg-black/70 border-white/12 text-white'
                        }`}
                        data-testid="lan-cast-panel"
                    >
                        <div className="flex items-start justify-between gap-2">
                            <div>
                                <div className="text-[13px] font-medium">{t('lanCastTitle')}</div>
                                <div className={`mt-0.5 text-[11px] ${isDaylight ? 'text-zinc-500' : 'text-white/55'}`}>
                                    {t('lanCastHint')}
                                </div>
                            </div>
                            <button
                                type="button"
                                title={t('lanCastClose')}
                                aria-label={t('lanCastClose')}
                                onClick={() => setPanelOpen(false)}
                                className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
                                    isDaylight ? 'text-zinc-500 hover:bg-black/5' : 'text-white/60 hover:bg-white/10'
                                }`}
                            >
                                <X size={14} />
                            </button>
                        </div>

                        {casting ? (
                            <div
                                className={`mt-3 rounded-xl px-3 py-2.5 text-[11px] leading-relaxed ${
                                    isDaylight ? 'bg-black/5 text-zinc-700' : 'bg-white/8 text-white/75'
                                }`}
                            >
                                <div className="flex items-center gap-1.5 text-[12px] font-medium">
                                    <Check size={14} />
                                    {t('lanCastPlaying', { name: casting.name })}
                                </div>
                                <div className="mt-1 opacity-80">{t('lanCastFollowed', { name: casting.name })}</div>
                                <div className="mt-1 opacity-60">{t('lanCastLocalHint')}</div>
                            </div>
                        ) : (
                            <div className={`mt-3 text-[11px] ${isDaylight ? 'text-zinc-500' : 'text-white/55'}`}>
                                {song ? `${song.name} · ${getSongArtistLabel(song)}` : t('lanCastNoTrack')}
                            </div>
                        )}

                        <div className="mt-3 flex items-center justify-between">
                            <span className={`text-[11px] ${isDaylight ? 'text-zinc-500' : 'text-white/55'}`}>
                                {scanning
                                    ? t('lanCastScanning')
                                    : speakers.length > 0
                                        ? t('lanCastDevices', { count: speakers.length })
                                        : t('lanCastNoDevice')}
                            </span>
                            <button
                                type="button"
                                title={t('lanCastRescan')}
                                aria-label={t('lanCastRescan')}
                                onClick={() => { void scan(); }}
                                disabled={scanning}
                                className={`w-7 h-7 rounded-full flex items-center justify-center disabled:opacity-40 ${
                                    isDaylight ? 'text-zinc-500 hover:bg-black/5' : 'text-white/60 hover:bg-white/10'
                                }`}
                            >
                                <RefreshCw size={14} className={scanning ? 'animate-spin' : ''} />
                            </button>
                        </div>

                        <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                            {scanning && speakers.length === 0 && (
                                <div className={`flex items-center gap-2 px-1 py-3 text-[11px] ${isDaylight ? 'text-zinc-500' : 'text-white/50'}`}>
                                    <Loader2 size={13} className="animate-spin" />
                                    {t('lanCastScanning')}
                                </div>
                            )}
                            {speakers.map(speaker => {
                                const selected = casting?.controlUrl === speaker.controlUrl;
                                return (
                                    <button
                                        key={speaker.controlUrl}
                                        type="button"
                                        onClick={() => { void handlePick(speaker); }}
                                        disabled={!song || !audioSrc}
                                        className={`w-full text-left rounded-lg px-2.5 py-2 text-[12px] transition-colors disabled:opacity-40 ${
                                            selected
                                                ? isDaylight ? 'bg-black text-white' : 'bg-white text-black'
                                                : isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/10'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="truncate">{speaker.name}</span>
                                            {selected && <Check size={12} className="shrink-0" />}
                                        </div>
                                        {speaker.manufacturer && (
                                            <div className={`mt-0.5 truncate text-[10px] ${selected ? 'opacity-70' : isDaylight ? 'text-zinc-500' : 'text-white/45'}`}>
                                                {speaker.manufacturer}
                                            </div>
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        {error && (
                            <div className="mt-2 text-[11px] leading-relaxed text-red-500">{error}</div>
                        )}
                        {!song && (
                            <div className={`mt-2 text-[11px] ${isDaylight ? 'text-zinc-500' : 'text-white/50'}`}>
                                {t('lanCastNoTrack')}
                            </div>
                        )}

                        {casting && (
                            <button
                                type="button"
                                onClick={() => { void handleStop(); }}
                                className="mt-3 w-full flex items-center justify-center rounded-lg py-2 text-[12px]"
                            >
                                {t('lanCastStop')}
                            </button>
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    </>
    );
};

export default LanCastControl;
