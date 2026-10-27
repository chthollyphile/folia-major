import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ControlServerStatus } from '../../../../../vite-env';
import { Button, CopyValue, Reveal, Row, Status, Toggle, Value } from '../../kit';

// src/components/modal/settings/pages/integration/ControlServerRows.tsx
// The AI 控制（CLI / MCP）rows of the 连接与集成 page: the control server switch, its address and
// token, the MCP client configuration, and a one-click prompt that installs the agent with this
// machine's real paths and token already filled in.
//
// The token is read-only here on purpose: the server authenticates with it on every request, so
// replacing it has to restart the server. That is exactly what 重新生成令牌 does.

const MASK_LENGTH = 10;

/** A token with its middle left out; one of ten characters or fewer is shown whole. */
const maskToken = (token: string) => (token.length <= MASK_LENGTH ? token : `${token.slice(0, 6)}...${token.slice(-4)}`);

/** JSON with the real token and paths, for pasting into a client that reads mcpServers. */
const buildMcpConfig = (status: ControlServerStatus, token: string) => JSON.stringify({
    mcpServers: {
        folia: {
            command: 'node',
            args: [
                status.controlMcpPath,
                '--url', status.url ?? 'http://127.0.0.1:4567',
                '--token-file', status.tokenFile,
            ],
        },
    },
}, null, 2);

/** The prompt an agent reads: where Folia is, how to call it, and what it may do. */
const buildAgentPrompt = (status: ControlServerStatus, token: string) => {
    const url = status.url ?? 'http://127.0.0.1:4567';
    const cli = status.controlCliPath;
    const mcp = status.controlMcpPath;
    return [
        '你现在可以控制本机正在运行的 Folia 音乐播放器（搜歌、播放、队列、音量、歌词、歌词动画与背景、主题、设置、截图、事件流）。',
        '',
        '## 连接信息',
        `- 控制服务地址：${url}`,
        `- 令牌文件：${status.tokenFile}`,
        `- CLI：node "${cli}"`,
        `- MCP server：node "${mcp}"`,
        '',
        '## 每一步都用 CLI 执行，统一带上连接参数',
        `node "${cli}" <命令> --url ${url} --token-file "${status.tokenFile}"`,
        '',
        '## 常用命令',
        '- 看当前状态：status / state',
        '- 搜歌：search "周杰伦 晴天" --limit 5 --json',
        '- 播放：play "周杰伦 晴天" 或 play --id <id>',
        '- 传输：pause / resume / next / prev / seek 90 / seek 50%',
        '- 音量：volume 35（回读 volume）；静音：mute on|off',
        '- 队列：queue / queue add "<q>" / queue play <i> / queue remove <i>',
        '- 歌词：lyrics --lines / lyrics offset 200 / lyrics seek 12',
        '- 画面：visual list / visual set fume / visual bg monet / visual tune monet \'{"backgroundLayout":"full-overlay"}\'',
        '- 主题：theme day|night|system|cover|static / theme ai',
        '- 设置：settings audio volume / settings set audio.volume 40',
        '- 命令面板直通（246 条内置命令）：palette list --json / palette run <id>',
        '- 截图自检：screenshot --out /tmp/folia.png',
        '- 事件：events --json / events --watch',
        '',
        '## 说明',
        '- 失败会返回 {ok:false,error:{code,message}}，退出码 1 表示控制失败、2 表示连不上。',
        '- 搜歌/播放依赖对应平台网络与登录状态；search_failed 不代表链路坏了。',
        '- 需要「某个我还没提到具体歌名」的任务时，先 search 再挑结果，不要猜测 id。',
        `- folia_eval 默认关闭；确需逃生口时，服务端要 FOLIA_CONTROL_ALLOW_EVAL=1 且客户端加 --allow-eval。`,
        '- 不要把这个令牌贴到公开地方，它等同本机用户权限。',
        '',
        `令牌：${token}`,
    ].join('\n');
};

const ControlServerRows: React.FC = () => {
    const { t } = useTranslation();
    const [status, setStatus] = useState<ControlServerStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

    const refresh = useCallback(async () => {
        const next = await window.electron?.getControlStatus?.();
        if (next) {
            setStatus(next);
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const onToggle = useCallback(async (enabled: boolean) => {
        setBusy(true);
        try {
            const next = await window.electron?.setControlEnabled?.(enabled);
            if (next) {
                setStatus(next);
            }
        } finally {
            setBusy(false);
        }
    }, []);

    const onRegenerate = useCallback(async () => {
        setBusy(true);
        try {
            const next = await window.electron?.regenerateControlToken?.();
            if (next) {
                setStatus(next);
            }
        } finally {
            setBusy(false);
        }
    }, []);

    const token = status?.token ?? '';
    const mcpConfig = useMemo(() => (status ? buildMcpConfig(status, token) : ''), [status, token]);
    const prompt = useMemo(() => (status ? buildAgentPrompt(status, token) : ''), [status, token]);

    const copyText = useCallback(async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopyState('copied');
            window.setTimeout(() => setCopyState('idle'), 1600);
        } catch (error) {
            console.warn('[Control] Clipboard write failed', error);
        }
    }, []);

    if (!status) {
        return null;
    }

    const on = status.enabled || status.running;

    return (
        <>
            <Row
                label={t('options.controlServer', 'AI 控制（CLI / MCP）')}
                hint={t('options.controlServerDesc', '让外部 AI / CLI / MCP 客户端控制本机 Folia，仅监听 127.0.0.1。')}
            >
                {on && (
                    <Status tone={status.running ? 'ok' : 'error'}>
                        {t(status.running ? 'options.controlServerRunning' : 'options.controlServerUnavailable')}
                    </Status>
                )}
                <Toggle checked={on} onChange={enabled => void onToggle(enabled)} disabled={busy} />
            </Row>
            <Reveal when={on}>
                <Row sub label={t('options.controlServerAddress', '控制服务地址')}>
                    {status.url ? <CopyValue value={status.url} /> : <Value>-</Value>}
                </Row>
                <Row sub label={t('options.controlServerToken', '访问令牌')}>
                    {token
                        ? <CopyValue value={token} shown={maskToken(token)} />
                        : <Value>{t('options.controlServerTokenMissing', '尚未生成')}</Value>}
                    <Button onClick={() => void onRegenerate()} disabled={busy}>
                        {t('options.controlServerRegenerateToken', '重新生成令牌')}
                    </Button>
                </Row>
                <Row
                    sub
                    label={t('options.controlServerMcpConfig', 'MCP 客户端配置')}
                    note={(
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/5 p-2 text-[11px] leading-4 dark:bg-white/10">
                            {mcpConfig}
                        </pre>
                    )}
                >
                    <Button onClick={() => void copyText(mcpConfig)}>
                        {t('options.controlServerCopyMcp', '复制配置')}
                    </Button>
                </Row>
                <Row
                    sub
                    label={t('options.controlServerPrompt', 'AI 提示词')}
                    note={t('options.controlServerPromptHint', '一键复制的完整提示词，已带上本机 CLI 路径与令牌，直接粘给任意 AI 客户端即可。')}
                >
                    <Button onClick={() => void copyText(prompt)}>
                        {copyState === 'copied'
                            ? t('options.controlServerCopied', '已复制')
                            : t('options.controlServerCopyPrompt', '复制提示词')}
                    </Button>
                </Row>
                <Row sub label={t('options.controlServerCli', '命令行入口')}>
                    <Value>{status.controlCliPath}</Value>
                </Row>
            </Reveal>
            <Reveal when={Boolean(status.error)}>
                <Row sub label={<Status tone="error">{status.error ?? ''}</Status>} />
            </Reveal>
        </>
    );
};

export default ControlServerRows;
