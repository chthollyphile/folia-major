import React, { useEffect, useRef, useState } from 'react';
import './lxWorkspace.css';
import { Button, TextField, TextArea, Checkbox } from '../ui';
import { lxSourceStore } from '../../services/onlineMusic/lxmusic/lxSourceStore';
import { importLxSourceFromFile, importLxSourceFromUrl, type ImportResult } from '../../services/onlineMusic/lxmusic/lxImportService';
import type { LxSource } from '../../services/onlineMusic/lxmusic/lxTypes';
import { LX_PUBLIC_PLATFORMS } from '../../services/onlineMusic/lxmusic/lxFacade';
import {
    formatPlaybackDiagnostics,
    clearPlaybackDiagnostics,
    readPlaybackDiagnostics,
    type LxPlaybackDiag,
} from '../../services/onlineMusic/lxmusic/lxDiagnostics';
import {
    getLxPreferences,
    setLxPreferences,
    subscribeLxPreferences,
    type LxPreferences,
} from '../../services/onlineMusic/lxmusic/lxPreferences';
import { useLxWorkspaceStore } from '../../stores/useLxWorkspaceStore';

// src/components/lxmusic/LxSourcePanel.tsx
// 洛雪「音源」页：粘贴网址导入 / 选 .js·.json 文件导入，列出已导入的音源并启用、停用、删除。

const PLATFORM_LABELS: Record<string, string> = {
    wy: '网易云', kg: '酷狗', tx: 'QQ', kw: '酷我', mg: '咪咕', local: '本地',
};

type ImportTab = 'url' | 'file';

type LxSourcePanelProps = {
    /** 音源变动后回调（工作台用它刷新「能不能放」的提示）。 */
    onChanged?: () => void;
};

export const LxSourcePanel: React.FC<LxSourcePanelProps> = ({ onChanged }) => {
    const [tab, setTab] = useState<ImportTab>('url');
    const [url, setUrl] = useState('');
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
    const [dragging, setDragging] = useState(false);
    const [sources, setSources] = useState<LxSource[]>(() => lxSourceStore.getSources());
    const [diagText, setDiagText] = useState<string | null>(null);
    const [prefs, setPrefs] = useState<LxPreferences>(getLxPreferences);
    const [lastAttempt, setLastAttempt] = useState<LxPlaybackDiag | null>(() => {
        const list = readPlaybackDiagnostics();
        return list.length > 0 ? list[list.length - 1] : null;
    });
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const unsubscribe = lxSourceStore.subscribe(() => {
            setSources([...lxSourceStore.getSources()]);
            onChanged?.();
        });
        setSources([...lxSourceStore.getSources()]);
        void lxSourceStore.init();
        return unsubscribe;
    }, [onChanged]);

    useEffect(() => subscribeLxPreferences(() => setPrefs(getLxPreferences())), []);

    const refreshLastAttempt = () => {
        const list = readPlaybackDiagnostics();
        setLastAttempt(list.length > 0 ? list[list.length - 1] : null);
    };

    const report = (result: ImportResult) => {
        if (result.ok) {
            setFeedback({
                kind: 'ok',
                text: `已导入音源「${result.source.meta.name}」${result.source.error ? '（但脚本加载出错，见下方）' : ''}。`,
            });
        } else {
            setFeedback({ kind: 'err', text: result.error });
        }
    };

    const doImportUrl = async () => {
        if (!url.trim() || busy) return;
        setBusy(true);
        setFeedback(null);
        const result = await importLxSourceFromUrl(url.trim());
        report(result);
        setBusy(false);
    };

    const copyDiagnostics = async () => {
        refreshLastAttempt();
        const text = formatPlaybackDiagnostics();
        try {
            await navigator.clipboard.writeText(text);
            setDiagText(null);
            setFeedback({ kind: 'ok', text: '播放诊断已复制到剪贴板，粘贴发出来即可。' });
        } catch {
            // 部分 WebView 不给写剪贴板：把文本摊开在页面上，长按也能复制。
            setDiagText(text);
        }
    };

    const doImportFiles = async (files: FileList | File[]) => {
        setBusy(true);
        setFeedback(null);
        for (const file of Array.from(files)) {
            const result = await importLxSourceFromFile(file);
            report(result);
        }
        setBusy(false);
    };

    return (
        <div className="flex flex-col gap-4">
            {/* 入口：工作台是洛雪自己的「歌单 / 电台 / 专辑 / 榜单 / 本地 / 搜索」，整页浮层。 */}
            <div className="lx-chips flex flex-wrap gap-2">
                <Button
                    type="button"
                    variant="fill"
                    size="md"
                    onClick={() => useLxWorkspaceStore.getState().open('playlist')}
                >
                    打开洛雪工作台
                </Button>
                <Button
                    type="button"
                    variant="quiet"
                    size="md"
                    onClick={() => useLxWorkspaceStore.getState().open('search')}
                >
                    直接去搜索
                </Button>
            </div>

            <div className="lx-notice">
                导入的音源负责「取播放地址与歌词」，且优先于默认播放接口：搜索、歌单广场、榜单仍由洛雪内置的公开接口提供。
                只有所有音源都交不出地址时，才会（在开关允许的前提下）退回公开免费直链。
            </div>

            <div className="lx-notice flex flex-col gap-2">
                <div className="text-[12px] font-semibold">播放路由</div>
                <label className="flex items-start gap-2 text-[11px] leading-4">
                    <Checkbox
                        type="checkbox"
                        className="mt-0.5 shrink-0"
                        checked={prefs.routeAllSongs}
                        onChange={(event) => setLxPreferences({ routeAllSongs: event.target.checked })}
                    />
                    <span>所有歌曲都先走导入的音源（含网易云 / 酷狗 / QQ 等其它来源）；音源都失败才回落原来的播放接口。</span>
                </label>
                <label className="flex items-start gap-2 text-[11px] leading-4">
                    <Checkbox
                        type="checkbox"
                        className="mt-0.5 shrink-0"
                        checked={prefs.allowPublicFallback}
                        onChange={(event) => setLxPreferences({ allowPublicFallback: event.target.checked })}
                    />
                    <span>音源全失败时允许公开免费直链兜底。关掉后严格只用音源，放不出来就是放不出来。</span>
                </label>
                {lastAttempt && (
                    <p className="text-[10.5px] leading-4 text-[color:var(--lx-faint)]">
                        最近一次取地址：{lastAttempt.ok ? '成功' : '失败'} · {lastAttempt.via ?? '未知来源'}
                        {lastAttempt.host ? ` · ${lastAttempt.host}` : ''}
                        {lastAttempt.name ? ` · ${lastAttempt.name}` : ''}
                    </p>
                )}
            </div>

            <div className="lx-chips flex flex-wrap gap-2">
                <Button type="button" variant={tab === 'url' ? 'fill' : 'quiet'} size="sm" onClick={() => setTab('url')}>在线导入</Button>
                <Button type="button" variant={tab === 'file' ? 'fill' : 'quiet'} size="sm" onClick={() => setTab('file')}>本地文件</Button>
            </div>

            {tab === 'url' ? (
                <div className="flex flex-col gap-2">
                    <div className="lx-search-row">
                        <TextField
                            className="lx-input"
                            value={url}
                            onChange={(event) => setUrl(event.target.value)}
                            onKeyDown={(event) => { if (event.key === 'Enter') void doImportUrl(); }}
                            placeholder="音源脚本地址，https://…/xxx.js"
                            inputMode="url"
                            autoCapitalize="off"
                            autoCorrect="off"
                            spellCheck={false}
                        />
                        <Button type="button" className="lx-btn" onClick={() => void doImportUrl()} disabled={busy || !url.trim()}>
                            {busy ? '导入中…' : '导入'}
                        </Button>
                    </div>
                </div>
            ) : (
                <div
                    onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(event) => {
                        event.preventDefault();
                        setDragging(false);
                        if (event.dataTransfer.files.length) void doImportFiles(event.dataTransfer.files);
                    }}
                    className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-7 text-center ${dragging ? 'border-[var(--lx-accent)]' : 'border-[var(--lx-line)]'}`}
                >
                    <p className="text-xs text-[color:var(--lx-soft)]">把音源文件拖到这里，或</p>
                    <Button type="button" className="lx-btn" onClick={() => fileInputRef.current?.click()}>选择 .js / .json 文件</Button>
                    <TextField
                        ref={fileInputRef}
                        type="file"
                        accept=".js,.json,application/javascript,application/json"
                        multiple
                        className="hidden"
                        onChange={(event) => {
                            if (event.target.files?.length) void doImportFiles(event.target.files);
                            event.target.value = '';
                        }}
                    />
                    <p className="text-[11px] text-[color:var(--lx-faint)]">支持一次选多个文件</p>
                </div>
            )}

            {feedback && (
                <div
                    className="rounded-lg px-3 py-2 text-[11.5px] leading-5"
                    style={{
                        color: feedback.kind === 'ok' ? '#16a34a' : '#e11d48',
                        background: feedback.kind === 'ok' ? 'rgba(22,163,74,.1)' : 'rgba(225,29,72,.1)',
                    }}
                >
                    {feedback.text}
                </div>
            )}

            <div className="flex items-center gap-3 text-[11px] text-[color:var(--lx-faint)]">
                <span>播放覆盖：</span>
                {LX_PUBLIC_PLATFORMS.map((platform) => {
                    const ok = lxSourceStore.canResolve(platform.key, 'musicUrl') || platform.key === 'kw';
                    return (
                        <span key={platform.key} style={{ color: ok ? platform.color : undefined }}>
                            {platform.label}{ok ? ' ✓' : ' —'}
                        </span>
                    );
                })}
            </div>

            <div>
                <div className="mb-2 text-[11px] font-medium text-[color:var(--lx-faint)]">已导入音源（{sources.length}）</div>
                {sources.length === 0 ? (
                    <p className="lx-empty">还没有导入任何音源。</p>
                ) : (
                    <ul className="flex flex-col gap-2">
                        {sources.map((source) => (
                            <li key={source.id} className="rounded-xl border border-[var(--lx-line)] p-3">
                                <div className="flex items-start gap-3">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="truncate text-[13px] font-semibold">{source.meta.name}</span>
                                            {source.meta.version && (
                                                <span className="rounded bg-[var(--lx-fill2)] px-1.5 text-[10px] text-[color:var(--lx-soft)]">
                                                    v{source.meta.version}
                                                </span>
                                            )}
                                        </div>
                                        {source.meta.author && (
                                            <p className="mt-0.5 truncate text-[11px] text-[color:var(--lx-faint)]">作者：{source.meta.author}</p>
                                        )}
                                        <div className="mt-1.5 flex flex-wrap gap-1">
                                            {Object.entries(source.sources).map(([key, info]) => (
                                                <span key={key} className="rounded bg-[var(--lx-fill2)] px-1.5 py-0.5 text-[10px] text-[color:var(--lx-soft)]">
                                                    {PLATFORM_LABELS[key] ?? key}
                                                    {info?.actions?.includes('musicUrl') ? ' · 播放' : ''}
                                                    {info?.actions?.includes('lyric') ? ' · 歌词' : ''}
                                                </span>
                                            ))}
                                            {source.error && (
                                                <span className="rounded bg-[#e11d48]/15 px-1.5 py-0.5 text-[10px] text-[#e11d48]">加载失败</span>
                                            )}
                                        </div>
                                        {source.error && (
                                            <p className="mt-1 break-all text-[10px] leading-4 text-[#e11d48]">{source.error}</p>
                                        )}
                                    </div>
                                    <div className="flex shrink-0 flex-col items-end gap-2">
                                        <label className="flex items-center gap-1.5 text-[11px] text-[color:var(--lx-soft)]">
                                            <Checkbox
                                                type="checkbox"
                                                checked={source.enabled}
                                                onChange={() => { void lxSourceStore.setEnabled(source.id, !source.enabled); }}
                                            />
                                            启用
                                        </label>
                                        <Button
                                            type="button"
                                            onClick={() => { void lxSourceStore.removeSource(source.id); }}
                                            className="rounded px-2 py-1 text-[11px] text-[#e11d48] transition-colors hover:bg-[#e11d48]/10"
                                        >
                                            删除
                                        </Button>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <div className="lx-notice flex flex-wrap items-center gap-2">
                <Button type="button" className="lx-btn-ghost" onClick={() => { void copyDiagnostics(); }}>复制播放诊断</Button>
                <Button
                    type="button"
                    className="lx-btn-ghost"
                    onClick={() => { clearPlaybackDiagnostics(); setDiagText(null); setLastAttempt(null); setFeedback({ kind: 'ok', text: '播放记录已清空。' }); }}
                >
                    清空记录
                </Button>
                <span>有歌放不出来时点「复制播放诊断」，把最近 40 次取地址的现场发给开发者。</span>
            </div>
            {diagText && (
                <TextArea
                    readOnly
                    value={diagText}
                    rows={8}
                    aria-label="播放诊断文本"
                    style={{
                        width: '100%', minHeight: 160, fontSize: 11, lineHeight: 1.5,
                        background: 'rgba(0,0,0,.35)', color: 'inherit',
                        border: '1px solid rgba(255,255,255,.2)', borderRadius: 8, padding: 8,
                    }}
                />
            )}

            <p className="text-[10.5px] leading-4 text-[color:var(--lx-faint)]">
                音源脚本在本应用内直接执行，与洛雪桌面端同一个信任模型：只导入你信得过的脚本。
            </p>

            <p className="text-[10px] leading-4 text-[color:var(--lx-faint)]">
                当前安装包 v{typeof __APP_VERSION__ === 'undefined' ? '?' : __APP_VERSION__}
                {typeof __COMMIT_HASH__ === 'undefined' ? '' : ` · 构建 ${__COMMIT_HASH__.slice(0, 7)}`}
            </p>
        </div>
    );
};

export default LxSourcePanel;
