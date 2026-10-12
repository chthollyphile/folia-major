import { HeartPulse } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHeartbeatModeStore } from '../../stores/useHeartbeatModeStore';
import { exitHeartbeatMode } from '../app/playback/heartbeatQueueReturn';
import { setStatusMessage } from '../../stores/useStatusMessageStore';

// src/components/panelTab/HeartbeatStatus.tsx
// A persistent queue status with an explicit return to the ordinary queue after the current track.

export const HeartbeatStatus = () => {
    const { t } = useTranslation();
    const active = useHeartbeatModeStore(state => Boolean(state.session));
    const loading = useHeartbeatModeStore(state => state.loading);
    if (!active && !loading) return null;
    return (
        <div data-testid="heartbeat-status" role="status" className="mb-2 flex items-center gap-2 rounded-lg border border-current/15 px-3 py-2 text-xs">
            <HeartPulse size={16} aria-hidden />
            <span className="flex-1">{t(loading ? 'heartbeat.loading' : 'heartbeat.active')}</span>
            <button type="button" className="rounded px-2 py-1 hover:bg-current/10" onClick={() => {
                exitHeartbeatMode();
                setStatusMessage({ type: 'info', text: t('heartbeat.stopped') });
            }}>{t('heartbeat.stop')}</button>
        </div>
    );
};
