import { useEffect } from 'react';
import type { TFunction } from 'i18next';
import { omni } from '../../services/onlineMusic/omni';
import { setStatusMessage } from '../../stores/useStatusMessageStore';

// src/components/app/useProviderNotices.ts
// Starts what each online provider watches while the app is open (a local service that may fail
// to start, omni.watchProviders) and shows what a provider has to tell as the app's status message.

export function useProviderNotices(t: TFunction) {
    useEffect(() => omni.watchProviders((notice) => {
        setStatusMessage({
            type: notice.type,
            text: t(notice.textKey, notice.params),
            nonce: notice.nonce,
            durationMs: notice.durationMs,
        });
    }), [t]);
}
