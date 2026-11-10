import React, { useEffect, useState } from 'react';
import { FolderOpen, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ThemedDialog from '../shared/ThemedDialog';

// src/components/modal/LegacyModelsPrompt.tsx
// Asks once whether to delete the old automix models in the folder an earlier version (up to 0.7.20)
// let the listener choose (模型目录). The models ship with the app now and those files are never read
// again; the app's own download folder is cleaned without asking (electron/main.cjs), but this one is
// the listener's, so it is theirs to say.
//
// Mounted once at app level and self-contained: it asks the main process a few seconds after start,
// and draws nothing unless there is something there. Delete and "keep them" both end it for good (the
// setting is cleared); closing the dialog leaves it for the next launch. Opening the folder leaves the
// dialog up, so the answer can follow a look.

/** After startup's own work; the answer is a few stats, but nothing about it is urgent. */
const CHECK_DELAY_MS = 8000;

interface LegacyModels {
    dir: string;
    count: number;
    bytes: number;
}

const LegacyModelsPrompt: React.FC<{ isDaylight: boolean }> = ({ isDaylight }) => {
    const { t } = useTranslation();
    const [found, setFound] = useState<LegacyModels | null>(null);
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        const check = window.electron?.checkLegacyModels;
        if (!check) return undefined;
        let left = false;
        const timer = setTimeout(() => {
            check()
                .then((answer) => { if (!left && answer) setFound(answer); })
                .catch(error => console.warn('[Models] could not look for old models', error));
        }, CHECK_DELAY_MS);
        return () => {
            left = true;
            clearTimeout(timer);
        };
    }, []);

    if (!found) return null;

    const resolve = async (action: 'delete' | 'dismiss') => {
        setBusy(true);
        const answer = await window.electron?.resolveLegacyModels?.(action).catch(() => ({ ok: false }));
        setBusy(false);
        if (answer?.ok) setFound(null);
        else setFailed(true);
    };

    const buttonClass = isDaylight
        ? 'rounded-xl border border-black/10 px-4 py-2 text-sm text-zinc-900 hover:bg-black/[0.04] flex items-center gap-1.5 disabled:opacity-50'
        : 'rounded-xl border border-white/10 px-4 py-2 text-sm text-white hover:bg-white/[0.06] flex items-center gap-1.5 disabled:opacity-50';

    return (
        <ThemedDialog
            isOpen
            onClose={() => setFound(null)}
            isDaylight={isDaylight}
            title={t('options.legacyModelsTitle')}
            description={t('options.legacyModelsDesc', {
                files: found.count,
                size: `${Math.max(1, Math.round(found.bytes / 1048576))} MB`,
                dir: found.dir,
            })}
            size="s"
        >
            {failed && (
                <p className={`mb-3 text-sm ${isDaylight ? 'text-red-600' : 'text-red-400'}`}>
                    {t('options.legacyModelsFailed')}
                </p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
                {/* Left and quieter: leaving them is an answer too, and also ends the prompt. */}
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => void resolve('dismiss')}
                    className={`mr-auto text-sm underline opacity-50 hover:opacity-80 disabled:opacity-30 ${isDaylight ? 'text-zinc-900' : 'text-white'}`}
                >
                    {t('options.legacyModelsKeep')}
                </button>
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => void window.electron?.openLegacyModelsFolder?.()}
                    className={buttonClass}
                >
                    <FolderOpen size={14} />
                    {t('options.legacyModelsOpen')}
                </button>
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => void resolve('delete')}
                    className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white/90 flex items-center gap-1.5 disabled:opacity-50"
                >
                    <Trash2 size={14} />
                    {t('options.legacyModelsDelete')}
                </button>
            </div>
        </ThemedDialog>
    );
};

export default LegacyModelsPrompt;
