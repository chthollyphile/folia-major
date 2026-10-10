import { useTranslation } from 'react-i18next';
import { usePlayerChromeSettingsStore } from '../../../stores/usePlayerChromeSettingsStore';
import { resolvePlayerControlSlot, type PlayerControlSlotActionId } from '../../floating-player/playerControlSlotActions';
import { useLatticePlaybackActions } from './LatticePlaybackProvider';

// src/components/app/lattice/LatticeExtraControls.tsx
// Transport and the main bar's configured slots share their handlers, icons and availability.
export default function LatticeExtraControls({ disabled }: { disabled: boolean }) {
    const { t } = useTranslation();
    const context = useLatticePlaybackActions();
    const primary = usePlayerChromeSettingsStore(state => state.playerControlSlotPrimary);
    const secondary = usePlayerChromeSettingsStore(state => state.playerControlSlotSecondary);
    const actions: PlayerControlSlotActionId[] = ['prev', primary, secondary, 'next'];
    return <div className="lattice-chrome-actions">
        {actions.map((action) => {
            const slot = resolvePlayerControlSlot(action, context);
            const Icon = slot.icon;
            // key 用 action 而非 index：primary/secondary 是用户可配置的两个插槽，
            // 换成别的功能时 index 不变，React 会把旧按钮的焦点态和 CSS transition 接着用。
            return <button key={action} type="button" data-action={action} className={slot.active ? 'is-active' : ''}
                disabled={disabled || slot.disabled} onClick={() => slot.onActivate()}
                aria-label={t(slot.labelKey)} title={t(slot.labelKey)}
                aria-pressed={action === 'loop' || action === 'like' ? slot.active : undefined}>
                <Icon size={20} fill={slot.filled ? 'currentColor' : 'none'} />
            </button>;
        })}

    </div>;
}
