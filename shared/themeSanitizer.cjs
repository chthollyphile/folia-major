"use strict";

// shared/themeSanitizer.cjs
// Runtime theme sanitizer shared by web, API handlers, workers, and Electron.

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const FALLBACK_LIGHT_THEME = {
  name: 'AI Light',
  backgroundColor: '#ffffff',
  primaryColor: '#111827',
  accentColor: '#2563eb',
  secondaryColor: '#475569',
  fontStyle: 'sans',
  animationIntensity: 'normal',
  wordColors: [],
  lyricsIcons: [],
  provider: 'AI',
};

const FALLBACK_DARK_THEME = {
  name: 'AI Dark',
  backgroundColor: '#0f172a',
  primaryColor: '#f8fafc',
  accentColor: '#7dd3fc',
  secondaryColor: '#cbd5e1',
  fontStyle: 'sans',
  animationIntensity: 'normal',
  wordColors: [],
  lyricsIcons: [],
  provider: 'AI',
};

const FALLBACK_AI_DUAL_THEME = {
  light: FALLBACK_LIGHT_THEME,
  dark: FALLBACK_DARK_THEME,
};

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeHexColorCandidate = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    return null;
  }

  const hex = trimmed.slice(1).toLowerCase();
  if (hex.length === 3) {
    return `#${hex.split('').map((char) => `${char}${char}`).join('')}`;
  }

  return `#${hex}`;
};

const normalizeThemeHexColor = (value, fallback, hardFallback = '#ffffff') => (
  normalizeHexColorCandidate(value)
  ?? normalizeHexColorCandidate(fallback)
  ?? hardFallback
);

const normalizeFontStyle = (value, fallback) => (
  value === 'serif' || value === 'mono' || value === 'sans' ? value : fallback
);

const normalizeAnimationIntensity = (value, fallback) => (
  value === 'calm' || value === 'chaotic' || value === 'normal' ? value : fallback
);

const normalizeWordColors = (value, fallbackColor) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    const word = typeof entry.word === 'string' ? entry.word.trim() : '';
    if (!word) {
      return [];
    }

    const color = normalizeThemeHexColor(entry.color, fallbackColor);

    return [{ word, color }];
  });
};

const normalizeLyricsIcons = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((icon) => typeof icon === 'string')
    .map((icon) => icon.trim())
    .filter(Boolean)
    .slice(0, 12);
};

const sanitizeTheme = (value, fallbackTheme) => {
  const source = isRecord(value) ? value : {};
  const accentColor = normalizeThemeHexColor(source.accentColor, fallbackTheme.accentColor);

  return {
    ...fallbackTheme,
    name: typeof source.name === 'string' && source.name.trim()
      ? source.name.trim()
      : fallbackTheme.name,
    description: typeof source.description === 'string'
      ? source.description.trim()
      : fallbackTheme.description,
    backgroundColor: normalizeThemeHexColor(source.backgroundColor, fallbackTheme.backgroundColor),
    primaryColor: normalizeThemeHexColor(source.primaryColor, fallbackTheme.primaryColor),
    accentColor,
    secondaryColor: normalizeThemeHexColor(source.secondaryColor, fallbackTheme.secondaryColor),
    fontStyle: normalizeFontStyle(source.fontStyle, fallbackTheme.fontStyle),
    animationIntensity: normalizeAnimationIntensity(source.animationIntensity, fallbackTheme.animationIntensity),
    wordColors: normalizeWordColors(source.wordColors, accentColor),
    lyricsIcons: normalizeLyricsIcons(source.lyricsIcons),
    provider: typeof source.provider === 'string' && source.provider.trim()
      ? source.provider.trim()
      : fallbackTheme.provider,
  };
};

const sanitizeDualTheme = (value, fallbackTheme = FALLBACK_AI_DUAL_THEME) => {
  const source = isRecord(value) ? value : {};
  return {
    light: sanitizeTheme(source.light, fallbackTheme.light),
    dark: sanitizeTheme(source.dark, fallbackTheme.dark),
  };
};

module.exports = {
  FALLBACK_AI_DUAL_THEME,
  normalizeThemeHexColor,
  sanitizeDualTheme,
  sanitizeTheme,
};
