import type { TFunction } from 'i18next';

// src/i18n/providerName.ts
// 平台在界面上的名字。平台只声明名字的 i18n key（OnlineMusicProvider.shortNameKey），界面上由这里翻译；
// 没有声明的（mod 加进来的平台、探针里的假平台）用它自己给的名字。

type ProviderNameSource = {
    shortNameKey?: string;
    shortName?: string;
    displayName?: string;
};

export const providerDisplayName = (t: TFunction, provider: ProviderNameSource, fallback = ''): string => {
    const literal = provider.shortName || provider.displayName || fallback;
    return provider.shortNameKey ? t(provider.shortNameKey, { defaultValue: literal }) : literal;
};
