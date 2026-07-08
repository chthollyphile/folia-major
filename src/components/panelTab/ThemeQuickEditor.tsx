import React, { useEffect, useMemo, useState, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Moon, Palette, RotateCcw, Sun, X, Copy, ArrowLeft, Download } from 'lucide-react';
import { HexColorPicker } from 'react-colorful';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { DualTheme, SongResult } from '../../types';
import type { ThemeCacheSongKey } from '../../services/themeCache';
import { FALLBACK_AI_DUAL_THEME, normalizeThemeHexColor, sanitizeDualTheme } from '../../services/themeSanitizer';
import { extractColors } from '../../utils/colorExtractor';
import { THEME_GENERATION_PROMPT_PREFIX, buildThemeSourcePrompt, parseAiThemeJsonInput } from '../../utils/aiThemePrompts';
import { useThemeQuickEditorStore, type ThemeQuickEditorKind } from '../../stores/useThemeQuickEditorStore';

// src/components/panelTab/ThemeQuickEditor.tsx
// Lightweight theme color editor launched from the player controls tab.

type EditableColorKey = 'backgroundColor' | 'primaryColor' | 'accentColor' | 'secondaryColor';
type EditableMode = 'light' | 'dark';

type ColorField = {
    key: EditableColorKey;
    labelKey: string;
    fallbackLabel: string;
};

const COLOR_FIELDS: ColorField[] = [
    { key: 'backgroundColor', labelKey: 'options.aiThemeQuickEditBackground', fallbackLabel: 'Background' },
    { key: 'primaryColor', labelKey: 'options.aiThemeQuickEditPrimary', fallbackLabel: 'Primary' },
    { key: 'accentColor', labelKey: 'options.aiThemeQuickEditAccent', fallbackLabel: 'Accent' },
    { key: 'secondaryColor', labelKey: 'options.aiThemeQuickEditSecondary', fallbackLabel: 'Secondary' },
];

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const normalizeColor = (color: string, fallback = '#ffffff') => normalizeThemeHexColor(color, fallback);

const normalizePaletteColor = (color: string) => {
    const trimmed = color.trim();
    if (!HEX_COLOR_PATTERN.test(trimmed)) {
        return null;
    }
    const hex = trimmed.slice(1).toLowerCase();
    return hex.length === 3
        ? `#${hex.split('').map(char => `${char}${char}`).join('')}`
        : `#${hex}`;
};

const collectThemeColors = (theme: DualTheme) => ([
    theme.light.backgroundColor,
    theme.light.primaryColor,
    theme.light.accentColor,
    theme.light.secondaryColor,
    theme.dark.backgroundColor,
    theme.dark.primaryColor,
    theme.dark.accentColor,
    theme.dark.secondaryColor,
]);

const buildRecommendedColors = (theme: DualTheme, coverColors: string[]) => {
    const seen = new Set<string>();
    return [...coverColors, ...collectThemeColors(theme)].flatMap(color => {
        const normalized = normalizePaletteColor(color);
        if (!normalized || seen.has(normalized)) {
            return [];
        }
        seen.add(normalized);
        return [normalized];
    }).slice(0, 12);
};

// --- FastColorPicker 隔离子组件 ---
// 作用：将 react-colorful 的 60fps 拖拽渲染限制在本地组件内部，防止它导致整个 ThemeQuickEditor 跟着 60fps 重新渲染。
const FastColorPicker = ({ color, onChange, onPointerDown }: { color: string, onChange: (c: string) => void, onPointerDown: () => void; }) => {
    const [localColor, setLocalColor] = useState(color);

    // 当外部色值由于切换 mode 或 key 发生变化时，同步到内部
    useEffect(() => {
        setLocalColor(color);
    }, [color]);

    const handleChange = (newColor: string) => {
        setLocalColor(newColor); // 60fps 本地拇指移动
        onChange(newColor);      // 将新值外传供节流使用
    };

    return (
        <div onPointerDown={onPointerDown} className="w-full h-full">
            <HexColorPicker color={localColor} onChange={handleChange} style={{ width: '100%', height: 236 }} />
        </div>
    );
};

type ThemeQuickEditorProps = {
    kind: ThemeQuickEditorKind;
    initialTheme: DualTheme;
    coverUrl: string | null;
    isDaylight: boolean;
    promptSourceText: string | null;
    isPureMusic: boolean;
    songTitle: string | undefined;
    onClose: () => void;
    onSave: (theme: DualTheme) => void;
};

const ThemeQuickEditor: React.FC<ThemeQuickEditorProps> = ({
    kind,
    initialTheme,
    coverUrl,
    isDaylight,
    promptSourceText,
    isPureMusic,
    songTitle,
    onClose,
    onSave,
}) => {
    const { t } = useTranslation();
    const normalizedInitialTheme = useMemo(() => sanitizeDualTheme(initialTheme), [initialTheme]);
    const [draftTheme, setDraftTheme] = useState<DualTheme>(() => normalizedInitialTheme);
    const [mode, setMode] = useState<EditableMode>(() => (isDaylight ? 'light' : 'dark'));
    const [activeKey, setActiveKey] = useState<EditableColorKey>('accentColor');
    const [coverColors, setCoverColors] = useState<string[]>([]);
    const [themeNames, setThemeNames] = useState(() => ({
        light: normalizedInitialTheme.light.name || '',
        dark: normalizedInitialTheme.dark.name || '',
    }));
    const [isDragging, setIsDragging] = useState(false);
    const [isImportPanelOpen, setIsImportPanelOpen] = useState(false);
    const [importJsonText, setImportJsonText] = useState('');
    const [importError, setImportError] = useState<string | null>(null);
    const [isCopied, setIsCopied] = useState(false);
    const isMouseDownOnOverlayRef = useRef(false);

    useEffect(() => {
        const handlePointerUp = () => setIsDragging(false);
        window.addEventListener('pointerup', handlePointerUp);
        return () => window.removeEventListener('pointerup', handlePointerUp);
    }, []);

    const handleOverlayMouseDown = (event: React.MouseEvent) => {
        isMouseDownOnOverlayRef.current = event.target === event.currentTarget;
    };

    const handleOverlayClick = (event: React.MouseEvent) => {
        if (event.target === event.currentTarget && isMouseDownOnOverlayRef.current) {
            onClose();
        }
    };

    useEffect(() => {
        setDraftTheme(normalizedInitialTheme);
        setThemeNames({
            light: normalizedInitialTheme.light.name || '',
            dark: normalizedInitialTheme.dark.name || '',
        });
        setMode(isDaylight ? 'light' : 'dark');
        setActiveKey('accentColor');
    }, [isDaylight, normalizedInitialTheme]);

    useEffect(() => {
        let cancelled = false;
        if (!coverUrl) {
            setCoverColors([]);
            return undefined;
        }

        extractColors(coverUrl, 8)
            .then(colors => {
                if (!cancelled) {
                    setCoverColors(colors);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setCoverColors([]);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [coverUrl]);

    // 组件内调色板产生的必定是合法 Hex，直接跳过 sanitizeDualTheme 以节约性能
    const activeTheme = draftTheme[mode];
    const activeColor = activeTheme[activeKey];
    const recommendedColors = useMemo(
        () => buildRecommendedColors(normalizedInitialTheme, coverColors),
        [coverColors, normalizedInitialTheme],
    );

    const throttleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const latestColorRef = useRef<string>(activeColor);

    const updateColorThrottled = (color: string) => {
        latestColorRef.current = color;
        if (!throttleTimeoutRef.current) {
            throttleTimeoutRef.current = setTimeout(() => {
                throttleTimeoutRef.current = null;
                setDraftTheme(previous => ({
                    ...previous,
                    [mode]: {
                        ...previous[mode],
                        [activeKey]: latestColorRef.current,
                    },
                }));
            }, 33); // ~30fps 刷新率
        }
    };

    // 当用户直接点击推荐颜色等需要立即响应时，清除节流并直接更新
    const updateColorInstant = (color: string) => {
        if (throttleTimeoutRef.current) {
            clearTimeout(throttleTimeoutRef.current);
            throttleTimeoutRef.current = null;
        }
        setDraftTheme(previous => ({
            ...previous,
            [mode]: {
                ...previous[mode],
                [activeKey]: color,
            },
        }));
    };

    const handleSave = () => {
        const finalLightName = themeNames.light.trim();
        const finalDarkName = themeNames.dark.trim();
        if (!finalLightName || !finalDarkName) return;

        const updatedDraft = {
            ...draftTheme,
            light: { ...draftTheme.light, name: finalLightName },
            dark: { ...draftTheme.dark, name: finalDarkName },
        };
        onSave(sanitizeDualTheme(updatedDraft, normalizedInitialTheme));
    };

    const handleCopyPrompt = async () => {
        try {
            const finalPrompt = THEME_GENERATION_PROMPT_PREFIX + '\n\n' + buildThemeSourcePrompt(promptSourceText || '', isPureMusic, songTitle);
            await navigator.clipboard.writeText(finalPrompt);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        } catch (error) {
            console.error('Failed to copy prompt:', error);
        }
    };

    const handleImportApply = () => {
        setImportError(null);
        if (!importJsonText.trim()) return;
        try {
            const parsed = parseAiThemeJsonInput(importJsonText);
            const importedTheme = sanitizeDualTheme(parsed as DualTheme, normalizedInitialTheme);
            onSave(importedTheme);
            setIsImportPanelOpen(false);
            setImportJsonText('');
        } catch (error) {
            setImportError(t('options.invalidJsonFormat') || 'Invalid JSON format');
        }
    };

    const handleReset = () => {
        setDraftTheme(normalizedInitialTheme);
        setThemeNames({
            light: normalizedInitialTheme.light.name || '',
            dark: normalizedInitialTheme.dark.name || '',
        });
    };

    const isThemeNameValid = (name: string) => name.trim().length > 0 && name.trim().length <= 32;
    const isNameValid = isThemeNameValid(themeNames.light) && isThemeNameValid(themeNames.dark);

    // Use activeTheme for real-time preview of the edited dual theme
    const panelBg = activeTheme.backgroundColor;
    const textColor = activeTheme.primaryColor;
    const mutedTextColor = activeTheme.secondaryColor;
    const accentColor = activeTheme.accentColor;

    // Use hex alpha for backgrounds and borders based on primary text color for contrast
    const softBg = `${textColor}12`; // ~7% opacity
    const hoverBg = `${textColor}1a`; // ~10% opacity
    const borderColor = `${textColor}26`; // ~15% opacity
    const overlayBg = mode === 'light' ? 'rgba(24,24,27,0.35)' : 'rgba(0,0,0,0.65)';

    const themeTransitionClass = isDragging ? '' : 'transition-colors duration-500';
    const allTransitionClass = isDragging ? '' : 'transition-all duration-300';
    const title = kind === 'custom'
        ? (t('options.customThemeQuickEditTitle') || 'Quick Edit Custom Theme')
        : (t('options.aiThemeQuickEditTitle') || 'Quick Edit AI Theme');
    const description = kind === 'custom'
        ? (t('options.customThemeQuickEditDesc') || 'Tune your custom theme colors.')
        : (t('options.aiThemeQuickEditDesc') || 'Tune the current song AI theme colors.');
    const saveLabel = kind === 'custom'
        ? (t('options.customThemeQuickEditSave') || 'Save Custom Theme')
        : (t('options.aiThemeQuickEditSave') || 'Save AI Theme');

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            // 添加 transform-gpu 强制硬件加速隔离模糊计算
            className={`fixed inset-0 z-[142] flex items-center justify-center p-4 backdrop-blur-sm transform-gpu ${themeTransitionClass}`}
            style={{ backgroundColor: overlayBg, willChange: 'opacity' }}
            onMouseDown={handleOverlayMouseDown}
            onClick={handleOverlayClick}
        >
            <motion.div
                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.985 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                // 添加 transform-gpu 隔离阴影重绘
                className={`relative w-full max-w-[36rem] overflow-hidden rounded-[1.5rem] border shadow-[0_24px_80px_rgba(0,0,0,0.4)] transform-gpu ${themeTransitionClass}`}
                style={{ backgroundColor: panelBg, borderColor, color: textColor, willChange: 'transform' }}
                onClick={(event) => event.stopPropagation()}
            >
                {/* Background glow effects for real-time preview */}
                <div
                    className={`absolute -top-32 -right-32 h-64 w-64 rounded-full blur-[90px] opacity-40 pointer-events-none transform-gpu ${themeTransitionClass}`}
                    style={{ backgroundColor: accentColor, willChange: 'background-color' }}
                />
                <div
                    className={`absolute -bottom-32 -left-32 h-64 w-64 rounded-full blur-[90px] opacity-30 pointer-events-none transform-gpu ${themeTransitionClass}`}
                    style={{ backgroundColor: mutedTextColor, willChange: 'background-color' }}
                />

                <div className="relative z-10 transform-gpu">
                    <div className={`flex items-center justify-between gap-3 border-b px-5 py-4 ${themeTransitionClass}`} style={{ borderColor }}>
                        <div className="flex min-w-0 items-center gap-4">
                            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${themeTransitionClass}`} style={{ backgroundColor: softBg, color: accentColor }}>
                                <Palette size={18} />
                            </div>
                            <div className="min-w-0">
                                <div className="truncate text-sm font-bold tracking-tight">
                                    {title}
                                </div>
                                <div className={`mt-0.5 truncate text-xs ${themeTransitionClass}`} style={{ color: mutedTextColor }}>
                                    {description}
                                </div>
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                            <button
                                type="button"
                                onClick={handleReset}
                                className="flex h-9 items-center justify-center gap-1.5 rounded-full px-3 text-[11px] font-bold transition-colors duration-300"
                                style={{ backgroundColor: 'transparent', color: mutedTextColor }}
                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = hoverBg; e.currentTarget.style.color = textColor; }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = mutedTextColor; }}
                                title={t('ui.resetToDefaultTheme') || 'Reset'}
                            >
                                <RotateCcw size={14} />
                                <span className="hidden sm:inline">{t('ui.resetToDefaultTheme') || 'Reset'}</span>
                            </button>
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors duration-300"
                                style={{ backgroundColor: 'transparent', color: mutedTextColor }}
                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = hoverBg; e.currentTarget.style.color = textColor; }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = mutedTextColor; }}
                                aria-label={t('ui.close') || 'Close'}
                            >
                                <X size={17} />
                            </button>
                        </div>
                    </div>

                    {isImportPanelOpen ? (
                        <div className="flex flex-col gap-6 p-6">
                            <div className="space-y-4">
                                <div className={`text-sm font-bold ${themeTransitionClass}`} style={{ color: textColor }}>
                                    {t('aiHelp.copyPromptTitle') || '1. Copy AI Prompt'}
                                </div>
                                <div className={`text-xs ${themeTransitionClass}`} style={{ color: mutedTextColor }}>
                                    {t('aiHelp.copyPromptDesc') || 'Copy the prompt and paste it into any AI model to generate your theme.'}
                                </div>
                                <button
                                    type="button"
                                    onClick={handleCopyPrompt}
                                    className={`flex w-full min-h-11 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold hover:brightness-110 active:scale-95 ${allTransitionClass}`}
                                    style={{ borderColor, backgroundColor: softBg, color: textColor }}
                                >
                                    {isCopied ? <Check size={15} className="text-green-500" /> : <Copy size={15} />}
                                    <span>{isCopied ? (t('status.copied') || 'Copied!') : (t('aiHelp.copyPrompt') || 'Copy Prompt')}</span>
                                </button>
                            </div>

                            <div className="space-y-4">
                                <div className={`text-sm font-bold ${themeTransitionClass}`} style={{ color: textColor }}>
                                    {t('aiHelp.importJsonTitle') || '2. Paste JSON Result'}
                                </div>
                                <textarea
                                    value={importJsonText}
                                    onChange={(e) => setImportJsonText(e.target.value)}
                                    placeholder={t('options.pasteJsonHere') || 'Paste JSON here...'}
                                    className={`w-full h-32 rounded-xl border bg-transparent p-3 text-xs outline-none resize-none font-mono ${allTransitionClass}`}
                                    style={{ borderColor, color: textColor }}
                                    onFocus={(e) => {
                                        e.currentTarget.style.borderColor = accentColor;
                                        e.currentTarget.style.boxShadow = `0 0 0 1px ${accentColor}`;
                                    }}
                                    onBlur={(e) => {
                                        e.currentTarget.style.borderColor = borderColor;
                                        e.currentTarget.style.boxShadow = 'none';
                                    }}
                                    spellCheck={false}
                                />
                                {importError && (
                                    <div className="text-xs text-red-500 font-bold">{importError}</div>
                                )}
                            </div>

                            <div className="flex items-center gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsImportPanelOpen(false);
                                        setImportJsonText('');
                                        setImportError(null);
                                    }}
                                    className={`flex flex-1 min-h-11 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold hover:brightness-110 active:scale-95 ${allTransitionClass}`}
                                    style={{ borderColor, backgroundColor: softBg, color: textColor }}
                                >
                                    <ArrowLeft size={15} />
                                    <span>{t('ui.cancel') || 'Cancel'}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleImportApply}
                                    disabled={!importJsonText.trim()}
                                    className={`flex flex-1 min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-bold shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed ${allTransitionClass}`}
                                    style={{ backgroundColor: accentColor, color: panelBg }}
                                >
                                    <Download size={16} strokeWidth={2.5} />
                                    <span>{t('ui.apply') || 'Apply'}</span>
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="grid gap-5 p-5 sm:grid-cols-[1fr_14rem]">
                            <div className="space-y-5">
                                {/* Mode Switcher */}
                                <div className={`flex gap-2 rounded-2xl p-1.5 ${themeTransitionClass}`} style={{ backgroundColor: softBg }}>
                                    {(['light', 'dark'] as EditableMode[]).map(nextMode => {
                                        const selected = mode === nextMode;
                                        return (
                                            <button
                                                key={nextMode}
                                                type="button"
                                                onClick={() => setMode(nextMode)}
                                                className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold ${allTransitionClass}`}
                                                style={{
                                                    backgroundColor: selected ? accentColor : 'transparent',
                                                    color: selected ? panelBg : textColor,
                                                    boxShadow: selected ? `0 4px 12px ${accentColor}40` : 'none',
                                                }}
                                            >
                                                {nextMode === 'light' ? <Sun size={15} /> : <Moon size={15} />}
                                                <span>{nextMode === 'light' ? (t('options.lightTheme') || 'Light Theme') : (t('options.darkTheme') || 'Dark Theme')}</span>
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Color Fields */}
                                <div className="grid grid-cols-2 gap-3">
                                    {COLOR_FIELDS.map(field => {
                                        const color = draftTheme[mode][field.key];
                                        const selected = activeKey === field.key;
                                        return (
                                            <button
                                                key={field.key}
                                                type="button"
                                                onClick={() => setActiveKey(field.key)}
                                                className={`min-w-0 rounded-2xl border p-3.5 text-left ${allTransitionClass}`}
                                                style={{
                                                    borderColor: selected ? accentColor : borderColor,
                                                    backgroundColor: selected ? `${accentColor}1a` : softBg,
                                                    boxShadow: selected ? `0 0 0 1px ${accentColor}` : 'none',
                                                }}
                                            >
                                                <div className="flex items-center gap-2.5">
                                                    <span className={`h-6 w-6 shrink-0 rounded-full border shadow-inner ${themeTransitionClass}`} style={{ backgroundColor: color, borderColor: `${textColor}26` }} />
                                                    <span className="min-w-0 truncate text-xs font-bold">
                                                        {t(field.labelKey) || field.fallbackLabel}
                                                    </span>
                                                </div>
                                                <div className={`mt-2.5 truncate font-mono text-[10px] uppercase tracking-wider ${themeTransitionClass}`} style={{ color: mutedTextColor }}>
                                                    {color}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Color Picker */}
                                <div
                                    className={`rounded-3xl border p-4 transform-gpu ${themeTransitionClass}`}
                                    style={{ borderColor, backgroundColor: softBg }}
                                >
                                    <FastColorPicker
                                        color={activeColor}
                                        onChange={updateColorThrottled}
                                        onPointerDown={() => setIsDragging(true)}
                                    />
                                </div>
                            </div>

                            <div className="flex min-w-0 flex-col gap-4">
                                {/* Recommended Colors */}
                                <div className={`rounded-3xl border p-4 ${themeTransitionClass}`} style={{ borderColor, backgroundColor: softBg }}>
                                    <div className={`text-xs font-bold mb-3 ${themeTransitionClass}`} style={{ color: textColor }}>
                                        {t('options.aiThemeQuickEditRecommendedColors') || 'Recommended Colors'}
                                    </div>
                                    <div className="grid grid-cols-4 gap-2.5">
                                        {recommendedColors.map(color => (
                                            <button
                                                key={color}
                                                type="button"
                                                onClick={() => updateColorInstant(color)}
                                                className="aspect-square rounded-xl border shadow-sm transition-transform hover:scale-110 active:scale-95"
                                                style={{ backgroundColor: color, borderColor: `${textColor}26` }}
                                                title={color.toUpperCase()}
                                                aria-label={color.toUpperCase()}
                                            />
                                        ))}
                                    </div>
                                </div>

                                {/* Theme Rename */}
                                <div className={`rounded-3xl border p-4 ${themeTransitionClass}`} style={{ borderColor, backgroundColor: softBg }}>
                                    <div className={`text-xs font-bold mb-3 ${themeTransitionClass}`} style={{ color: textColor }}>
                                        {t('options.themeName') || 'Theme Name'}
                                    </div>
                                    <label className="block">
                                        <span className={`mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase ${themeTransitionClass}`} style={{ color: mutedTextColor }}>
                                            {mode === 'light' ? <Sun size={12} /> : <Moon size={12} />}
                                            {mode === 'light'
                                                ? (t('options.lightTheme') || 'Light Theme')
                                                : (t('options.darkTheme') || 'Dark Theme')}
                                        </span>
                                        <input
                                            type="text"
                                            value={themeNames[mode]}
                                            maxLength={32}
                                            onChange={(e) => setThemeNames(previous => ({
                                                ...previous,
                                                [mode]: e.target.value,
                                            }))}
                                            className={`w-full rounded-xl border bg-transparent px-4 py-2.5 text-xs font-bold outline-none ${allTransitionClass}`}
                                            style={{ borderColor, color: textColor }}
                                            onFocus={(e) => {
                                                e.currentTarget.style.borderColor = accentColor;
                                                e.currentTarget.style.boxShadow = `0 0 0 1px ${accentColor}`;
                                            }}
                                            onBlur={(e) => {
                                                e.currentTarget.style.borderColor = borderColor;
                                                e.currentTarget.style.boxShadow = 'none';
                                            }}
                                            placeholder="Enter theme name..."
                                            spellCheck={false}
                                        />
                                    </label>
                                </div>

                                {/* Actions */}
                                <div className="flex flex-col gap-2 mt-auto pt-2">
                                    <button
                                        type="button"
                                        onClick={handleSave}
                                        disabled={!isNameValid}
                                        className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-bold shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed ${allTransitionClass}`}
                                        style={{
                                            backgroundColor: accentColor,
                                            color: panelBg,
                                            opacity: isNameValid ? 1 : 0.5,
                                        }}
                                    >
                                        <Check size={16} strokeWidth={2.5} />
                                        <span>{saveLabel}</span>
                                    </button>
                                    {kind === 'ai' && (
                                        <button
                                            type="button"
                                            onClick={() => setIsImportPanelOpen(true)}
                                            className={`flex min-h-9 items-center justify-center gap-1.5 rounded-xl text-[11px] font-bold hover:brightness-110 active:scale-95 ${allTransitionClass}`}
                                            style={{ backgroundColor: 'transparent', color: mutedTextColor }}
                                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = hoverBg}
                                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                        >
                                            <Download size={13} />
                                            <span>{t('options.manualImportAiTheme') || 'Manual Import'}</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </motion.div>
        </motion.div>
    );
};

type ThemeQuickEditorHostProps = {
    onSaveAiTheme: (theme: DualTheme, song: SongResult | null, songKey: ThemeCacheSongKey | null) => void;
    onSaveCustomTheme: (theme: DualTheme) => void;
};

const ThemeQuickEditorHost: React.FC<ThemeQuickEditorHostProps> = ({ onSaveAiTheme, onSaveCustomTheme }) => {
    const { isOpen, editorKind, aiTheme, customTheme, coverUrl, isDaylight, song, songKey, closeEditor, promptSourceText, isPureMusic, songTitle } = useThemeQuickEditorStore(useShallow(state => ({
        isOpen: state.isOpen,
        editorKind: state.editorKind,
        aiTheme: state.aiTheme,
        customTheme: state.customTheme,
        coverUrl: state.coverUrl,
        isDaylight: state.isDaylight,
        song: state.song,
        songKey: state.songKey,
        promptSourceText: state.promptSourceText,
        isPureMusic: state.isPureMusic,
        songTitle: state.songTitle,
        closeEditor: state.closeEditor,
    })));
    const initialTheme = editorKind === 'custom' ? customTheme : (aiTheme ?? FALLBACK_AI_DUAL_THEME);

    return (
        <AnimatePresence>
            {isOpen && editorKind && initialTheme && (
                <ThemeQuickEditor
                    kind={editorKind}
                    initialTheme={initialTheme}
                    coverUrl={coverUrl}
                    isDaylight={isDaylight}
                    promptSourceText={promptSourceText}
                    isPureMusic={isPureMusic}
                    songTitle={songTitle}
                    onClose={closeEditor}
                    onSave={(theme) => {
                        if (editorKind === 'custom') {
                            onSaveCustomTheme(theme);
                        } else {
                            onSaveAiTheme(theme, song, songKey);
                        }
                        closeEditor();
                    }}
                />
            )}
        </AnimatePresence>
    );
};

export default ThemeQuickEditorHost;
