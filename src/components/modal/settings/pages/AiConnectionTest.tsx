import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsKitTheme } from '../kit';
import { canRunAiConnectionTest, runAiConnectionTest } from '../../../../services/aiText';

// src/components/modal/settings/pages/AiConnectionTest.tsx
// The connection test of the AI provider settings: the request, and the block that shows the reply.
// It sends the unsaved form values to the main process; nothing here is persisted.

/**
 * Runs the test against the values currently in the form, exactly as typed. An empty key field
 * tests the key the main process has saved; `keySaved` says whether there is one.
 */
export const useAiConnectionTest = (payload: AiConnectionTestPayload, keySaved?: boolean) => {
    const [running, setRunning] = React.useState(false);
    const [result, setResult] = React.useState<AiConnectionTestResult | null>(null);
    // Each click gets a number; a reply is only shown if it is still the latest one. Unmounting
    // (settings closed) bumps it too, so a late reply cannot land on a stale form.
    const requestSeqRef = React.useRef(0);

    React.useEffect(() => () => {
        requestSeqRef.current += 1;
    }, []);

    // Editing the connection fields, switching provider, or saving or clearing the key makes an old
    // result misleading, so drop it (and any reply still in flight) when they change.
    React.useEffect(() => {
        requestSeqRef.current += 1;
        setRunning(false);
        setResult(null);
    }, [payload.provider, payload.presetId, payload.apiKey, payload.apiUrl, payload.model, payload.stream, payload.useSystemProxy, keySaved]);

    const run = async () => {
        if (running || !canRunAiConnectionTest()) {
            return;
        }
        const seq = requestSeqRef.current + 1;
        requestSeqRef.current = seq;
        setRunning(true);
        setResult(null);
        let next: AiConnectionTestResult;
        try {
            next = await runAiConnectionTest(payload);
        } catch (error) {
            next = {
                ok: false,
                durationMs: 0,
                errorKind: 'network',
                error: error instanceof Error ? error.message : String(error),
            };
        }
        if (requestSeqRef.current !== seq) {
            return;
        }
        setResult(next);
        setRunning(false);
    };

    return { running, result, run };
};

export const AiConnectionTestStatus: React.FC<{ result: AiConnectionTestResult }> = ({ result }) => {
    const { t } = useTranslation();
    const { isDaylight } = useSettingsKitTheme();
    const statusColor = result.ok ? (isDaylight ? '#15803d' : '#4ade80') : (isDaylight ? '#b91c1c' : '#f87171');

    return (
        <span className="whitespace-nowrap text-[13px] font-semibold" style={{ color: statusColor }} role="status" aria-live="polite">
            {result.ok ? t('options.aiTestSuccess') : t('options.aiTestFailed')}
        </span>
    );
};

export const AiConnectionTestReply: React.FC<{ result: AiConnectionTestResult }> = ({ result }) => {
    const { t } = useTranslation();

    const metaParts = [`${t('options.aiTestDuration')}: ${result.durationMs} ms`];
    if (typeof result.status === 'number') {
        metaParts.push(`HTTP ${result.status}`);
    }
    if (result.ok && result.model) {
        metaParts.push(`${t('options.aiTestModel')}: ${result.model}`);
    }

    const emptyMessage = result.ok && !result.text
        ? t(result.emptyReason === 'reasoning' ? 'options.aiTestEmptyReasoning' : 'options.aiTestEmpty')
        : null;
    const body = result.ok ? result.text : result.error;

    return (
        <div className="space-y-1.5">
            <div className="text-xs leading-[18px] text-[color:var(--st-t2)]">{metaParts.join(' · ')}</div>
            {emptyMessage && <div className="text-xs leading-[18px] text-[color:var(--st-t2)]">{emptyMessage}</div>}
            {body ? (
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--st-fill)] p-2 font-mono text-[11px] leading-relaxed text-[color:var(--st-t1)]">
                    {body}
                </pre>
            ) : null}
        </div>
    );
};
