import { COMPATIBLE_MODEL_CATALOGUE, GENERIC_REASONING_LADDER, PLAIN_ATTEMPTS } from './compatibleBody.mjs';
import { DEFAULT_OPENAI_MODEL } from './openai.mjs';

// shared/ai/custom.mjs
// Any other OpenAI-compatible endpoint (a relay, a local server, a provider without an adapter).
// It claims no host: inference falls back to it. Nothing is known about the endpoint, so
// segmentation walks the generic ladder in REASONING_SUPPRESSION_ATTEMPTS and the other asks send
// no reasoning parameter at all.

/** @type {import('./providerRegistry.mjs').AiAdapter} */
export const customAdapter = {
    id: 'custom',
    label: '',
    protocol: 'openai',
    hosts: [],
    endpoints: [{ id: 'default', baseUrl: '' }],
    // Some relays forward OpenAI's own models, so a blank model means OpenAI's default here too.
    defaultModel: DEFAULT_OPENAI_MODEL,
    temperature: { min: 0, max: 2 },
    stream: true,
    tokenField: 'max_tokens',
    attempts(task) {
        return task === 'segmentation' ? GENERIC_REASONING_LADDER : PLAIN_ATTEMPTS;
    },
    responseFormat: () => ({ type: 'json_object' }),
    models: COMPATIBLE_MODEL_CATALOGUE,
};
