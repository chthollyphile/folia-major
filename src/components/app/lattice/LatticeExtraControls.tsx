import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePlayerChromeSettingsStore } from '../../../stores/usePlayerChromeSettingsStore';
import { resolvePlayerControlSlot, type PlayerControlSlotActionId } from '../../floating-player/playerControlSlotActions';
import { useLatticePlaybackActions } from './LatticePlaybackProvider';

// src/components/app/lattice/LatticeExtraControls.tsx
// Transport and the main bar's configured slots share their handlers, icons and availability.
// 私人 FM 里（电台墙）：打乱和队列两格本来就用不了，不画；末尾加一颗「不喜欢」。
/** 私人 FM 里没有意义的槽位：队列由电台续上，不能打乱、不能编辑。 */
const FM_IDLE_SLOTS: ReadonlySet<PlayerControlSlotActionId> = new Set(['shuffle', 'queue']);

export default function LatticeExtraControls({ disabled }: { disabled: boolean }) {
    const { t } = useTranslation();
    const context = useLatticePlaybackActions();
    const primary = usePlayerChromeSettingsStore(state => state.playerControlSlotPrimary);
    const secondary = usePlayerChromeSettingsStore(state => state.playerControlSlotSecondary);
    const slots = context.isFmMode ? [primary, secondary].filter(slot => !FM_IDLE_SLOTS.has(slot)) : [primary, secondary];
    const actions: PlayerControlSlotActionId[] = ['prev', ...slots, 'next'];
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
        {context.isFmMode && (
            <button type="button" data-action="dislike" disabled={disabled || !context.canDislike}
                onClick={context.onDislike} aria-label={t('ui.trashDislike')} title={t('ui.trashDislike')}>
                <Trash2 size={20} />
            </button>
        )}
    </div>;
}
