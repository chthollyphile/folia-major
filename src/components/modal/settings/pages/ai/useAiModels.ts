import { useEffect, useRef, useState } from 'react';
import { canListAiModels, fetchAiModels } from '../../../../../services/aiText';

// The model list belongs to one form connection. Late replies never replace another provider's list.
export const useAiModels = (payload: AiConnectionTestPayload, keySaved: boolean) => {
    const [models, setModels] = useState<{ id: string; name: string }[]>([]);
    // What the main process suggested when the list could not be had (the adapter's suggestedModels).
    const [suggested, setSuggested] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<AiModelListResult['errorKind'] | null>(null);
    const identity = JSON.stringify([payload.provider, payload.presetId, payload.apiUrl, payload.apiKey, payload.useSystemProxy, keySaved]);
    const identityRef = useRef(identity);
    identityRef.current = identity;
    const requestRef = useRef(0);
    const pendingRef = useRef<string | null>(null);
    const canLoad = canListAiModels() && Boolean(payload.apiKey.trim() || keySaved)
        && (payload.provider === 'gemini' || Boolean(payload.apiUrl?.trim()));

    useEffect(() => {
        requestRef.current += 1;
        pendingRef.current = null;
        setModels([]);
        setSuggested([]);
        setError(null);
        setLoading(false);
    }, [identity]);
    useEffect(() => () => { requestRef.current += 1; }, []);

    const load = async () => {
        if (!canLoad || pendingRef.current === identity) return;
        const seq = ++requestRef.current;
        pendingRef.current = identity;
        setLoading(true);
        setError(null);
        let answer: AiModelListResult;
        try {
            answer = await fetchAiModels(payload);
        } catch {
            answer = { ok: false, errorKind: 'network' };
        }
        if (seq !== requestRef.current || identityRef.current !== identity) return;
        pendingRef.current = null;
        setLoading(false);
        if (answer.ok && answer.models?.length) {
            setModels(answer.models);
            setSuggested([]);
        } else {
            setModels([]);
            setSuggested(Array.isArray(answer.suggestedModels) ? answer.suggestedModels.filter(id => typeof id === 'string' && id) : []);
            setError(answer.errorKind ?? 'empty');
        }
    };

    return { models, suggested, loading, error, canLoad, load };
};
