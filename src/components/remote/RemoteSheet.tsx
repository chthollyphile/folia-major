import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { PlayerChromeVisibilityMode, RemoteControlSnapshot } from '../../types/remoteControl';
import { RemoteActionButtons } from './RemoteActionButtons';
import RemoteExportTab, { isRemoteExportBusy } from './RemoteExportTab';
import { RemoteSeg, RemoteSwitch } from './RemoteSheetControls';
import { formatRemoteSize, RemoteSizeView } from './RemoteSizeRows';
import { REMOTE_NO_DRAG_STYLE, sendRemoteCommand } from './remoteWindowBridge';
import type { RemoteExportChoices } from './useRemoteExportChoices';
import './RemoteSheet.css';

// src/components/remote/RemoteSheet.tsx
// The sheet behind "more": it takes the place of the song and the lyric, above the line, and the
// keys stay. Two tabs: the main window's switches, and the video export. The size presets are
// reached from both, because a preset both resizes the main window and sets the recording size.
// A third tab holds the buttons mods add to the remote (Folium `remote.actions`); it is there only
// while some mod adds one, so the card and the keys stay as they are.

export type RemoteSheetTab = 'window' | 'export' | 'mods';

type RemoteSheetProps = {
    tab: RemoteSheetTab;
    snapshot: RemoteControlSnapshot;
    /** False on native Wayland: the main window's pin switch greys out instead of showing a state that never took. */
    alwaysOnTopSupported: boolean;
    choices: RemoteExportChoices;
    /** No song, or the main window has the controls locked. */
    primaryDisabled: boolean;
    reduceMotion: boolean;
    onTabChange: (tab: RemoteSheetTab) => void;
    onClose: () => void;
};

const RemoteSheet: React.FC<RemoteSheetProps> = ({
    tab,
    snapshot,
    alwaysOnTopSupported,
    choices,
    primaryDisabled,
    reduceMotion,
    onTabChange,
    onClose,
}) => {
    const { t } = useTranslation();
    const [isSizeOpen, setIsSizeOpen] = useState(false);
    const exportBusy = isRemoteExportBusy(snapshot.exportState.status);
    const hasModActions = Boolean(snapshot.remoteActions?.items.length);
    // A size is not changed under a running recording, so the size view closes when one starts.
    // The mods tab goes back to the main window's switches once no mod adds a button.
    const view = isSizeOpen && !exportBusy ? 'size' : tab === 'mods' && !hasModActions ? 'window' : tab;

    const selectTab = (next: RemoteSheetTab) => {
        setIsSizeOpen(false);
        onTabChange(next);
    };

    return (
        <motion.div
            className="remote-sheet"
            initial={{ opacity: 0, y: reduceMotion ? 0 : 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : 4 }}
            transition={{ duration: reduceMotion ? 0 : 0.18, ease: 'easeOut' }}
        >
            <button
                type="button"
                aria-label={t('remote.back')}
                className="remote-sheet__back"
                style={REMOTE_NO_DRAG_STYLE}
                onClick={() => (view === 'size' ? setIsSizeOpen(false) : onClose())}
            >
                <ChevronLeft size={15} />
            </button>

            <div className="remote-sheet__tabs" role={view === 'size' ? undefined : 'tablist'} style={REMOTE_NO_DRAG_STYLE}>
                {view === 'size' ? (
                    <span className="remote-sheet__tab" data-on="true">{t('remote.rowSize')}</span>
                ) : (
                    <>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={view === 'window'}
                            data-on={view === 'window'}
                            className="remote-sheet__tab"
                            onClick={() => selectTab('window')}
                        >
                            {t('remote.tabMainWindow')}
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={tab === 'export'}
                            data-on={tab === 'export'}
                            className="remote-sheet__tab"
                            onClick={() => selectTab('export')}
                        >
                            {t('remote.tabExport')}
                        </button>
                        {hasModActions && (
                            <button
                                type="button"
                                role="tab"
                                aria-selected={view === 'mods'}
                                data-on={view === 'mods'}
                                className="remote-sheet__tab"
                                onClick={() => selectTab('mods')}
                            >
                                {t('remote.tabMods')}
                            </button>
                        )}
                    </>
                )}
            </div>

            {view === 'size' && <RemoteSizeView choices={choices} />}

            {view === 'mods' && (
                <RemoteActionButtons
                    snapshot={snapshot.remoteActions}
                    visible
                    isDaylight={Boolean(snapshot.isDaylight)}
                    className="remote-actions"
                    classes={{ base: 'remote-action', idle: '', active: 'remote-action--on', alert: 'remote-action--alert' }}
                    sendCommand={sendRemoteCommand}
                />
            )}

            {view === 'export' && (
                <RemoteExportTab
                    exportState={snapshot.exportState}
                    choices={choices}
                    startDisabled={primaryDisabled}
                    onOpenSize={() => setIsSizeOpen(true)}
                />
            )}

            {view === 'window' && (
                <div className="remote-rows">
                    <div className="remote-row">
                        {/* <span className="remote-row__label">{t('remote.rowMode')}</span> */}
                        {/* <RemoteSeg
                            label={t('remote.rowMode')}
                            value={snapshot.transparentModeEnabled ? 'transparent' : 'standard'}
                            options={[
                                { value: 'standard', label: t('remote.standard') },
                                { value: 'transparent', label: t('remote.transparent') },
                            ]}
                            onChange={value => sendRemoteCommand({
                                type: 'set-transparent-mode-enabled',
                                enabled: value === 'transparent',
                            })}
                        /> */}
                        {/* <span className="remote-row__space" /> */}
                        <span className="remote-row__label remote-row__label--trailing">{t('remote.rowSize')}</span>
                        <button
                            type="button"
                            disabled={exportBusy}
                            className="remote-btn remote-btn--soft"
                            style={REMOTE_NO_DRAG_STYLE}
                            onClick={() => setIsSizeOpen(true)}
                        >
                            {formatRemoteSize(choices.selectedPreset.width, choices.selectedPreset.height)}
                            <ChevronRight size={12} />
                        </button>
                    </div>
                    <div className="remote-row">
                        <span className="remote-row__label">{t('remote.rowChrome')}</span>
                        <RemoteSeg<PlayerChromeVisibilityMode>
                            label={t('remote.rowChrome')}
                            value={snapshot.playerChromeVisibilityMode}
                            options={[
                                { value: 'always-visible', label: t('remote.chromeAlwaysVisible') },
                                { value: 'auto-hide', label: t('remote.chromeAutoHide') },
                                { value: 'always-hidden', label: t('remote.chromeAlwaysHidden') },
                            ]}
                            onChange={mode => sendRemoteCommand({ type: 'set-player-chrome-visibility-mode', mode })}
                        />
                    </div>
                    <div className="remote-row">
                        <span className="remote-row__label">{t('remote.rowWindow')}</span>
                        <RemoteSwitch
                            label={t('remote.border')}
                            on={snapshot.mainWindowBorderVisible}
                            onChange={visible => sendRemoteCommand({ type: 'set-main-window-border-visible', visible })}
                        />
                        <RemoteSwitch
                            label={t('remote.through')}
                            on={snapshot.mainWindowClickThroughEnabled}
                            disabled={!snapshot.transparentModeEnabled}
                            onChange={enabled => sendRemoteCommand({ type: 'set-main-window-click-through', enabled })}
                        />
                        <RemoteSwitch
                            label={t('remote.pin')}
                            on={alwaysOnTopSupported && snapshot.mainWindowAlwaysOnTop}
                            disabled={!alwaysOnTopSupported}
                            hint={alwaysOnTopSupported ? undefined : t('remote.pinUnavailable')}
                            onChange={enabled => sendRemoteCommand({ type: 'set-main-window-always-on-top', enabled })}
                        />
                    </div>
                </div>
            )}
        </motion.div>
    );
};

export default RemoteSheet;
