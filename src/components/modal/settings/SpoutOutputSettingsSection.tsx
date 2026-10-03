import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor } from 'lucide-react';
import type { Theme } from '../../../types';
import type { SpoutOutputConfigPatch, SpoutOutputError, SpoutOutputStatus } from '../../../types/spoutOutput';
import { CustomSelect } from '../../shared/CustomSelect';
import SettingsSectionHeading from './navigation/SettingsSectionHeading';
import { SettingsAnchor } from './navigation/SettingsAnchorContext';

// src/components/modal/settings/SpoutOutputSettingsSection.tsx
// The Windows-only Spout output panel on the integration subview. Rendered only when
// status.supported — the hook + command palette gate on the same field.

type SpoutOutputSettingsSectionProps = {
    status: SpoutOutputStatus;
    onApplyConfig: (patch: SpoutOutputConfigPatch) => Promise<SpoutOutputStatus> | void;
    isDaylight: boolean;
    theme?: Theme;
    settingsCardClass: string;
    toggleOffBackgroundClass: string;
    successBgColor: string;
    successTextColor: string;
    errorBgColor: string;
    errorTextColor: string;
};

const RESOLUTION_PRESETS = [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
    { width: 3840, height: 2160 },
];

const presetKey = (width: number, height: number) => `${width}x${height}`;

// The options locale section is a flat Record<string, string>, so each Spout error code maps to a
// dedicated flat i18n key rather than a nested lookup.
const SPOUT_ERROR_LABEL_KEYS: Record<SpoutOutputError, string> = {
    'helper-missing': 'options.spoutErrorHelperMissing',
    'name-in-use': 'options.spoutErrorNameInUse',
    'd3d-init-failed': 'options.spoutErrorD3dInitFailed',
    'spout-register-failed': 'options.spoutErrorSpoutRegisterFailed',
    'helper-crashed': 'options.spoutErrorHelperCrashed',
    'unsupported-platform': 'options.spoutErrorUnsupportedPlatform',
};

export const SpoutOutputSettingsSection: React.FC<SpoutOutputSettingsSectionProps> = ({
    status,
    onApplyConfig,
    isDaylight,
    theme,
    settingsCardClass,
    toggleOffBackgroundClass,
    successBgColor,
    successTextColor,
    errorBgColor,
    errorTextColor,
}) => {
    const { t } = useTranslation();
    const [senderNameDraft, setSenderNameDraft] = useState(status.senderName);
    useEffect(() => { setSenderNameDraft(status.senderName); }, [status.senderName]);

    const commitSenderName = () => {
        const trimmed = senderNameDraft.trim();
        // Spout receivers cannot list a name whose first byte is non-ASCII (main validates the
        // same rule), so revert instead of sending a patch that would be rejected.
        if (!trimmed || trimmed === status.senderName || trimmed.charCodeAt(0) >= 0x80) {
            setSenderNameDraft(status.senderName);
            return;
        }
        Promise.resolve(onApplyConfig({ senderName: trimmed })).catch(() => setSenderNameDraft(status.senderName));
    };

    const stateLabel = (() => {
        if (status.error) {
            return t(SPOUT_ERROR_LABEL_KEYS[status.error]);
        }
        if (status.running) {
            return t('options.spoutOutputRunning');
        }
        if (status.enabled) {
            return t('options.spoutOutputStarting');
        }
        return t('options.spoutOutputStopped');
    })();

    return (
        <SettingsAnchor anchorId="spoutOutput" label={t('options.spoutOutput') || 'Spout output'}>
            <SettingsSectionHeading icon={Monitor} label={t('options.spoutOutput') || 'Spout output'} />
            <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1">
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('options.spoutOutputEnable') || 'Enable Spout output'}
                        </div>
                        <div className="text-[10px] opacity-40 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.spoutOutputDesc')}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => void onApplyConfig({ enabled: !status.enabled })}
                        className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${!status.enabled ? toggleOffBackgroundClass : ''}`}
                        style={{ backgroundColor: status.enabled ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                        aria-label={t('options.spoutOutputEnable') || 'Enable Spout output'}
                    >
                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${status.enabled ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                </div>

                {status.enabled && (
                    <div className="space-y-3">
                        <div className={`rounded-xl border p-3 space-y-3 ${settingsCardClass}`}>
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-[10px] uppercase tracking-[0.16em] opacity-40 mb-1" style={{ color: 'var(--text-secondary)' }}>
                                        {t('options.spoutOutputState')}
                                    </div>
                                    <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
                                        {stateLabel}
                                    </div>
                                </div>
                                <span className={`shrink-0 px-2 py-1 rounded-full text-[10px] ${status.running ? successBgColor : errorBgColor} ${status.running ? successTextColor : errorTextColor}`}>
                                    {status.running ? t('options.spoutOutputRunning') : t('options.spoutOutputNotRunning')}
                                </span>
                            </div>
                        </div>

                        <div className={`rounded-xl border p-3 space-y-3 ${settingsCardClass}`}>
                            <div>
                                <div className="text-[10px] uppercase tracking-[0.16em] opacity-40 mb-2" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.spoutOutputSenderName')}
                                </div>
                                <input
                                    type="text"
                                    value={senderNameDraft}
                                    maxLength={255}
                                    onChange={event => setSenderNameDraft(event.target.value)}
                                    onBlur={commitSenderName}
                                    onKeyDown={event => {
                                        if (event.key === 'Enter') {
                                            commitSenderName();
                                        }
                                    }}
                                    className="w-full px-3 py-2 bg-white/5 rounded-lg text-sm outline-none focus:ring-1 focus:ring-white/20"
                                    style={{ color: 'var(--text-primary)' }}
                                    aria-label={t('options.spoutOutputSenderName')}
                                />
                                <div className="text-[10px] opacity-40 mt-1" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.spoutOutputSenderNameRule')}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <div className="text-[10px] uppercase tracking-[0.16em] opacity-40 mb-2" style={{ color: 'var(--text-secondary)' }}>
                                        {t('options.spoutOutputResolution')}
                                    </div>
                                    <CustomSelect
                                        value={presetKey(status.width, status.height)}
                                        onChange={value => {
                                            const preset = RESOLUTION_PRESETS.find(candidate => presetKey(candidate.width, candidate.height) === value);
                                            if (preset) {
                                                void onApplyConfig({ width: preset.width, height: preset.height });
                                            }
                                        }}
                                        options={RESOLUTION_PRESETS.map(preset => ({
                                            value: presetKey(preset.width, preset.height),
                                            label: `${preset.width} × ${preset.height}`,
                                        }))}
                                        ariaLabel={t('options.spoutOutputResolution')}
                                        isDaylight={isDaylight}
                                        theme={theme}
                                    />
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase tracking-[0.16em] opacity-40 mb-2" style={{ color: 'var(--text-secondary)' }}>
                                        {t('options.spoutOutputFps')}
                                    </div>
                                    <CustomSelect
                                        value={String(status.fps)}
                                        onChange={value => {
                                            const fps = Number(value);
                                            if (fps === 30 || fps === 60) {
                                                void onApplyConfig({ fps });
                                            }
                                        }}
                                        options={[
                                            { value: '30', label: t('options.spoutOutputFps30') },
                                            { value: '60', label: t('options.spoutOutputFps60') },
                                        ]}
                                        ariaLabel={t('options.spoutOutputFps')}
                                        isDaylight={isDaylight}
                                        theme={theme}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="text-[10px] opacity-40 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.spoutOutputHint', { name: status.senderName })}
                        </div>
                    </div>
                )}
            </div>
        </SettingsAnchor>
    );
};
