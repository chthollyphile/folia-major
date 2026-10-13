import { useTranslation } from 'react-i18next';
import { usePlayerChromeSettingsStore } from '../../../stores/usePlayerChromeSettingsStore';
import { resolvePlayerControlSlot, type PlayerControlSlotActionId } from '../../floating-player/playerControlSlotActions';
import { useLatticePlaybackActions } from './LatticePlaybackProvider';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import type { SongResult } from '../../../types';
import { useQueueUi } from '../../../hooks/useQueueUi';
import { QueueUiComponents } from '../../shared/QueueUiAdditions';

// src/components/app/lattice/LatticeExtraControls.tsx
// Transport and the main bar's configured slots share their handlers, icons and availability.
export default function LatticeExtraControls({ disabled, queueIndex, song }: { disabled: boolean; queueIndex: number; song: SongResult }) {
    const { t } = useTranslation();
    const context = useLatticePlaybackActions();
    const { isDaylight } = context;
    const queue = usePlaybackStore(state => state.playQueue);
    const { readEntry } = useQueueUi(queue, 'lattice');
    // Only append for the queue occurrence represented by this poster, never a matching media ID.
    const additions = readEntry(queue[queueIndex] === song ? queueIndex : -1);
    const primary = usePlayerChromeSettingsStore(state => state.playerControlSlotPrimary);
    const secondary = usePlayerChromeSettingsStore(state => state.playerControlSlotSecondary);
    const actions: PlayerControlSlotActionId[] = ['prev', primary, secondary, 'next'];
    return <div className="lattice-chrome-actions">
        {actions.map((action, index) => {
            const slot = resolvePlayerControlSlot(action, context);
            const Icon = slot.icon;
            return <button key={index} type="button" data-action={action} className={slot.active ? 'is-active' : ''}
                disabled={disabled || slot.disabled} onClick={() => slot.onActivate()}
                aria-label={t(slot.labelKey)} title={t(slot.labelKey)}
                aria-pressed={action === 'loop' || action === 'like' ? slot.active : undefined}>
                <Icon size={20} fill={slot.filled ? 'currentColor' : 'none'} />
            </button>;
        })}
        <QueueUiComponents components={additions.trailing} isDaylight={isDaylight} />
    </div>;
}
