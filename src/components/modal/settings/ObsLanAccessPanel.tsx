import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../../types';
import type { ObsBrowserSourceStatus, ObsLanEndpoint } from '../../../types/obsBrowserSource';
import { QrCodeImage } from '../../shared/QrCodeImage';

// src/components/modal/settings/ObsLanAccessPanel.tsx
// OBS browser source "Allow LAN access" switch plus the LAN URLs and a QR code, so a tablet or
// phone on the same network can open the overlay page without typing the tokenized URL.

type ObsLanAccessPanelProps = {
    status: ObsBrowserSourceStatus;
    onToggle?: (enabled: boolean) => Promise<void> | void;
    onCopyText: (text: string) => Promise<void>;
    settingsCardClass: string;
    toggleOffBackgroundClass: string;
    theme?: Theme;
};

// Label shown next to each address so the user can tell which network a device must be on.
const describeEndpoint = (endpoint: ObsLanEndpoint, t: (key: string, options?: Record<string, unknown>) => string) => {
    if (endpoint.kind === 'hotspot') return t('options.obsLanKindHotspot');
    if (endpoint.kind === 'virtual') return t('options.obsLanKindVirtual', { name: endpoint.interfaceName });
    return endpoint.interfaceName;
};

const ObsLanAccessPanel: React.FC<ObsLanAccessPanelProps> = ({
    status,
    onToggle,
    onCopyText,
    settingsCardClass,
    toggleOffBackgroundClass,
    theme,
}) => {
    const { t } = useTranslation();
    const lanAccess = Boolean(status.lanAccess);
    const endpoints = status.lanEndpoints ?? [];
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

    // Addresses can change (network switch, token regeneration); keep the selection in range.
    useEffect(() => {
        if (selectedIndex >= endpoints.length) setSelectedIndex(0);
    }, [endpoints.length, selectedIndex]);

    const selected = endpoints[selectedIndex] ?? null;

    const handleCopy = async (url: string) => {
        await onCopyText(url);
        setCopiedUrl(url);
        window.setTimeout(() => setCopiedUrl(current => (current === url ? null : current)), 1600);
    };

    return (
        <div className={`rounded-xl border p-3 space-y-3 ${settingsCardClass}`}>
            <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {t('options.obsLanAccess') || 'Allow LAN access'}
                    </div>
                    <div className="text-[10px] opacity-40 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                        {t('options.obsLanAccessDesc', { port: status.port })}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => void onToggle?.(!lanAccess)}
                    className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${!lanAccess ? toggleOffBackgroundClass : ''}`}
                    style={{ backgroundColor: lanAccess ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                    aria-label={t('options.obsLanAccess') || 'Allow LAN access'}
                >
                    <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${lanAccess ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
            </div>

            {lanAccess && (endpoints.length === 0 ? (
                <div className="text-[11px] opacity-60" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.obsLanNoAddress')}
                </div>
            ) : (
                <>
                    <div className="flex flex-wrap items-start gap-4">
                        {selected && (
                            <div className="space-y-1.5 text-center">
                                <QrCodeImage value={selected.url} alt={t('options.obsLanQrAlt')} className="w-36 h-36 rounded-lg" />
                                <div className="text-[10px] opacity-50 max-w-[144px]" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.obsLanQrHint')}
                                </div>
                            </div>
                        )}
                        <div className="flex-1 min-w-[200px] space-y-2">
                            <div className="text-[10px] uppercase tracking-[0.16em] opacity-40" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.obsLanAddresses') || 'LAN addresses'}
                            </div>
                            {endpoints.map((endpoint, index) => {
                                const isSelected = index === selectedIndex;
                                const isVirtual = endpoint.kind === 'virtual';
                                return (
                                    <div key={endpoint.url} className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setSelectedIndex(index)}
                                            className="flex-1 min-w-0 text-left rounded-lg px-2 py-1.5 transition-colors hover:bg-white/10"
                                            style={{
                                                color: 'var(--text-primary)',
                                                opacity: isSelected ? 1 : isVirtual ? 0.4 : 0.65,
                                                backgroundColor: isSelected ? 'rgba(255, 255, 255, 0.06)' : undefined,
                                            }}
                                            aria-pressed={isSelected}
                                        >
                                            <div className="text-xs font-medium">
                                                {endpoint.address}
                                                <span className="ml-2 text-[10px] font-normal opacity-70">
                                                    {describeEndpoint(endpoint, t)}
                                                </span>
                                            </div>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void handleCopy(endpoint.url)}
                                            className="shrink-0 px-3 py-1.5 bg-white/10 hover:bg-white/15 rounded-lg text-xs transition-colors flex items-center gap-1.5"
                                            style={{ color: copiedUrl === endpoint.url ? '#86efac' : 'var(--text-primary)' }}
                                        >
                                            {copiedUrl === endpoint.url ? <Check size={12} /> : null}
                                            {copiedUrl === endpoint.url
                                                ? (t('options.stageAddressCopied') || 'Copied')
                                                : (t('options.copyObsBrowserSourceAddress') || 'Copy OBS URL')}
                                        </button>
                                    </div>
                                );
                            })}
                            <div className="text-[10px] opacity-50 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.obsLanPickHint')}
                            </div>
                        </div>
                    </div>
                    <div className="text-[10px] opacity-50 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                        {t('options.obsLanMainWindowHint')}
                    </div>
                </>
            ))}
        </div>
    );
};

export default ObsLanAccessPanel;
