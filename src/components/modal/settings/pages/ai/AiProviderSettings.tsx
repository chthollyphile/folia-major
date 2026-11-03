import React from 'react';
import { Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AI_PROVIDER_PRESETS, inferAiProviderFromUrl, modelAlwaysThinks, resolveAiConnection, resolveAiProviderPreset, retiredModelHint } from '../../../../../services/aiText';
import { openAIEndpointOf } from '../../../../../utils/openAIEndpoint';
import { Button, FoldedGroup, NumberField, Reveal, Row, Select, TextField, Toggle, Value, option, parseNumberText, type SettingsGroupDef, type SettingsOptionDef } from '../../kit';
import { AiConnectionTestReply, AiConnectionTestStatus, useAiConnectionTest } from '../AiConnectionTest';
import { useSettingsPage, type AiApiKeyName, type ElectronSettingsState } from '../settingsPageContext';
import { AiModelPicker } from './AiModelPicker';

// AI connection settings, separated from appearance layout; requests stay behind services/aiText.
const AI: SettingsGroupDef = { id: 'electronSettings', titleKey: 'options.electronSettings', electronOnly: true };
const O = {
    provider: option(AI, 'aiProvider', 'options.aiProvider'),
    endpoint: option(AI, 'aiEndpoint', 'options.aiEndpoint'),
    geminiKey: option(AI, 'geminiApiKey', 'options.geminiApiKey'),
    key: option(AI, 'openaiApiKey', 'options.aiApiKey'),
    url: option(AI, 'openaiApiUrl', 'options.aiApiUrl'),
    model: option(AI, 'openaiApiModel', 'options.aiModel'),
    geminiModel: option(AI, 'geminiApiModel', 'options.aiModel'),
    temperature: option(AI, 'openaiApiTemperature', 'options.openaiApiTemperature'),
    stream: option(AI, 'openaiApiStream', 'options.openaiApiStream'),
    proxy: option(AI, 'useSystemProxyAI', 'options.useSystemProxyAI'),
};
export const AI_SETTINGS_OPTIONS: SettingsOptionDef[] = Object.values(O);

/** Host name of an address, lower case; empty when it is not a URL. */
const hostOf = (url: string) => {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return '';
    }
};

/**
 * Where an address sends its requests, for telling whether it is one of a provider's sites: origin
 * and path as the main process completes them (no trailing slash, `/chat/completions` or
 * `/messages` left off, an empty path read as `/v1`), so a host with and without `/v1` is the same
 * site, and a Coding Plan path on a site's host is not.
 */
const requestAddressOf = (url: string) => {
    try {
        const parsed = new URL(url.trim());
        const path = parsed.pathname.replace(/\/+$/, '').replace(/\/(?:chat\/completions|messages)$/, '');
        return `${parsed.protocol}//${parsed.host.toLowerCase()}${path || '/v1'}`;
    } catch {
        return '';
    }
};

/** Saved keys remain in the main process; this field contains only a typed replacement. */
const AiKeyField: React.FC<{ value: string; saved: boolean; onChange: (key: string) => void; onClear: () => void }> = ({ value, saved, onChange, onClear }) => {
    const { t } = useTranslation();
    return (
        <span className="flex min-w-0 items-center gap-2">
            <TextField type="password" value={value} onChange={onChange} placeholder={saved ? t('options.aiApiKeySavedPlaceholder') : ''} />
            {saved && <Button onClick={onClear}>{t('options.aiApiKeyClear')}</Button>}
        </span>
    );
};

const AiProviderSettings: React.FC = () => {
    const { t } = useTranslation();
    const { electronSettings: settings, setElectronSettings, onSaveElectronSettings, electronSaveStatus, savedAiApiKeys, savedOpenAIKeyEndpoint, onClearAiApiKey } = useSettingsPage().viewProps.desktop.model;
    const preset = resolveAiProviderPreset(settings);
    const gemini = preset.protocol === 'gemini';
    const keyName: AiApiKeyName = gemini ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY';
    const key = settings[keyName] || '';
    // The stored address decides the provider and the site (a built-in preset is only shown while
    // the address is one of its hosts); nothing stored is the preset's default site.
    const storedUrl = settings.OPENAI_API_URL || '';
    const apiUrl = preset.id === 'custom' ? storedUrl : storedUrl.trim() || preset.baseUrl;
    // What the requests would use: the adapter the address's host picks, and the model with its default.
    const resolved = resolveAiConnection({ ...settings, OPENAI_API_URL: gemini ? storedUrl : apiUrl });
    const adapter = AI_PROVIDER_PRESETS.find(value => value.id === resolved.adapterId) ?? preset;
    const mismatchedEndpoint = !gemini && savedOpenAIKeyEndpoint && savedOpenAIKeyEndpoint !== openAIEndpointOf(apiUrl)
        ? savedOpenAIKeyEndpoint : null;
    const usableSavedKey = savedAiApiKeys[keyName] && !mismatchedEndpoint;
    const setAi = (patch: Partial<ElectronSettingsState>) => setElectronSettings(previous => ({ ...previous, ...patch }));
    // Blank stands for the provider's default, Gemini's too: it is what is saved, so a later change of
    // default reaches settings that never picked a model.
    const model = (gemini ? settings.GEMINI_API_MODEL : settings.OPENAI_API_MODEL) || '';
    // A blank model is fine where the provider has a default one (old settings rely on it).
    const connectionReady = Boolean(resolved.model) && (preset.id !== 'custom' || Boolean(apiUrl.trim()));
    const payload: AiConnectionTestPayload = {
        provider: gemini ? 'gemini' : 'openai',
        presetId: preset.id,
        apiKey: key,
        apiUrl: gemini ? undefined : apiUrl,
        model,
        stream: adapter.stream && settings.OPENAI_API_STREAM,
        useSystemProxy: settings.USE_SYSTEM_PROXY_FOR_AI,
    };
    const connection = useAiConnectionTest(payload, usableSavedKey);
    const selectProvider = (id: string) => {
        const next = AI_PROVIDER_PRESETS.find(value => value.id === id);
        if (!next || next.id === preset.id) return;
        setAi({
            AI_PROVIDER_PRESET: id,
            AI_PROVIDER: next.protocol === 'gemini' ? 'gemini' : 'openai',
            GEMINI_API_KEY: '',
            OPENAI_API_KEY: '',
            // Prefilled with the provider's recommended model, so a typed key can be tested right away.
            // Custom keeps the address in use, so an address the presets do not list can be edited
            // there rather than typed again.
            ...(next.protocol !== 'gemini' ? {
                OPENAI_API_URL: next.id === 'custom' && !gemini ? storedUrl : next.baseUrl,
                OPENAI_API_MODEL: next.recommendedModel ?? '',
            } : {}),
        });
    };
    // A key saved for another listed provider is named by that provider; one saved for another site
    // of this provider, or for a custom address, by the address.
    const previousProvider = mismatchedEndpoint ? AI_PROVIDER_PRESETS.find(value => value.id === inferAiProviderFromUrl(mismatchedEndpoint)) : undefined;
    const keyHint = mismatchedEndpoint && !key.trim()
        ? previousProvider && previousProvider.id !== 'custom' && previousProvider.id !== adapter.id
            ? t('options.aiApiKeyOtherProviderDesc', { provider: previousProvider.label })
            : t('options.aiApiKeyEndpointMismatchDesc', { endpoint: mismatchedEndpoint })
        : usableSavedKey ? t('options.aiApiKeySavedDesc') : undefined;

    // Sites: the one the address sends to. An address on none of them (a workspace domain, a Coding
    // Plan path, a site we do not list) is shown by its host in the picker, and in full under it,
    // until another site is picked.
    const sites = gemini || preset.id === 'custom' ? [] : preset.endpoints;
    const siteHost = hostOf(apiUrl);
    const site = sites.find(endpoint => requestAddressOf(endpoint.baseUrl) === requestAddressOf(apiUrl));
    const unlistedAddress = sites.length > 0 && !site;
    const siteOptions = [
        ...(site ? [] : [{ value: '', label: siteHost || apiUrl }]),
        ...sites.map(endpoint => ({ value: endpoint.id, label: t('options.aiEndpoint_' + endpoint.id) })),
    ];

    const retired = retiredModelHint(resolved.adapterId, resolved.model);
    const alwaysThinks = modelAlwaysThinks(resolved.adapterId, resolved.model);
    const temperature = adapter.temperature;

    return (
        <FoldedGroup def={AI} summary={t('options.aiProvider_' + preset.id)}>
            <Row option={O.provider}>
                <Select value={preset.id} options={AI_PROVIDER_PRESETS.map(value => ({ value: value.id, label: t('options.aiProvider_' + value.id) }))} onChange={selectProvider} />
            </Row>
            {sites.length > 1 && (
                <Row option={O.endpoint}>
                    <Select value={site?.id ?? ''} options={siteOptions} onChange={id => {
                        const next = sites.find(endpoint => endpoint.id === id);
                        if (next) setAi({ OPENAI_API_URL: next.baseUrl });
                    }} />
                </Row>
            )}
            {unlistedAddress && (
                <Row sub option={O.url} hint={t('options.aiApiUrlUnlistedDesc')}>
                    <Value tip={apiUrl}>{apiUrl}</Value>
                </Row>
            )}
            {preset.id === 'custom' && (
                <Row option={O.url}>
                    <TextField value={settings.OPENAI_API_URL} onChange={value => setAi({ OPENAI_API_URL: value })} placeholder={preset.baseUrl} />
                </Row>
            )}
            <Row option={gemini ? O.geminiKey : O.key} hint={keyHint}>
                <AiKeyField value={key} saved={usableSavedKey} onChange={value => setAi({ [keyName]: value })} onClear={() => void onClearAiApiKey(keyName)} />
            </Row>
            <AiModelPicker option={gemini ? O.geminiModel : O.model} payload={payload} keySaved={usableSavedKey} presetId={preset.id}
                suggestedModels={preset.suggestedModels} listsModels={preset.listsModels}
                defaultModel={model ? undefined : resolved.model || undefined}
                onChange={value => setAi({ [gemini ? 'GEMINI_API_MODEL' : 'OPENAI_API_MODEL']: value })} />
            {retired && <Row notice={t('options.aiModelRetired', { model: retired.model, replacement: retired.replacement })} />}
            {alwaysThinks && <Row notice={t('options.aiModelAlwaysThinks')} />}
            {/* Shown only for providers that are sent a temperature, with their own range. */}
            <Reveal when={!gemini && Boolean(temperature)}>
                <Row option={O.temperature} hint={temperature ? t(adapter.temperaturePerModel ? 'options.aiTemperaturePerModelDesc' : 'options.aiTemperatureRangeDesc', temperature) : undefined}>
                    <NumberField value={parseNumberText(settings.OPENAI_API_TEMPERATURE)}
                        onChange={value => setAi({ OPENAI_API_TEMPERATURE: value === null ? '' : String(value) })}
                        min={temperature?.min ?? 0} max={temperature?.max ?? 2} step={0.1} placeholder="0.7" />
                </Row>
            </Reveal>
            <Reveal when={!gemini && adapter.stream}>
                <Row option={O.stream} note={t('options.openaiApiStreamDesc')}>
                    <Toggle checked={settings.OPENAI_API_STREAM} onChange={enabled => setAi({ OPENAI_API_STREAM: enabled })} />
                </Row>
            </Reveal>
            <Row option={O.proxy} hint={t('options.useSystemProxyAIDesc')}>
                <Toggle checked={settings.USE_SYSTEM_PROXY_FOR_AI} onChange={enabled => setAi({ USE_SYSTEM_PROXY_FOR_AI: enabled })} />
            </Row>
            <Row
                label={connection.result && <AiConnectionTestStatus result={connection.result} />}
                below={connection.result && <AiConnectionTestReply result={connection.result} />}
            >
                {electronSaveStatus === 'saved' && <Value>{t('options.settingsSaved')}</Value>}
                <Button icon={Zap} tip={t('options.aiTestConnectionDesc')} onClick={() => void connection.run()} disabled={connection.running || !connectionReady}>
                    {t(connection.running ? 'options.aiTestRunning' : 'options.aiTestConnection')}
                </Button>
                <Button variant="primary" onClick={() => void onSaveElectronSettings()} disabled={electronSaveStatus === 'saving' || !connectionReady}>
                    {t(electronSaveStatus === 'saving' ? 'options.settingsSaving' : 'options.save')}
                </Button>
            </Row>
        </FoldedGroup>
    );
};

export default AiProviderSettings;
