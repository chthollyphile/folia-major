import React, { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FoliumSetting } from '../folium/contract';
import type { ModSecretsState } from '../types';
import { readFoliumSecretsState, subscribeFoliumSecretChanges, writeFoliumSecret } from '../folium/secrets';
import { resolveFoliumLabel } from './params';
import type { FoliumParamFieldToken } from './FoliumParamFields';

// src/mods/params/FoliumSecretField.tsx
// The form row of a Folium 1.7 `secret` field in a mod's settings section: a masked input to type a new
// value, whether one is set, and a button to clear it. A saved value is never shown or even fetched: the
// window only learns which keys hold one (useFoliumSecretsState), and the value goes to the main process
// when the user saves it.

/**
 * What the main process says about one mod's secret values, read again whenever one changes (from this
 * form, the mod's client or its main entry). Null until the first answer, and when there is none (no
 * Electron bridge, the mod not running).
 */
export const useFoliumSecretsState = (modId: string, enabled: boolean): ModSecretsState | null => {
    const [state, setState] = useState<ModSecretsState | null>(null);
    useEffect(() => {
        if (!enabled) return undefined;
        let live = true;
        const refresh = () => {
            readFoliumSecretsState(modId).then(
                (next) => { if (live) setState(next); },
                (error) => console.warn(`[Folium:${modId}] could not read which secret fields are set`, error),
            );
        };
        refresh();
        const off = subscribeFoliumSecretChanges(modId, refresh);
        return () => {
            live = false;
            off();
        };
    }, [modId, enabled]);
    return state;
};

interface FoliumSecretFieldProps {
    modId: string;
    param: FoliumSetting;
    /** The keys that hold a value and whether they outlive this run; null while unknown. */
    state: ModSecretsState | null;
    token: FoliumParamFieldToken;
    disabled?: boolean;
}

export const FoliumSecretField: React.FC<FoliumSecretFieldProps> = ({ modId, param, state, token, disabled = false }) => {
    const { t, i18n } = useTranslation();
    const inputId = useId();
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);
    const label = resolveFoliumLabel(param.label, i18n.language, param.key);
    const description = param.description ? resolveFoliumLabel(param.description, i18n.language, '') : '';
    const isSet = state?.stored.includes(param.key) ?? false;

    const write = useCallback((value: string | null) => {
        setBusy(true);
        setFailed(false);
        writeFoliumSecret(modId, param.key, value)
            .then(() => setDraft(''))
            .catch((error) => {
                // The error names the key and the reason, never the value.
                console.warn(`[Folium:${modId}] secret field "${param.key}" could not be saved`, error);
                setFailed(true);
            })
            .finally(() => setBusy(false));
    }, [modId, param.key]);

    const trimmed = draft.trim();
    const save = () => {
        if (trimmed && !busy) write(trimmed);
    };
    const buttonClass = 'shrink-0 rounded-lg px-2.5 py-1.5 text-xs transition-opacity disabled:opacity-40';

    return (
        <div className="col-span-2 flex flex-col gap-1 min-w-0" title={description ? `${label}\n${description}` : label}>
            <div className="flex items-center justify-between gap-2 min-w-0">
                <label htmlFor={inputId} className={token.label}>{label}</label>
                {state ? (
                    <span className={`${token.readonlyLabel} shrink-0`} data-folium-secret-status={isSet ? 'set' : 'unset'}>
                        {isSet ? t('options.modSecretSet') : t('options.modSecretUnset')}
                    </span>
                ) : null}
            </div>
            <div className="flex items-center gap-2 min-w-0">
                <input
                    id={inputId}
                    type="password"
                    autoComplete="new-password"
                    spellCheck={false}
                    className={`${token.input} flex-1`}
                    style={token.inputStyle}
                    value={draft}
                    placeholder={isSet ? t('options.modSecretReplacePlaceholder') : (param.placeholder ?? t('options.modSecretPlaceholder'))}
                    disabled={disabled || busy}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            save();
                        }
                    }}
                />
                <button
                    type="button"
                    className={buttonClass}
                    style={token.inputStyle}
                    disabled={disabled || busy || !trimmed}
                    onClick={save}
                >
                    {t('options.modSecretSave')}
                </button>
                {isSet ? (
                    <button
                        type="button"
                        className={buttonClass}
                        style={token.inputStyle}
                        disabled={disabled || busy}
                        onClick={() => write(null)}
                    >
                        {t('options.modSecretClear')}
                    </button>
                ) : null}
            </div>
            {state && !state.persistent ? (
                <span className="text-[11px] opacity-60" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.modSecretSessionOnly')}
                </span>
            ) : null}
            {failed ? (
                <span className="text-[11px] opacity-80" role="alert" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.modSecretSaveFailed')}
                </span>
            ) : null}
        </div>
    );
};
