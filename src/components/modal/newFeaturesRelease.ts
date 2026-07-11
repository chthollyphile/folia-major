import { Cloud, Copy, ListMusic, Shuffle } from 'lucide-react';
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
    i18nKey: 'releaseNotes.v0_5_25',
    features: [
        { id: 'cloudSync', icon: Cloud, daylightIconClassName: 'text-indigo-500', darkIconClassName: 'text-indigo-400' },
        { id: 'queueManagement', icon: ListMusic, daylightIconClassName: 'text-rose-500', darkIconClassName: 'text-rose-400' },
        { id: 'randomVisualizer', icon: Shuffle, daylightIconClassName: 'text-purple-500', darkIconClassName: 'text-purple-400' },
        { id: 'themeJsonCopy', icon: Copy, daylightIconClassName: 'text-emerald-500', darkIconClassName: 'text-emerald-400' },
    ],
};
