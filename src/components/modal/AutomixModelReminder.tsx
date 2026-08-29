import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ThemedDialog from '../shared/ThemedDialog';
import { useSettingsUiStore } from '../../stores/useSettingsUiStore';

// src/components/modal/AutomixModelReminder.tsx
// The one interruption in the transition feature: switching blending on with no weights on disk.
//
// Mounted once at app level and self-contained, for the same reason AutomixTransitionAnimation is: it
// takes nothing from App.tsx and decides for itself whether it has anything to draw. Whether it SHOULD
// open is decided in the store, next to the switch it answers for - there are two of those switches, and
// a prompt wired to one component is missing from the other.
//
// Three buttons rather than two because "not now" and "never" are different answers, and a prompt that
// only offers the first will keep asking someone who has already decided. The download button opens the
// settings page and scrolls to the block rather than starting a download from here: two files, two
// mirrors each, and a progress bar that lives over there - starting one blind from a dialog would put the
// listener somewhere they cannot see it go wrong.

/** Matches the `id` on the models block in AutomixModelsSection. */
const MODELS_BLOCK_ID = 'automix-models';

const AutomixModelReminder: React.FC<{ isDaylight: boolean }> = ({ isDaylight }) => {
    const { t } = useTranslation();
    const { isOpen, dismiss, openSettings } = useSettingsUiStore(useShallow(state => ({
        isOpen: state.isAutomixModelReminderOpen,
        dismiss: state.dismissAutomixModelReminder,
        openSettings: state.openSettings,
    })));

    if (!isOpen) return null;

    const buttonClass = isDaylight
        ? 'rounded-xl border border-black/10 px-4 py-2 text-sm text-zinc-900 hover:bg-black/[0.04]'
        : 'rounded-xl border border-white/10 px-4 py-2 text-sm text-white hover:bg-white/[0.06]';

    const goDownload = () => {
        dismiss(false);
        openSettings('options', 'playback');
        // Two frames, not one: the modal mounts on the first and lays its scroll container out on the
        // second, and an element scrolled into a container that has no height yet does not move. Guarded
        // rather than assumed - the block only renders on desktop builds.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            document.getElementById(MODELS_BLOCK_ID)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }));
    };

    return (
        <ThemedDialog
            isOpen
            onClose={() => dismiss(false)}
            isDaylight={isDaylight}
            title={t('options.modelReminderTitle')}
            description={t('options.modelReminderDesc')}
        >
            <div className="flex flex-wrap items-center justify-end gap-2">
                {/* Left of the two dismissals and visually quieter than both: it is the answer
                    that cannot be taken back from this dialog, so it should not be the easy one. */}
                <button
                    type="button"
                    onClick={() => dismiss(true)}
                    className={`mr-auto text-sm underline opacity-50 hover:opacity-80 ${isDaylight ? 'text-zinc-900' : 'text-white'}`}
                >
                    {t('options.modelReminderNever')}
                </button>
                <button type="button" onClick={() => dismiss(false)} className={buttonClass}>
                    {t('options.modelReminderLater')}
                </button>
                <button
                    type="button"
                    onClick={goDownload}
                    className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white/90 flex items-center gap-1.5"
                >
                    <Download size={14} />
                    {t('options.modelReminderDownload')}
                </button>
            </div>
        </ThemedDialog>
    );
};

export default AutomixModelReminder;
