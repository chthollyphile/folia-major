import { ArrowLeft, Sparkles, Volume2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// src/components/modal/newFeaturesRelease.ts

type NewFeatureCard = {
    id: string;
    icon: LucideIcon;
    daylightIconClassName: string;
    darkIconClassName: string;
};

type NewFeaturesRelease = {
    i18nKey: string;
    features: NewFeatureCard[];
};

// Defines the current release's cards; their localized text lives under i18nKey in every locale.
export const NEW_FEATURES_RELEASE: NewFeaturesRelease = {
    i18nKey: 'releaseNotes.v0_6_9',
    features: [
        { id: 'sonnetVisualizer', icon: Sparkles, daylightIconClassName: 'text-fuchsia-600', darkIconClassName: 'text-fuchsia-400' },
        { id: 'replayGain', icon: Volume2, daylightIconClassName: 'text-amber-600', darkIconClassName: 'text-amber-400' },
        { id: 'panelNavigationHint', icon: ArrowLeft, daylightIconClassName: 'text-sky-600', darkIconClassName: 'text-sky-400' },
    ],
};
