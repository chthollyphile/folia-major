import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, RotateCcw, ServerCog, X } from 'lucide-react';
import { motion } from 'framer-motion';
import QrLoginFailureHelp, { type QrLoginFailureHelpProps } from './QrLoginFailureHelp';
import { getCustomSpotifyClientId, setSpotifyClientId, SPOTIFY_REDIRECT_URI } from '../../../../services/onlineMusic/spotifyClientId';

// src/library/suites/grid/account/OnlineProviderLoginModal.tsx
// 扫码登录弹窗。平时是窄的单栏：二维码、状态行、重试 / 重启；登录失败后变成两栏，失败帮助（简单办法、自检、
// 收起的诊断与反馈）放在二维码旁边，窄窗口里再折回上下排列。

// 可选的登录方式选择（两步式）。provider 不声明就不传，弹窗完全维持原本的单步外观。
// 所有文案都由调用方翻译好再传进来，与 title / statusText 的既有做法一致。
type LoginMethodsProps = {
    title: string;
    hint: string;
    pendingText: string;
    currentText: string;
    options: Array<{ id: string; label: string; iconUrl: string }>;
    selectedId: string | null;
    onSelect: (id: string) => void;
};

// 后端没起来时二维码永远拿不到，重试只会再报一次同样的错。这里直接把二维码换成失败原因
// 和「重启后端」按钮，让用户不必重开整个 App。
type BackendFailureProps = {
    title: string;
    detail: string | null;
    restartLabel: string;
    restartingLabel: string;
    restarting: boolean;
    /** 不传就不显示重启按钮（suite 没声明 account-backend-restart 时），故障原因照样显示。 */
    onRestart?: () => void;
};

type OnlineProviderLoginModalProps = {
    title: string;
    note: string;
    qrCodeImg: string;
    statusText: string;
    state: 'idle' | 'loading' | 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'error';
    retryLabel: string;
    closeLabel: string;
    /** 后端冷却中：重试按钮照常出现但不可点（状态行说明还要等多久），冷却结束后恢复。 */
    retryDisabled?: boolean;
    loginMethods?: LoginMethodsProps;
    backendFailure?: BackendFailureProps;
    // 只在扫码登录失败时传入（含后端没拉起来），显示在二维码旁边。
    failureHelp?: QrLoginFailureHelpProps;
    providerId?: string;
    onRetry: () => void;
    /** 整轮重启登录（重开一次要码会话）。retryLogin 只在失败态放行，等待中改配置必须走这条。 */
    onRestartLogin?: () => void;
    onClose: () => void;
};

const OnlineProviderLoginModal = ({
    title,
    note,
    qrCodeImg,
    statusText,
    state,
    retryLabel,
    closeLabel,
    retryDisabled = false,
    loginMethods,
    backendFailure,
    failureHelp,
    providerId,
    onRetry,
    onRestartLogin,
    onClose,
}: OnlineProviderLoginModalProps) => {
    // 步骤一：还没选登录方式，二维码区显示占位框，且不会向后端发出任何请求。
    const awaitingMethod = Boolean(loginMethods) && loginMethods?.selectedId == null;
    // 后端故障优先于其余所有状态：这时候刷新二维码没有意义。
    const canRetry = (state === 'expired' || state === 'error') && !awaitingMethod && !backendFailure;
    const twoColumns = Boolean(failureHelp);

    const [librespotAuth, setLibrespotAuth] = useState<{ code: string; url: string } | null>(null);

    useEffect(() => {
        if (providerId !== 'spotify' || typeof window === 'undefined') return;
        const fetchAuthCode = window.electron?.getLibrespotAuthCode;
        if (!fetchAuthCode) return;

        let cancelled = false;
        let timer: number | null = null;

        // 守护进程可能还没起来、或刚重启过，配对码要补取；拿到之后就不再轮询
        const load = async () => {
            const res = await fetchAuthCode().catch(() => null);
            if (cancelled || !res) return;
            setLibrespotAuth(res);
            if (timer !== null) {
                window.clearInterval(timer);
                timer = null;
            }
        };

        void load();
        timer = window.setInterval(() => void load(), 5000);
        return () => {
            cancelled = true;
            if (timer !== null) window.clearInterval(timer);
        };
    }, [providerId]);

    const [spotifyClientIdDraft, setSpotifyClientIdDraft] = useState(
        () => (providerId === 'spotify' ? getCustomSpotifyClientId() : ''),
    );
    const [copiedRedirectUri, setCopiedRedirectUri] = useState(false);
    const [spotifyClientIdSaved, setSpotifyClientIdSaved] = useState(false);

    /** 保存用户自己的 Spotify Client ID 并重走登录：旧令牌已随切换失效，必须重新授权 */
    const handleSaveSpotifyClientId = () => {
        setSpotifyClientId(spotifyClientIdDraft);
        // 旧的本地回调与那个用旧 id 打开的授权页一起作废，否则旧页面送回来的 code 只会换出 invalid_grant
        void window.electron?.stopSpotifyAuthServer?.();
        setSpotifyClientIdSaved(true);
        window.setTimeout(() => setSpotifyClientIdSaved(false), 3000);
        if (onRestartLogin) onRestartLogin();
        else onRetry();
    };

    /** 复制回调地址，方便直接粘进 Spotify Dashboard 的 Redirect URI 设置 */
    const handleCopyRedirectUri = () => {
        if (typeof navigator === 'undefined' || !navigator.clipboard) return;
        void navigator.clipboard.writeText(SPOTIFY_REDIRECT_URI).then(() => {
            setCopiedRedirectUri(true);
            window.setTimeout(() => setCopiedRedirectUri(false), 2000);
        }).catch(() => {});
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-xl p-4"
            role="dialog"
            aria-modal="true"
            aria-label={title}
        >
            <motion.div
                initial={{ scale: 0.92, opacity: 0, y: 24 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.92, opacity: 0, y: 12 }}
                transition={{ type: 'spring', bounce: 0, duration: 0.5 }}
                // 失败后加宽成两栏；矮窗口里放不下时在卡片内滚动，而不是被上下裁掉。
                className={`bg-zinc-900/90 border border-white/10 p-8 rounded-3xl w-full max-h-full overflow-y-auto text-center relative shadow-2xl ${twoColumns ? 'max-w-3xl' : 'max-w-sm'}`}
            >
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={closeLabel}
                    className="absolute top-4 right-4 opacity-40 hover:opacity-100 rounded-full bg-white/5 p-1 transition-colors cursor-pointer"
                    style={{ color: 'var(--text-primary)' }}
                >
                    <X size={16} />
                </button>
                <h3 className="text-lg font-bold mb-6" style={{ color: 'var(--text-primary)' }}>{title}</h3>
                {loginMethods && (
                    <div className="mb-5">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-45 mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                            {loginMethods.title}
                        </p>
                        <p className="text-[11px] leading-snug whitespace-pre-line opacity-55 mb-3" style={{ color: 'var(--text-secondary)' }}>
                            {loginMethods.hint}
                        </p>
                        <div className="flex items-center justify-center gap-3">
                            {loginMethods.options.map(option => {
                                const selected = loginMethods.selectedId === option.id;
                                return (
                                    <button
                                        key={option.id}
                                        type="button"
                                        aria-pressed={selected}
                                        onClick={() => loginMethods.onSelect(option.id)}
                                        className={`relative flex flex-1 items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-xs font-semibold transition-colors cursor-pointer ${selected
                                            ? 'border-green-500 bg-green-500/10 text-white'
                                            : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'}`}
                                    >
                                        {selected && (
                                            <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-white">
                                                <Check size={11} strokeWidth={3} />
                                            </span>
                                        )}
                                        <img src={option.iconUrl} alt="" aria-hidden="true" className="w-6 h-6 object-contain" />
                                        <span>{option.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
                <div className={twoColumns ? 'flex flex-col items-center gap-6 sm:flex-row sm:items-start' : 'flex flex-col items-center'}>
                    {/* 左栏：二维码（或后端故障原因）、状态行、重启 / 重试。 */}
                    <div className={`flex flex-col items-center ${twoColumns ? 'w-full sm:w-48 sm:shrink-0' : ''}`}>
                        <div className="relative inline-block bg-white p-2 rounded-xl mb-4 shadow-inner">
                            {backendFailure ? (
                                <div className="w-40 h-40 flex flex-col items-center justify-center gap-1.5 rounded-lg bg-red-50 px-3 text-center">
                                    <AlertTriangle className="text-red-500 shrink-0" size={22} />
                                    <p className="text-[11px] font-semibold leading-snug text-red-600">{backendFailure.title}</p>
                                    {backendFailure.detail && (
                                        <p className="max-h-14 w-full overflow-y-auto break-words text-[9px] leading-tight text-red-500/80">
                                            {backendFailure.detail}
                                        </p>
                                    )}
                                </div>
                            ) : awaitingMethod ? (
                                <div className="w-40 h-40 flex items-center justify-center rounded-lg border-2 border-dashed border-gray-300 px-4 text-center text-[11px] font-medium leading-snug text-gray-400">
                                    {loginMethods?.pendingText}
                                </div>
                            ) : qrCodeImg ? (
                                <img src={qrCodeImg} alt="QR Code" className="w-40 h-40" />
                            ) : (
                                <div className="w-40 h-40 flex items-center justify-center bg-gray-100 rounded-lg">
                                    <Loader2 className="animate-spin text-gray-400" size={24} />
                                </div>
                            )}
                        </div>
                        {loginMethods && !awaitingMethod && (
                            <p className="text-[11px] font-medium opacity-45" style={{ color: 'var(--text-secondary)' }}>
                                {loginMethods.currentText}
                            </p>
                        )}
                        {/* 步骤一不显示状态文案：关窗重开时 hook 里还留着上一轮的状态，照原样显示会是过期信息。 */}
                        <p className={`text-xs font-medium mt-2 ${state === 'confirmed' ? 'text-green-400' : 'opacity-60'}`} style={{ color: state === 'confirmed' ? undefined : 'var(--text-secondary)' }}>
                            {awaitingMethod || backendFailure ? '' : statusText}
                        </p>
                        {providerId === 'spotify' && state !== 'confirmed' && (
                            <div className="flex flex-col items-center">
                                <p className="text-[11px] text-emerald-400/90 mt-2 font-medium px-4 leading-relaxed text-center">
                                    已在浏览器中打开 Spotify 授权页面，请在网页中确认授权。这个二维码是同一个授权页的地址，回调只能回到本机，请不要用手机扫码。
                                </p>
                                {librespotAuth && (
                                    <div className="mt-3 w-full max-w-xs p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
                                        <p className="text-[11px] text-emerald-300 font-medium">
                                            官方无损流媒体配对码：
                                            <span className="font-mono font-bold tracking-wider text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded ml-1">
                                                {librespotAuth.code}
                                            </span>
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => void window.electron?.openExternalUrl?.(librespotAuth.url)}
                                            className="mt-2 px-3 py-1 rounded-full bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-[11px] font-semibold transition-colors"
                                        >
                                            在网页中一键配对 Spotify Connect (320k全长)
                                        </button>
                                    </div>
                                )}
                                <details open className="mt-3 w-full max-w-xs text-left">
                                    <summary className="cursor-pointer text-[11px] font-semibold text-emerald-300/90 hover:text-emerald-200 transition-colors">
                                        登录报错？用你自己的 Spotify Client ID
                                    </summary>
                                    <div className="mt-2 p-2.5 rounded-xl bg-white/5 border border-white/10">
                                        <p className="mb-2 text-[10px] leading-relaxed text-white/55">
                                            Client ID 要去 Spotify 开发者后台拿，四步：
                                        </p>
                                        <p className="mb-2 space-y-0.5 text-[10px] leading-relaxed text-white/55">
                                            <span className="block">1. 点下面「创建自己的 app」，打开 developer.spotify.com/dashboard/create。</span>
                                            <span className="block">2. 名字随便填，勾上 Web API；Redirect URI 填下面「复制回调地址」得到的那串，必须一字不差。</span>
                                            <span className="block">3. 建好后进 app 的 Settings，复制 Client ID，粘到下面的输入框。</span>
                                            <span className="block">4. 保存并重新登录。该账号要有 Spotify Premium；开发模式的 app 只放行白名单账号，所以每个账号用自己的 app。</span>
                                        </p>
                                        <input
                                            type="text"
                                            value={spotifyClientIdDraft}
                                            onChange={event => setSpotifyClientIdDraft(event.target.value)}
                                            placeholder="粘贴 32 位 Client ID，留空用内置默认值"
                                            spellCheck={false}
                                            className="w-full px-2 py-1.5 rounded-lg bg-black/40 border border-white/10 text-[11px] font-mono text-white/90 outline-none focus:border-emerald-500/60"
                                        />
                                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                            <button
                                                type="button"
                                                onClick={handleSaveSpotifyClientId}
                                                className="px-2.5 py-1 rounded-full bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 text-[11px] font-semibold transition-colors"
                                            >
                                                {spotifyClientIdSaved ? '已保存，正在重新登录…' : '保存并重新登录'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void window.electron?.openExternalUrl?.('https://developer.spotify.com/dashboard/create')}
                                                className="px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/15 text-[11px] font-semibold transition-colors"
                                            >
                                                创建自己的 app
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleCopyRedirectUri}
                                                className="px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/15 text-[11px] font-semibold transition-colors"
                                            >
                                                {copiedRedirectUri ? '已复制回调地址' : '复制回调地址'}
                                            </button>
                                        </div>
                                    </div>
                                </details>
                            </div>
                        )}
                        {backendFailure?.onRestart && (
                            <button
                                type="button"
                                onClick={backendFailure.onRestart}
                                disabled={backendFailure.restarting}
                                className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-full bg-white/10 hover:bg-white/15 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-default"
                            >
                                {backendFailure.restarting
                                    ? <Loader2 size={13} className="animate-spin" />
                                    : <ServerCog size={13} />}
                                {backendFailure.restarting ? backendFailure.restartingLabel : backendFailure.restartLabel}
                            </button>
                        )}
                        {canRetry && (
                            <button type="button" onClick={onRetry} disabled={retryDisabled} className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-full bg-white/10 hover:bg-white/15 text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-default disabled:hover:bg-white/10">
                                <RotateCcw size={13} />
                                {retryLabel}
                            </button>
                        )}
                    </div>
                    {/* 右栏：失败帮助。后端没拉起来时同样给：重启解决不了时，报告里有拉起的每一步与错误原文。 */}
                    {failureHelp && (
                        <div className="w-full min-w-0 flex-1">
                            <QrLoginFailureHelp {...failureHelp} />
                        </div>
                    )}
                </div>
                <p className="text-[10px] opacity-30 mt-6" style={{ color: 'var(--text-secondary)' }}>{note}</p>
            </motion.div>
        </motion.div>
    );
};

export default OnlineProviderLoginModal;
