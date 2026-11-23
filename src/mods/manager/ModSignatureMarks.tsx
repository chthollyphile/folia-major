import React from 'react';
import { CircleCheck, CircleOff, FlaskConical, Package, ShieldAlert, ShieldCheck, ShieldQuestion, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ModRuntimeInfo } from '../types';
import type { ModManagerClasses } from './modManagerClasses';

// src/mods/manager/ModSignatureMarks.tsx
// What a mod's signature and state look like in the mods view: the small mark beside its name, the line in
// its detail that says what the signature means, and the state icon.

/*
 * The signature badge shown in the collapsed row. Unsigned mods get none there
 * (most third-party mods are unsigned, so a badge would be noise); the expanded
 * row explains every state.
 */
export const SignatureBadge: React.FC<{ mod: ModRuntimeInfo; isDaylight: boolean }> = ({ mod, isDaylight }) => {
    const { t } = useTranslation();
    const { status } = mod.signature;
    // Folium 2.0: a built-in copy carries no signature; the installation vouches for it (plan §5.2).
    if (status === 'builtin') {
        return (
            <span title={t('mods.signatureBuiltin')} className={`shrink-0 ${isDaylight ? 'text-sky-700' : 'text-sky-300'}`}>
                <Package size={14} />
            </span>
        );
    }
    if (status === 'verified') {
        return (
            <span title={t('mods.signatureVerified')} className={`shrink-0 ${isDaylight ? 'text-emerald-600' : 'text-emerald-300'}`}>
                <ShieldCheck size={14} />
            </span>
        );
    }
    if (status === 'beta') {
        return (
            <span title={t('mods.signatureBeta')} className={`shrink-0 ${isDaylight ? 'text-violet-600' : 'text-violet-300'}`}>
                <FlaskConical size={14} />
            </span>
        );
    }
    if (status === 'invalid') {
        return (
            <span title={t('mods.signatureInvalid')} className={`shrink-0 ${isDaylight ? 'text-amber-700' : 'text-amber-300'}`}>
                <ShieldAlert size={14} />
            </span>
        );
    }
    return null;
};

/* One line in the expanded row saying what the signature state means. */
export const SignatureNotice: React.FC<{ mod: ModRuntimeInfo; isDaylight: boolean; classes: ModManagerClasses }> = ({ mod, isDaylight, classes }) => {
    const { t } = useTranslation();
    const { status, reason, keyId, keyLabel } = mod.signature;
    if (status === 'builtin') {
        return (
            <div className={`flex items-start gap-2 text-xs rounded-lg border px-3 py-2 ${classes.success}`}>
                <Package size={14} className="mt-px shrink-0" />
                <span>
                    <span className="font-medium">{t('mods.signatureBuiltin')}</span>
                    {' · '}
                    {t('mods.signatureBuiltinDetail')}
                </span>
            </div>
        );
    }
    if (status === 'verified') {
        return (
            <div className={`flex items-start gap-2 text-xs rounded-lg border px-3 py-2 ${classes.success}`}>
                <ShieldCheck size={14} className="mt-px shrink-0" />
                <span>
                    <span className="font-medium">{t('mods.signatureVerified')}</span>
                    {' · '}
                    {t('mods.signatureVerifiedDetail', { key: keyLabel ? `${keyLabel}, ${keyId}` : keyId })}
                </span>
            </div>
        );
    }
    if (status === 'beta') {
        return (
            <div className={`flex items-start gap-2 text-xs rounded-lg border px-3 py-2 ${classes.preview}`}>
                <FlaskConical size={14} className="mt-px shrink-0" />
                <span>
                    <span className="font-medium">{t('mods.signatureBeta')}</span>
                    {' · '}
                    {t('mods.signatureBetaDetail', { key: keyLabel ? `${keyLabel}, ${keyId}` : keyId })}
                </span>
            </div>
        );
    }
    if (status === 'invalid') {
        const reasonText = t(`mods.signatureReasons.${reason ?? 'malformed'}`, { defaultValue: reason ?? '' });
        return (
            <div className={`flex items-start gap-2 text-xs rounded-lg border px-3 py-2 ${classes.warning}`}>
                <ShieldAlert size={14} className="mt-px shrink-0" />
                <span>
                    <span className="font-medium">{t('mods.signatureInvalid')}</span>
                    {' · '}
                    {t('mods.signatureInvalidDetail', { reason: reasonText })}
                </span>
            </div>
        );
    }
    return (
        <div
            className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2 ${isDaylight ? 'bg-black/[0.04]' : 'bg-white/5'}`}
            style={{ color: 'var(--text-secondary)' }}
        >
            <ShieldQuestion size={14} className="mt-px shrink-0" />
            <span>
                <span className="font-medium">{t('mods.signatureUnsigned')}</span>
                {' · '}
                {t('mods.signatureUnsignedDetail')}
            </span>
        </div>
    );
};

export const StatusIcon: React.FC<{ status: string; error?: string | null; isDaylight: boolean }> = ({ status, error, isDaylight }) => {
    if (status === 'loaded') return <CircleCheck size={15} className={`${isDaylight ? 'text-emerald-600' : 'text-emerald-300'} shrink-0`} />;
    // 'skipped' (this run was started without mods) is not running and not broken: it reads as off.
    // A community mod while community mods are off is held back by the user's own switch, not broken.
    if (status === 'disabled' || status === 'skipped' || error === 'community-off') return <CircleOff size={15} className={`${isDaylight ? 'text-zinc-400' : 'text-white/35'} shrink-0`} />;
    return <TriangleAlert size={15} className={`${isDaylight ? 'text-red-600' : 'text-red-300'} shrink-0`} />;
};
