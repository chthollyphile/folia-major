import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import type { SoloistResult } from '../../../types/soloist';
import { useSoloistSettingsStore, watchSoloistStatus, runSoloistAction, soloistProgramInstalled, soloistProgramUsable } from '../../../stores/useSoloistSettingsStore';
import './playbackSettings.css';

// Local playback setup supplements the existing account login; it does not read song or account APIs.
const api = window.electron;
const Step = ({ number, title, done, children }: { number: number; title: string; done: boolean; children: React.ReactNode }) => (
    <section className="soloist-step" data-done={done || undefined}>
        <h4><span className="soloist-step-number">{done ? <Check size={13} aria-hidden /> : number}</span>{title}</h4>
        <div className="soloist-step-body">{children}</div>
    </section>
);
const PlaybackSettings = ({ signedIn }: { signedIn: boolean }) => {
    const { t, i18n } = useTranslation();
    const status = useSoloistSettingsStore(state => state.status);
    const busy = useSoloistSettingsStore(state => state.busy);
    const statusError = useSoloistSettingsStore(state => state.error);
    const [key, setKey] = useState('');
    const [editing, setEditing] = useState(false);
    const [message, setMessage] = useState('');
    const alive = useRef(false);
    useEffect(() => {
        alive.current = true;
        const stop = watchSoloistStatus();
        return () => { alive.current = false; stop(); };
    }, []);
    if (!api?.soloistStatus) return null;
    const action = async (work: () => Promise<SoloistResult | unknown>) => {
        setMessage('');
        try {
            const result = await runSoloistAction(work) as SoloistResult;
            if (!alive.current) return;
            if (result?.saved) { setKey(''); setEditing(false); }
            if (result?.ok === false) setMessage(result.message || 'start');
        } catch { if (alive.current) setMessage('storage'); }
    };
    const binary = status?.binary;
    const installed = soloistProgramInstalled(status);
    const usable = soloistProgramUsable(status);
    const stored = status?.configured === true;
    const unlocked = stored && status?.keyState === 'available';
    const connected = status?.connected === true;
    const ready = signedIn && usable && unlocked && connected;
    const changing = editing || !stored;
    const formatDate = (value?: number) => value ? new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium' }).format(value) : t('soloist.unknown');
    return (
        <section className="soloist-settings" data-account={signedIn || undefined} aria-label={t('soloist.title')}>
            <header><h3>{t('soloist.title')}</h3><span>{t(ready ? 'soloist.ready' : 'soloist.incomplete')}</span></header>
            <p>{t('soloist.intro')}</p>
            <Step number={1} title={t('soloist.account')} done={signedIn}>
                <p>{t(signedIn ? 'soloist.accountReady' : 'soloist.accountGuide')}</p>
            </Step>
            <Step number={2} title={t('soloist.install')} done={usable}>
                {installed && binary ? <>
                    <p><strong>{t('soloist.version', { version: binary.version || t('soloist.unknown') })}</strong>{' · '}{binary.state === 'expired' ? t('soloist.expired') : binary.daysRemaining != null ? t('soloist.remaining', { count: binary.daysRemaining }) : t('soloist.unknown')}</p>
                    {binary.builtAt && <p className="soloist-muted">{t('soloist.dates', { built: formatDate(binary.builtAt), expires: formatDate(binary.expiresAt) })}</p>}
                    {['expired', 'expiring', 'clock-warning', 'unknown'].includes(binary.state) && <p role="status">{t(`soloist.build.${binary.state}`)}</p>}
                </> : <p>{t('soloist.downloadGuide')}</p>}
                <div className="soloist-actions">
                    <button type="button" onClick={() => void api.soloistOfficial?.('download')}>{t('soloist.download')}</button>
                    <button type="button" disabled={busy} onClick={() => void action(() => api.soloistSelectBinary!())}>{t('soloist.select')}</button>
                    {installed && <button type="button" disabled={busy} onClick={() => void action(() => api.soloistCheckVersion!())}>{t('soloist.checkVersion')}</button>}
                </div>
                <p className="soloist-muted">{t('soloist.lifetime')}</p>
                {binary?.path && <details><summary>{t('soloist.location')}</summary><code>{binary.path}</code></details>}
            </Step>
            <Step number={3} title={t('soloist.saveKey')} done={unlocked}>
                <p>{t(stored ? unlocked ? 'soloist.keySaved' : 'soloist.keyLocked' : 'soloist.keyGuide')}</p>
                <div className="soloist-actions"><button type="button" onClick={() => void api.soloistOfficial?.('key')}>{t('soloist.generate')}</button></div>
                <label htmlFor="soloist-api-key">{t('soloist.keyLabel')}</label>
                <div className="soloist-key-row">
                    <input id="soloist-api-key" type="password" autoComplete="new-password" spellCheck={false} readOnly={!changing || busy} value={changing ? key : '••••••••'} onChange={event => setKey(event.target.value)} aria-describedby="soloist-key-note" />
                    {stored && <button type="button" disabled={busy} onClick={() => { setEditing(!editing); setKey(''); }}>{t(editing ? 'soloist.cancelKey' : 'soloist.changeKey')}</button>}
                </div>
                <p id="soloist-key-note" className="soloist-muted">{t('soloist.keyPrivacy')}</p>
                <div className="soloist-actions">
                    <button type="button" className="soloist-primary" disabled={busy || (changing ? !key.trim() : !usable)} onClick={() => void action(() => changing && key.trim() ? api.soloistSave!(key) : api.soloistPrepare!())}>{t(busy ? 'soloist.busy' : changing ? 'soloist.save' : 'soloist.connect')}</button>
                    {stored && <button type="button" disabled={busy || !usable} onClick={() => void action(() => api.soloistRestart!())}>{t('soloist.reconnect')}</button>}
                </div>
            </Step>
            <Step number={4} title={t('soloist.pair')} done={connected}>
                <p>{t(connected ? 'soloist.paired' : status?.running ? 'soloist.pairGuide' : 'soloist.startGuide')}</p>
            </Step>
            {(message || status?.error || statusError) && <p role="alert">{t(`soloist.errors.${message || status?.error || statusError}`)}</p>}
            <p className="soloist-muted">{t('soloist.limitations')} <button type="button" onClick={() => void api.soloistOfficial?.('guide')}>{t('soloist.guide')}</button></p>
        </section>
    );
};
export default PlaybackSettings;
