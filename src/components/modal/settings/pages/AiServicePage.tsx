import React from 'react';
import AiProviderSettings, { AI_SETTINGS_OPTIONS } from './ai/AiProviderSettings';

// src/components/modal/settings/pages/AiServicePage.tsx
// The AI 服务 page: the provider, key, model and request options every AI feature reads — song theme
// generation and any later AI feature go through services/aiText with these settings.
// They used to be the tail of 外观, which made them look like part of the theme; they are one global
// connection, so they get a page of their own.

const AiServicePage: React.FC = () => <AiProviderSettings />;

export const OPTIONS = AI_SETTINGS_OPTIONS;

export default AiServicePage;
