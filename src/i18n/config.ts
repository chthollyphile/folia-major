import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.ts';
import zhCN from './locales/zh-CN.ts';

export type AppLanguagePreference = 'system' | 'en' | 'zh-CN';
export const APP_LANGUAGE_STORAGE_KEY = 'folia_app_language';

const isSupportedManualLanguage = (value: string | null | undefined): value is Exclude<AppLanguagePreference, 'system'> => (
  value === 'en' || value === 'zh-CN'
);

const normalizeSupportedLanguage = (value: string | null | undefined): Exclude<AppLanguagePreference, 'system'> => {
  if (!value) {
    return 'en';
  }

  if (value.toLowerCase().startsWith('zh')) {
    return 'zh-CN';
  }

  return 'en';
};

export const readStoredAppLanguagePreference = (): AppLanguagePreference => {
  if (typeof window === 'undefined') {
    return 'system';
  }

  const saved = localStorage.getItem(APP_LANGUAGE_STORAGE_KEY);
  if (saved === 'system' || isSupportedManualLanguage(saved)) {
    return saved;
  }

  return 'system';
};

const initialLanguagePreference = readStoredAppLanguagePreference();

const syncDocumentLanguage = (value: string | null | undefined) => {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.lang = normalizeSupportedLanguage(value);
};

const detectSystemLanguage = (): Exclude<AppLanguagePreference, 'system'> => {
  const detected = i18n.services.languageDetector?.detect();
  if (Array.isArray(detected)) {
    return normalizeSupportedLanguage(detected[0]);
  }

  return normalizeSupportedLanguage(detected ?? (typeof navigator !== 'undefined' ? navigator.language : 'en'));
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        translation: en
      },
      'zh-CN': {
        translation: zhCN
      }
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'zh-CN'],
    ...(initialLanguagePreference !== 'system' ? { lng: initialLanguagePreference } : {}),
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng'
    },
    interpolation: {
      escapeValue: false
    }
  });

i18n.on('languageChanged', lng => {
  syncDocumentLanguage(lng);
});

syncDocumentLanguage(i18n.resolvedLanguage ?? i18n.language);

export const applyAppLanguagePreference = async (
  preference: AppLanguagePreference
): Promise<Exclude<AppLanguagePreference, 'system'>> => {
  if (typeof window !== 'undefined') {
    if (preference === 'system') {
      localStorage.setItem(APP_LANGUAGE_STORAGE_KEY, preference);
      localStorage.removeItem('i18nextLng');
    } else {
      localStorage.setItem(APP_LANGUAGE_STORAGE_KEY, preference);
    }
  }

  const nextLanguage = preference === 'system' ? detectSystemLanguage() : preference;
  await i18n.changeLanguage(nextLanguage);
  return nextLanguage;
};

export default i18n;
