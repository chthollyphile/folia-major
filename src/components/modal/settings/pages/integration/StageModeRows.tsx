import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { selectWebObsSource } from '../../../../../services/obs/webObsTarget';
import { useStageSettingsStore } from '../../../../../stores/useStageSettingsStore';
import type { NowPlayingConnectionStatus, StageSource } from '../../../../../types';
import type { PlayerCapConnectionStatus } from '../../../../../types/playerCap';
import { Button, CopyValue, Reveal, Row, Segmented, Select, Status, TextField, Toggle, Value } from '../../kit';
import ObsLinkRows from '../ObsLinkRows';
import { useSettingsPage } from '../settingsPageContext';
import { O } from './options';

// src/components/modal/settings/pages/integration/StageModeRows.tsx
// The stage mode rows of the 连接与集成 page. The desktop app and the web build each have their
// own switch and their own list of sources; the rows of the PlayerCap and Now Playing sources are
// the same in both. The connection states come from the settings dialog, the PlayerCap settings
// from their store.

const DEFAULT_PLAYERCAP_HOST = 'localhost:8765';

type Connection = { tone?: 'ok' | 'error'; labelKey: string };

const CONNECTED: Connection = { tone: 'ok', labelKey: 'status.connected' };
const CONNECTING: Connection = { labelKey: 'status.connecting' };
const FAILED: Connection = { tone: 'error', labelKey: 'status.disconnected' };
const OFF: Connection = { labelKey: 'options.updateCheckDisabled' };

const playerCapConnection = (status: PlayerCapConnectionStatus | undefined): Connection => {
    switch (status) {
        case 'connected': return CONNECTED;
        case 'connecting':
        case 'probing': return CONNECTING;
        case 'disconnected':
        case 'unreachable': return FAILED;
        default: return OFF;
    }
};

const nowPlayingConnection = (status: NowPlayingConnectionStatus): Connection => {
    switch (status) {
        case 'connected': return CONNECTED;
        case 'connecting': return CONNECTING;
        case 'error': return FAILED;
        default: return OFF;
    }
};

/** A token with its middle left out; one of ten characters or fewer is shown whole. */
const maskToken = (token: string) => (token.length <= 10 ? token : `${token.slice(0, 6)}...${token.slice(-4)}`);

/** The PlayerCap source: where it is reached, which player it follows, which timeline, and whether a cleared player keeps its lyrics. */
const PlayerCapRows: React.FC = () => {
    const { t } = useTranslation();
    const { playerCapConnectionStatus, playerCapPlayers } = useSettingsPage().viewProps.integration.stage;
    const playerCap = useStageSettingsStore(useShallow(state => ({
        host: state.playerCapHost,
        player: state.playerCapPlayer,
        timeBasis: state.playerCapTimeBasis,
        sticky: state.playerCapSticky,
        setHost: state.setPlayerCapHost,
        setPlayer: state.setPlayerCapPlayer,
        setTimeBasis: state.setPlayerCapTimeBasis,
        setSticky: state.setPlayerCapSticky,
    })));
    // The address is taken when the field is left, so a half-typed one is never connected to.
    const [hostDraft, setHostDraft] = useState(playerCap.host);
    useEffect(() => {
        setHostDraft(playerCap.host);
    }, [playerCap.host]);
    const connection = playerCapConnection(playerCapConnectionStatus);

    return (
        <>
            <Row sub option={O.playerCapAddress} hint={t('options.playerCapAddressHint')}>
                <Status tone={connection.tone}>{t(connection.labelKey)}</Status>
                <TextField
                    value={hostDraft}
                    onChange={setHostDraft}
                    onCommit={() => playerCap.setHost(hostDraft.trim() || DEFAULT_PLAYERCAP_HOST)}
                    placeholder={DEFAULT_PLAYERCAP_HOST}
                />
            </Row>
            <Row sub option={O.playerCapPlayer}>
                <Select
                    value={playerCap.player}
                    options={[
                        { value: '', label: t('options.playerCapPlayerDefault') },
                        ...(playerCapPlayers ?? []).map(player => ({ value: player, label: player })),
                    ]}
                    onChange={playerCap.setPlayer}
                    disabled={playerCapConnectionStatus !== 'connected'}
                />
            </Row>
            <Row
                sub
                option={O.playerCapTimeline}
                hint={t(playerCap.timeBasis === 'timestamp' ? 'options.playerCapBasisTimestamp' : 'options.playerCapBasisPlayTime')}
            >
                <Segmented
                    value={playerCap.timeBasis}
                    options={[
                        { value: 'play_time', label: 'play_time' },
                        { value: 'timestamp', label: 'timestamp' },
                    ]}
                    onChange={playerCap.setTimeBasis}
                />
            </Row>
            <Row sub option={O.playerCapIgnoreClear} hint={t('options.playerCapIgnoreClearHint')}>
                <Toggle checked={playerCap.sticky} onChange={playerCap.setSticky} />
            </Row>
        </>
    );
};

/** The Now Playing source: it has one fixed address, so the row only says whether it is connected. */
const NowPlayingRow: React.FC = () => {
    const { t } = useTranslation();
    const connection = nowPlayingConnection(useSettingsPage().viewProps.integration.stage.nowPlayingConnectionStatus);

    return (
        <Row sub label="Now Playing" hint={t('options.nowPlayingFixedConnectionDesc')}>
            <Status tone={connection.tone}>{t(connection.labelKey)}</Status>
        </Row>
    );
};

/** The desktop app's stage mode: the app serves or follows one of three sources. */
export const DesktopStageRows: React.FC = () => {
    const { t } = useTranslation();
    const { stageStatus, stageSource, onToggleStageMode, onStageSourceChange, onRegenerateStageToken } = useSettingsPage().viewProps.integration.stage;
    const [regenerating, setRegenerating] = useState(false);
    if (!stageStatus) {
        return null;
    }
    const on = Boolean(stageStatus.modeEnabled);
    const source = stageSource ?? 'stage-api';
    const token = stageStatus.token;
    const regenerateToken = async () => {
        setRegenerating(true);
        try {
            await onRegenerateStageToken?.();
        } finally {
            setRegenerating(false);
        }
    };

    return (
        <>
            <Row option={O.stage} hint={t('options.enableStageModeDescElectron')}>
                <Toggle checked={on} onChange={enabled => void onToggleStageMode?.(enabled)} />
            </Row>
            <Reveal when={on}>
                <Row sub option={O.stageSource}>
                    <Segmented<StageSource>
                        value={source}
                        options={[
                            { value: 'stage-api', label: 'Stage API' },
                            { value: 'now-playing', label: 'Now Playing' },
                            { value: 'playercap', label: 'PlayerCap' },
                        ]}
                        onChange={next => void onStageSourceChange?.(next)}
                    />
                </Row>
                <Reveal when={source === 'playercap'}>
                    <PlayerCapRows />
                </Reveal>
                <Reveal when={source === 'now-playing'}>
                    <NowPlayingRow />
                </Reveal>
                <Reveal when={source === 'stage-api'}>
                    <Row sub label={t('options.stageAddress')}>
                        <CopyValue value={`http://127.0.0.1:${stageStatus.port}`} />
                    </Row>
                    <Row sub label={t('options.stageToken')}>
                        {token ? <CopyValue value={token} shown={maskToken(token)} /> : <Value>{t('options.stageTokenMissing')}</Value>}
                        <Button onClick={() => void regenerateToken()} disabled={regenerating}>
                            {regenerating ? t('options.stageTokenRegenerating') : t('options.regenerateStageToken')}
                        </Button>
                    </Row>
                </Reveal>
            </Reveal>
        </>
    );
};

/** The web build's stage mode: lyrics come from a service on this machine, and the page can be shown in OBS through a link. */
export const WebStageRows: React.FC = () => {
    const { t } = useTranslation();
    const source = useStageSettingsStore(selectWebObsSource);
    const setSource = useStageSettingsStore(state => state.setWebStageSource);

    return (
        <>
            <Row option={O.stage} hint={t('options.enableStageModeDescWeb')}>
                <Toggle checked={source !== null} onChange={enabled => setSource(enabled ? 'now-playing' : null)} />
            </Row>
            <Reveal when={source !== null}>
                <Row sub option={O.stageSource}>
                    <Segmented
                        value={source ?? 'now-playing'}
                        options={[
                            { value: 'now-playing', label: 'Now Playing' },
                            { value: 'playercap', label: 'PlayerCap' },
                        ]}
                        onChange={setSource}
                    />
                </Row>
                <Reveal when={source === 'playercap'}>
                    <PlayerCapRows />
                </Reveal>
                <Reveal when={source === 'now-playing'}>
                    <NowPlayingRow />
                </Reveal>
                <ObsLinkRows sub />
            </Reveal>
        </>
    );
};
