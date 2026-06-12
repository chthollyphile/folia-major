import React from 'react';
import { AlertCircle, Check, KeyRound, Loader2, Trash2, Wand2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { clearMobileAiApiKey, getMobileAiConfig, getMobileAiPublicConfig, saveMobileAiApiKey, saveMobileAiPublicConfig } from '../../../services/mobileAiConfig';
import { generateOpenAICompatibleTheme } from '../../../services/openaiCompatibleTheme';
import type { Theme } from '../../../types';

// src/components/modal/settings/MobileAiSettingsSubview.tsx
// Mobile-only OpenAI-compatible AI settings with secure API key storage.

type TestStatus = 'idle' | 'testing' | 'success' | 'failed';

type MobileAiSettingsSubviewProps = {
    settingsCardClass: string;
    successTextColor: string;
    errorTextColor: string;
    theme?: Theme;
};

const MobileAiSettingsSubview: React.FC<MobileAiSettingsSubviewProps> = ({
    settingsCardClass,
    successTextColor,
    errorTextColor,
    theme,
}) => {
    const { t } = useTranslation();
    const [apiUrl, setApiUrl] = React.useState('');
    const [model, setModel] = React.useState('');
    const [apiKey, setApiKey] = React.useState('');
    const [hasStoredApiKey, setHasStoredApiKey] = React.useState(false);
    const [saveStatus, setSaveStatus] = React.useState<'idle' | 'saving' | 'saved'>('idle');
    const [testStatus, setTestStatus] = React.useState<TestStatus>('idle');
    const [testMessage, setTestMessage] = React.useState('');

    React.useEffect(() => {
        let mounted = true;

        void getMobileAiPublicConfig().then((config) => {
            if (!mounted) {
                return;
            }
            setApiUrl(config.apiUrl);
            setModel(config.model);
            setHasStoredApiKey(config.hasApiKey);
        });

        return () => {
            mounted = false;
        };
    }, []);

    const handleSave = async () => {
        setSaveStatus('saving');
        await saveMobileAiPublicConfig({ apiUrl, model });
        if (apiKey.trim()) {
            await saveMobileAiApiKey(apiKey);
            setHasStoredApiKey(true);
            setApiKey('');
        }
        setSaveStatus('saved');
        window.setTimeout(() => setSaveStatus('idle'), 1400);
    };

    const handleClearApiKey = async () => {
        await clearMobileAiApiKey();
        setApiKey('');
        setHasStoredApiKey(false);
        setTestStatus('idle');
        setTestMessage('');
    };

    const handleTestConnection = async () => {
        const trimmedApiUrl = apiUrl.trim();
        const trimmedModel = model.trim();
        const trimmedApiKey = apiKey.trim();

        if (!trimmedApiUrl || !trimmedModel || (!trimmedApiKey && !hasStoredApiKey)) {
            setTestStatus('failed');
            setTestMessage(t('options.mobileAiMissingConfig') || 'Fill API URL, model, and API key first.');
            return;
        }

        setTestStatus('testing');
        setTestMessage('');

        try {
            if (trimmedApiKey) {
                await saveMobileAiApiKey(trimmedApiKey);
                setHasStoredApiKey(true);
                setApiKey('');
            }
            await saveMobileAiPublicConfig({ apiUrl: trimmedApiUrl, model: trimmedModel });

            const config = await getMobileAiConfig();
            await generateOpenAICompatibleTheme({
                apiKey: config.apiKey,
                apiUrl: config.apiUrl,
                model: config.model,
                lyricsText: 'moonlight over a quiet city',
                isPureMusic: false,
            });

            setTestStatus('success');
            setTestMessage(t('options.mobileAiConnectionSuccess') || 'Connection works.');
        } catch (error) {
            setTestStatus('failed');
            setTestMessage(error instanceof Error ? error.message : String(error));
        }
    };

    const canTest = Boolean(apiUrl.trim() && model.trim() && (apiKey.trim() || hasStoredApiKey));

    return (
        <div className="space-y-5">
            <section>
                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <Wand2 size={14} /> {t('options.mobileAiSettings') || 'Mobile AI'}
                </h3>
                <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                    <div className="space-y-2">
                        <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('options.openaiApiUrl') || 'OpenAI API URL'}
                        </label>
                        <input
                            type="url"
                            value={apiUrl}
                            onChange={(event) => setApiUrl(event.target.value)}
                            placeholder="https://api.openai.com/v1"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-white/30 transition-colors"
                            style={{ color: 'var(--text-primary)' }}
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('options.openaiApiModel') || 'OpenAI Model'}
                        </label>
                        <input
                            type="text"
                            value={model}
                            onChange={(event) => setModel(event.target.value)}
                            placeholder="gpt-4o"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-white/30 transition-colors"
                            style={{ color: 'var(--text-primary)' }}
                        />
                        <p className="text-[11px] opacity-50" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.mobileAiGeminiCompatDesc') || 'Gemini can be used here through its OpenAI-compatible endpoint.'}
                        </p>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                            <KeyRound size={14} />
                            {t('options.openaiApiKey') || 'OpenAI API Key'}
                            {hasStoredApiKey && (
                                <span className={`text-xs font-normal ${successTextColor}`}>
                                    {t('options.mobileAiKeyStored') || 'Stored'}
                                </span>
                            )}
                        </label>
                        <input
                            type="password"
                            value={apiKey}
                            onChange={(event) => setApiKey(event.target.value)}
                            placeholder={hasStoredApiKey ? '••••••••' : 'sk-...'}
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-white/30 transition-colors"
                            style={{ color: 'var(--text-primary)' }}
                        />
                    </div>

                    {testMessage && (
                        <div className={`text-xs flex items-start gap-2 ${testStatus === 'failed' ? errorTextColor : successTextColor}`}>
                            {testStatus === 'failed' ? <AlertCircle size={14} className="shrink-0 mt-0.5" /> : <Check size={14} className="shrink-0 mt-0.5" />}
                            <span className="break-words">{testMessage}</span>
                        </div>
                    )}

                    <div className="flex flex-wrap gap-2 pt-1">
                        <button
                            type="button"
                            onClick={() => void handleSave()}
                            disabled={saveStatus === 'saving'}
                            className="px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 bg-white/10 hover:bg-white/15 disabled:opacity-40"
                            style={{ color: 'var(--text-primary)' }}
                        >
                            {saveStatus === 'saving' ? <Loader2 size={16} className="animate-spin" /> : saveStatus === 'saved' ? <Check size={16} className={successTextColor} /> : null}
                            {saveStatus === 'saved' ? (t('options.saved') || 'Saved') : (t('options.save') || 'Save')}
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleTestConnection()}
                            disabled={testStatus === 'testing' || !canTest}
                            className="px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 bg-white/10 hover:bg-white/15 disabled:opacity-40"
                            style={{ color: testStatus === 'success' ? theme?.accentColor || 'var(--text-primary)' : 'var(--text-primary)' }}
                        >
                            {testStatus === 'testing' ? <Loader2 size={16} className="animate-spin" /> : testStatus === 'success' ? <Check size={16} /> : <Wand2 size={16} />}
                            {t('options.testConnection') || 'Test Connection'}
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleClearApiKey()}
                            disabled={!hasStoredApiKey && !apiKey}
                            className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40 ${errorTextColor}`}
                        >
                            <Trash2 size={16} />
                            {t('options.mobileAiClearKey') || 'Clear Key'}
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default MobileAiSettingsSubview;
