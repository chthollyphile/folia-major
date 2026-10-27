import { CONTROL_ERROR_CODES } from '../../shared/controlCatalog.mjs';
import { errorMessage } from '../utils/errorText';
import type { ControlErrorCode, ControlErrorEnvelope, ControlToolPropertySchema, ControlToolSchema } from './types';

// src/control/errors.ts
// ControlError plus the strict catalog-schema argument validation every bridge tool runs first.

export class ControlError extends Error {
    readonly code: ControlErrorCode;

    readonly details?: Record<string, unknown>;

    constructor(code: ControlErrorCode, message?: string, details?: Record<string, unknown>) {
        super(message ?? CONTROL_ERROR_CODES[code] ?? code);
        this.name = 'ControlError';
        this.code = code;
        if (details) {
            this.details = details;
        }
    }
}

export const isControlError = (value: unknown): value is ControlError => value instanceof ControlError;

/** Maps anything thrown by a handler onto the envelope's error object (never rethrows). */
export const toControlErrorEnvelope = (thrown: unknown): ControlErrorEnvelope => {
    if (isControlError(thrown)) {
        return {
            code: thrown.code,
            message: thrown.message,
            ...(thrown.details ? { details: thrown.details } : {}),
        };
    }
    return { code: 'internal', message: errorMessage(thrown) };
};

const fail = (message: string, details?: Record<string, unknown>): never => {
    throw new ControlError('bad_request', message, details);
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

const validateProperty = (name: string, schema: ControlToolPropertySchema, value: unknown): void => {
    if (value === undefined) {
        return;
    }

    if (schema.enum && !schema.enum.includes(value as never)) {
        fail(`"${name}" must be one of: ${schema.enum.map(entry => String(entry)).join(', ')}`, {
            argument: name,
            allowed: schema.enum,
        });
    }

    switch (schema.type) {
        case 'string':
            if (typeof value !== 'string') fail(`"${name}" must be a string`, { argument: name });
            return;
        case 'number':
            if (typeof value !== 'number' || !Number.isFinite(value)) fail(`"${name}" must be a number`, { argument: name });
            break;
        case 'integer':
            if (typeof value !== 'number' || !Number.isInteger(value)) fail(`"${name}" must be an integer`, { argument: name });
            break;
        case 'boolean':
            if (typeof value !== 'boolean') fail(`"${name}" must be a boolean`, { argument: name });
            return;
        case 'array':
            if (!Array.isArray(value)) fail(`"${name}" must be an array`, { argument: name });
            if (schema.items) {
                (value as unknown[]).forEach((entry, index) => validateProperty(`${name}[${index}]`, schema.items!, entry));
            }
            return;
        case 'object':
            if (!isPlainObject(value)) fail(`"${name}" must be an object`, { argument: name });
            if (schema.properties) {
                validateProperties(schema as ControlToolSchema, value as Record<string, unknown>, name);
            }
            return;
        default:
            break;
    }

    if (typeof value === 'number') {
        if (schema.minimum !== undefined && value < schema.minimum) {
            fail(`"${name}" must be >= ${schema.minimum}`, { argument: name, minimum: schema.minimum });
        }
        if (schema.maximum !== undefined && value > schema.maximum) {
            fail(`"${name}" must be <= ${schema.maximum}`, { argument: name, maximum: schema.maximum });
        }
    }
};

const validateProperties = (
    schema: ControlToolSchema,
    values: Record<string, unknown>,
    path?: string,
): void => {
    const prefix = path ? `${path}.` : '';
    const properties = schema.properties ?? {};

    (schema.required ?? []).forEach((key) => {
        if (!(key in values) || values[key] === undefined) {
            fail(`"${prefix}${key}" is required`, { argument: `${prefix}${key}` });
        }
    });

    Object.keys(values).forEach((key) => {
        if (!(key in properties)) {
            if (schema.additionalProperties === true) {
                return;
            }
            fail(`Unknown argument "${prefix}${key}"`, { argument: `${prefix}${key}` });
            return;
        }
        validateProperty(`${prefix}${key}`, properties[key], values[key]);
    });
};

/**
 * Validates `args` against the catalog's inputSchema. Unknown tools are not this function's job;
 * callers look the tool up first. Missing args validate as an empty object (all-optional tools).
 */
export const validateToolArgs = (
    schema: ControlToolSchema,
    args: unknown,
): Record<string, unknown> => {
    if (args === undefined || args === null) {
        const values: Record<string, unknown> = {};
        validateProperties(schema, values);
        return values;
    }
    if (!isPlainObject(args)) {
        throw new ControlError('bad_request', 'Arguments must be a JSON object', {
            received: Array.isArray(args) ? 'array' : typeof args,
        });
    }
    validateProperties(schema, args);
    return args;
};

export const requireObject = (value: unknown, label: string): Record<string, unknown> => {
    if (!isPlainObject(value)) {
        throw new ControlError('bad_request', `"${label}" must be a JSON object`);
    }
    return value;
};

export const requireString = (value: unknown, label: string): string => {
    if (typeof value !== 'string' || value.length === 0) {
        throw new ControlError('bad_request', `"${label}" must be a non-empty string`);
    }
    return value;
};

export const optionalString = (value: unknown, label: string): string | undefined => {
    if (value === undefined) {
        return undefined;
    }
    return requireString(value, label);
};

export const optionalBoolean = (value: unknown, label: string): boolean | undefined => {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'boolean') {
        throw new ControlError('bad_request', `"${label}" must be a boolean`);
    }
    return value;
};

export const optionalInteger = (value: unknown, label: string): number | undefined => {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new ControlError('bad_request', `"${label}" must be an integer`);
    }
    return value;
};

export const optionalNumber = (value: unknown, label: string): number | undefined => {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new ControlError('bad_request', `"${label}" must be a number`);
    }
    return value;
};
