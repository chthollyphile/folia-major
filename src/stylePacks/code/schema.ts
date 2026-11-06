import { STYLE_PACK_SCHEMA } from '../schema.ts';

// The executable contract has its own version; v1 remains a small, non-executable format.
export const CODE_PACK_SCHEMA = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Folia Renderer Pack v2', type: 'object', additionalProperties: false,
    required: ['format', 'schemaVersion', 'id', 'name', 'version', 'author', 'palette', 'renderer'],
    properties: {
        ...Object.fromEntries(Object.entries(STYLE_PACK_SCHEMA.properties).filter(([key]) => !['layers', 'portraitLayers'].includes(key))),
        schemaVersion: { const: 2 },
        renderer: {
            type: 'object', additionalProperties: false, required: ['apiVersion', 'code'],
            properties: { apiVersion: { const: 2 }, code: { type: 'string', minLength: 1, maxLength: 1024 * 1024 } },
        },
        settings: { type: 'object', maxProperties: 64, additionalProperties: { type: ['string', 'number', 'boolean'], maxLength: 2000 } },
        assets: {
            type: 'array', maxItems: 32,
            items: {
                type: 'object', additionalProperties: false, required: ['id', 'mime', 'data'],
                properties: {
                    id: { type: 'string', pattern: '^[a-z][a-z0-9.-]{0,63}$' },
                    mime: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'font/woff2'] },
                    data: { type: 'string', pattern: '^[A-Za-z0-9+/]+={0,2}$', maxLength: 3 * 1024 * 1024 },
                },
            },
        },
    },
};
