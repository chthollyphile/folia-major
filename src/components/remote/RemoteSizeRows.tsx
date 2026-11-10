import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { REMOTE_NO_DRAG_STYLE } from './remoteWindowBridge';
import { describeRemoteAspectRatio, type RemoteExportChoices } from './useRemoteExportChoices';

// src/components/remote/RemoteSizeRows.tsx
// The size presets in the remote window's sheet: the three sizes as one segmented choice, and the
// view where the selected one is edited. Picking a size resizes the main window at once.

export const formatRemoteSize = (width: number, height: number) => `${width} × ${height}`;

type RemoteSizeSegProps = {
    choices: RemoteExportChoices;
    disabled?: boolean;
    /** Adds a last cell that opens the view where the selected size is edited. */
    onCustom?: () => void;
};

export const RemoteSizeSeg: React.FC<RemoteSizeSegProps> = ({ choices, disabled, onCustom }) => {
    const { t } = useTranslation();

    return (
        <div className="remote-seg" role="group" aria-label={t('remote.rowSize')} style={REMOTE_NO_DRAG_STYLE}>
            {choices.presets.map(preset => (
                <button
                    key={preset.id}
                    type="button"
                    aria-pressed={preset.id === choices.selectedPreset.id}
                    data-on={preset.id === choices.selectedPreset.id}
                    disabled={disabled}
                    className="remote-seg__cell"
                    onClick={() => choices.selectPreset(preset.id)}
                >
                    {formatRemoteSize(preset.width, preset.height)}
                </button>
            ))}
            {onCustom && (
                <button type="button" disabled={disabled} className="remote-seg__cell" onClick={onCustom}>
                    {t('remote.sizeCustom')}
                </button>
            )}
        </div>
    );
};

const digitsOnly = (value: string) => value.replace(/[^\d]/g, '');

/** Two rows: pick one of the three sizes, and type a new width and height for the picked one. */
export const RemoteSizeView: React.FC<{ choices: RemoteExportChoices }> = ({ choices }) => {
    const { t } = useTranslation();
    const { selectedPreset } = choices;
    const [draftWidth, setDraftWidth] = useState(String(selectedPreset.width));
    const [draftHeight, setDraftHeight] = useState(String(selectedPreset.height));

    useEffect(() => {
        setDraftWidth(String(selectedPreset.width));
        setDraftHeight(String(selectedPreset.height));
    }, [selectedPreset.id, selectedPreset.width, selectedPreset.height]);

    const aspect = describeRemoteAspectRatio(Number(draftWidth), Number(draftHeight));
    const save = () => {
        if (draftWidth && draftHeight) {
            choices.saveCustomSize(Number(draftWidth), Number(draftHeight));
            // The typing is over: a field that kept the caret would hold the sheet open.
            if (document.activeElement instanceof HTMLInputElement) {
                document.activeElement.blur();
            }
        }
    };
    const saveOnEnter = (event: React.KeyboardEvent) => {
        if (event.key === 'Enter') {
            save();
        }
    };

    return (
        <div className="remote-rows remote-rows--two">
            <div className="remote-row">
                <span className="remote-row__label">{t('remote.rowSize')}</span>
                <RemoteSizeSeg choices={choices} />
            </div>
            <div className="remote-row">
                <span className="remote-row__label">{t('remote.sizeCustom')}</span>
                <input
                    type="text"
                    inputMode="numeric"
                    aria-label={t('remote.widthPx')}
                    value={draftWidth}
                    className="remote-field"
                    style={REMOTE_NO_DRAG_STYLE}
                    onChange={event => setDraftWidth(digitsOnly(event.currentTarget.value))}
                    onKeyDown={saveOnEnter}
                />
                <span className="remote-field__times">×</span>
                <input
                    type="text"
                    inputMode="numeric"
                    aria-label={t('remote.heightPx')}
                    value={draftHeight}
                    className="remote-field"
                    style={REMOTE_NO_DRAG_STYLE}
                    onChange={event => setDraftHeight(digitsOnly(event.currentTarget.value))}
                    onKeyDown={saveOnEnter}
                />
                {aspect && <span className="remote-row__note">{aspect.ratio} {t(`remote.${aspect.kind}`)}</span>}
                <span className="remote-row__space" />
                <button
                    type="button"
                    disabled={!draftWidth || !draftHeight}
                    className="remote-btn remote-btn--primary"
                    style={REMOTE_NO_DRAG_STYLE}
                    onClick={save}
                >
                    {t('remote.save')}
                </button>
            </div>
        </div>
    );
};
