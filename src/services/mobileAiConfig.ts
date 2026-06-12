import { Preferences } from '@capacitor/preferences';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

// src/services/mobileAiConfig.ts
// Mobile AI configuration keeps the API key outside regular exported settings.

const MOBILE_AI_API_URL_KEY = 'mobile_ai_openai_api_url';
const MOBILE_AI_MODEL_KEY = 'mobile_ai_openai_model';
const MOBILE_AI_API_KEY = 'mobile_ai_openai_api_key';

export type MobileAiConfig = {
    apiUrl: string;
    model: string;
    apiKey: string;
};

export type MobileAiPublicConfig = Omit<MobileAiConfig, 'apiKey'> & {
    hasApiKey: boolean;
};

export const getMobileAiPublicConfig = async (): Promise<MobileAiPublicConfig> => {
    const [apiUrlResult, modelResult, apiKey] = await Promise.all([
        Preferences.get({ key: MOBILE_AI_API_URL_KEY }),
        Preferences.get({ key: MOBILE_AI_MODEL_KEY }),
        getMobileAiApiKey(),
    ]);

    return {
        apiUrl: apiUrlResult.value ?? '',
        model: modelResult.value ?? '',
        hasApiKey: Boolean(apiKey),
    };
};

export const getMobileAiApiKey = async () => {
    try {
        const result = await SecureStoragePlugin.get({ key: MOBILE_AI_API_KEY });
        return result.value ?? '';
    } catch {
        return '';
    }
};

export const getMobileAiConfig = async (): Promise<MobileAiConfig> => {
    const publicConfig = await getMobileAiPublicConfig();
    const apiKey = await getMobileAiApiKey();

    return {
        apiUrl: publicConfig.apiUrl.trim(),
        model: publicConfig.model.trim(),
        apiKey: apiKey.trim(),
    };
};

export const saveMobileAiPublicConfig = async (config: Pick<MobileAiConfig, 'apiUrl' | 'model'>) => {
    await Promise.all([
        Preferences.set({ key: MOBILE_AI_API_URL_KEY, value: config.apiUrl.trim() }),
        Preferences.set({ key: MOBILE_AI_MODEL_KEY, value: config.model.trim() }),
    ]);
};

export const saveMobileAiApiKey = async (apiKey: string) => {
    const trimmedApiKey = apiKey.trim();
    if (!trimmedApiKey) {
        await clearMobileAiApiKey();
        return;
    }

    await SecureStoragePlugin.set({ key: MOBILE_AI_API_KEY, value: trimmedApiKey });
};

export const clearMobileAiApiKey = async () => {
    try {
        await SecureStoragePlugin.remove({ key: MOBILE_AI_API_KEY });
    } catch {
        // Missing secure-storage entries are treated as already cleared.
    }
};

export const validateMobileAiConfig = (config: MobileAiConfig) => {
    if (!config.apiUrl) {
        throw new Error('Mobile OpenAI compatible API URL is not configured.');
    }
    if (!config.model) {
        throw new Error('Mobile OpenAI compatible model is not configured.');
    }
    if (!config.apiKey) {
        throw new Error('Mobile OpenAI compatible API key is not configured.');
    }
};
