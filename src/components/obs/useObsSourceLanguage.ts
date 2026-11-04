import { useEffect } from 'react';
import i18n from '../../i18n/config';

// src/components/obs/useObsSourceLanguage.ts
// Puts an OBS browser source in Folia's UI language. OBS's browser has none of the app's saved
// settings, so it would otherwise follow its own system language for the text it draws (the card).

const SUPPORTED = new Set(['en', 'zh-CN', 'zh-TW', 'in', 'vi']);

/** Switches to the given language when it is one Folia ships; anything else leaves OBS's own. */
export const useObsSourceLanguage = (language: string | null | undefined) => {
    useEffect(() => {
        if (!language || !SUPPORTED.has(language) || language === i18n.resolvedLanguage) return;
        // changeLanguage, not applyAppLanguagePreference: the source must not save a preference.
        void i18n.changeLanguage(language);
    }, [language]);
};
