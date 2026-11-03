import React from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PonderTargetDefinition } from '../../types/ponder';
import { ponderModifierLabel } from './PonderKeyCap';

// src/components/ponder/PonderLessonRow.tsx
// One lesson in the index: its title, its one line under it, a tick when it has been watched, and
// a chevron. It is drawn as a row of the settings kit (the st-row hairline, the card it sits in)
// and it is a button: a click opens the lesson.
//
// Every row carries data-ponder-nav-target: resting the pointer on it brings the hint and holding
// G goes in, exactly as on a real component; resolveHoveredPonderTarget reads the attribute.

type PonderLessonRowProps = {
    target: PonderTargetDefinition;
    seen: boolean;
    onOpen: () => void;
};

const PonderLessonRow: React.FC<PonderLessonRowProps> = ({ target, seen, onOpen }) => {
    const { t } = useTranslation();

    return (
        <button
            type="button"
            data-ponder-nav-target={target.id}
            data-ponder-nav-seen={seen || undefined}
            onClick={onOpen}
            className="st-row st-focus-inside st-t-fast relative flex min-h-14 w-full items-center gap-4 py-2.5 pl-4 pr-3 text-left transition-colors hover:bg-[var(--st-fill)]"
        >
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium leading-5 text-[color:var(--st-t1)]">{t(target.titleKey)}</span>
                {target.summaryKey && (
                    <span className="mt-0.5 block text-xs leading-[18px] text-[color:var(--st-t2)]">
                        {/* The same interpolation as a caption: {{mod}} is Ctrl or Cmd by platform. */}
                        {t(target.summaryKey, { mod: ponderModifierLabel })}
                    </span>
                )}
            </span>
            <span className="flex flex-none items-center gap-2.5 text-[color:var(--st-t3)]">
                {seen && <Check size={14} aria-label={t('ponder.navigation.seen')} />}
                <ChevronRight size={14} aria-hidden="true" />
            </span>
        </button>
    );
};

export default PonderLessonRow;
