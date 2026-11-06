import { defineCommand } from '../../commandFactories';
import { openLoginWindow } from '../../../login/loginWindowStore';
import { canReconnectSoloist, canCheckSoloistLifetime, refreshSoloistStatus, runSoloistAction } from '../../../../stores/useSoloistSettingsStore';

// Direct actions share the login page's metadata and action lock; saving credentials stays in the page.
export default [
    defineCommand({
        id: 'spotify-playback-setup',
        group: 'settings',
        title: 'Spotify playback setup',
        description: 'Configure official Soloist, its API key, and device pairing',
        keywords: ['spotify', 'soloist', 'playback setup', 'connect', 'Spotify 播放设置', '密钥', '设备配对'],
        platform: ['electron'],
        execute: () => { openLoginWindow('spotify'); return true; },
    }),
    defineCommand({
        id: 'spotify-soloist-reconnect',
        group: 'settings',
        title: 'Reconnect Spotify Soloist',
        description: 'Restart the configured Soloist player and reconnect',
        keywords: ['spotify', 'soloist', 'reconnect', 'restart', '重新连接', '重启播放器'],
        platform: ['electron'],
        isAvailable: canReconnectSoloist,
        execute: async (_input, context) => {
            await refreshSoloistStatus();
            if (!canReconnectSoloist()) return true;
            try {
                const result = await runSoloistAction(() => window.electron!.soloistRestart!());
                if (result) context.shared.setStatusMsg({
                    type: result.ok ? 'success' : 'error',
                    text: context.shared.t(result.ok ? 'soloist.reconnected' : `soloist.errors.${result.message || 'start'}`),
                });
            } catch { context.shared.setStatusMsg({ type: 'error', text: context.shared.t('soloist.errors.storage') }); }
            return true;
        },
    }),
    defineCommand({
        id: 'spotify-soloist-check-lifetime',
        group: 'settings',
        title: 'Check Spotify Soloist lifetime',
        description: 'Read the installed build and show its remaining lifetime',
        keywords: ['spotify', 'soloist', 'version', 'expiry', 'lifetime', '检查有效期', '版本', '到期'],
        platform: ['electron'],
        isAvailable: canCheckSoloistLifetime,
        execute: async (_input, context) => {
            await refreshSoloistStatus();
            if (!canCheckSoloistLifetime()) return true;
            try {
                const build = await runSoloistAction(() => window.electron!.soloistCheckVersion!());
                if (!build) return true;
                const { t, setStatusMsg } = context.shared;
                const valid = ['valid', 'expiring'].includes(build.state);
                const lifetime = build.state === 'expired' ? t('soloist.expired')
                    : build.daysRemaining != null ? t('soloist.remaining').replace('{{count}}', String(build.daysRemaining))
                    : t('soloist.unknown');
                setStatusMsg({ type: valid ? 'success' : 'error', text: `${t('soloist.version').replace('{{version}}', build.version || t('soloist.unknown'))} · ${lifetime}` });
            } catch { context.shared.setStatusMsg({ type: 'error', text: context.shared.t('soloist.errors.unavailable') }); }
            return true;
        },
    }),
];
