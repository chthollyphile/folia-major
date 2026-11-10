import React from 'react';
import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Reveal, Row, Status, TextField, Toggle } from '../../kit';
import { useSettingsPage } from '../settingsPageContext';
import { O } from './options';

// src/components/modal/settings/pages/integration/NavidromeRows.tsx
// The Navidrome rows of the 连接与集成 page: the switch, the server address and sign-in under it,
// and a last row that says whether a connection is saved and tests the one typed. The form is the
// settings dialog's own state; a test that succeeds is what saves it. Where a Docker deployment
// set a preset account, the last row says when it is the one in use and can go back to it.

export const NavidromeRows: React.FC = () => {
    const { t } = useTranslation();
    const {
        navidromeConfigured: configured,
        navidromeEnabled: enabled,
        navidromePassword: password,
        navidromeServerProfile: profile,
        navidromeTestStatus: testStatus,
        navidromeUrl: url,
        navidromeUsername: username,
        navidromeCanRestorePreset: canRestorePreset,
        navidromeRestoreFailed: restoreFailed,
        navidromeRestoring: restoring,
        navidromeUsesPreset: usesPreset,
        onRestoreNavidromePreset,
        onClearNavidrome,
        onToggleNavidrome,
        setNavidromePassword,
        setNavidromeUrl,
        setNavidromeUsername,
        testNavidromeConnection,
    } = useSettingsPage().viewProps.integration.navidrome;
    const testing = testStatus === 'testing';
    // What is known about the saved connection: the server, the account, what the server offers,
    // and whether it is the deployment's preset account.
    const profileLine = [
        ...(configured && profile
            ? [
                profile.serverVersion || profile.serverType || t('navidrome.serverProfileUnavailable'),
                profile.user?.username || username,
                profile.openSubsonic ? `OpenSubsonic (${profile.openSubsonicExtensions.length})` : null,
                `${t('navidrome.musicFolders')} (${profile.musicFolders.length})`,
            ]
            : []),
        configured && usesPreset ? t('navidrome.usingServerPreset') : null,
    ].filter(Boolean).join(' · ') || undefined;

    return (
        <>
            <Row option={O.navidrome}>
                <Toggle checked={enabled} onChange={onToggleNavidrome} />
            </Row>
            <Reveal when={enabled}>
                <Row sub option={O.navidromeUrl}>
                    <TextField type="url" value={url} onChange={setNavidromeUrl} placeholder={t('navidrome.serverUrlPlaceholder')} />
                </Row>
                <Row sub option={O.navidromeUsername}>
                    <TextField value={username} onChange={setNavidromeUsername} />
                </Row>
                <Row sub option={O.navidromePassword}>
                    <TextField type="password" value={password} onChange={setNavidromePassword} placeholder={configured ? '••••••••' : undefined} />
                </Row>
                <Row
                    sub
                    label={testStatus === 'failed'
                        ? <Status tone="error">{t('navidrome.connectionFailed')}</Status>
                        : configured
                            ? <Status tone="ok">{t('navidrome.connectionSuccess')}</Status>
                            : <Status>{t('navidrome.notConfigured')}</Status>}
                    hint={profileLine}
                >
                    {configured && <Button onClick={onClearNavidrome}>{t('navidrome.clearSettings')}</Button>}
                    {canRestorePreset && (
                        <Button icon={RotateCcw} onClick={() => void onRestoreNavidromePreset()} disabled={restoring}>
                            {t('navidrome.restoreServerPreset')}
                        </Button>
                    )}
                    <Button
                        variant="primary"
                        onClick={() => void testNavidromeConnection()}
                        disabled={testing || !url || !username || !password}
                    >
                        {testing ? t('navidrome.testing') : t('navidrome.testConnection')}
                    </Button>
                </Row>
                {canRestorePreset && restoreFailed && <Row sub notice={t('navidrome.restoreServerPresetFailed')} />}
            </Reveal>
        </>
    );
};

export default NavidromeRows;
