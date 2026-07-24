import { Layers, Music2, Sliders, Tv } from 'lucide-react';
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
    i18nKey: 'releaseNotes.v0_6_2',
    features: [
        { id: 'multiProvider', icon: Layers, daylightIconClassName: 'text-rose-500', darkIconClassName: 'text-rose-400' },
        { id: 'harmonyLyrics', icon: Music2, daylightIconClassName: 'text-indigo-500', darkIconClassName: 'text-indigo-400' },
        { id: 'playerCap', icon: Tv, daylightIconClassName: 'text-emerald-500', darkIconClassName: 'text-emerald-400' },
        { id: 'typographyAndCustomization', icon: Sliders, daylightIconClassName: 'text-amber-500', darkIconClassName: 'text-amber-400' },
    ],
};
