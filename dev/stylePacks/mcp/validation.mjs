// Bounded JSON-schema subset used by this server's own tool definitions (not a general schema engine).
export const string = (maxLength = 1000) => ({ type: 'string', minLength: 1, maxLength });
export const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
export function validate(value, schema, at = '$') {
    const fail = reason => { throw new Error(`${at}: ${reason}`); };
    if (schema.type === 'object') {
        if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expected object');
        for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) fail(`missing ${key}`);
        for (const key of Object.keys(value)) {
            if (!Object.hasOwn(schema.properties, key)) fail(`unknown field ${key}`);
            validate(value[key], schema.properties[key], `${at}.${key}`);
        }
    } else if (schema.type === 'array') {
        if (!Array.isArray(value)) fail('expected array');
        if (value.length < schema.minItems || value.length > schema.maxItems) fail(`expected ${schema.minItems}..${schema.maxItems} items`);
        value.forEach((item, i) => validate(item, schema.items, `${at}[${i}]`));
    } else if (schema.type === 'string') {
        if (typeof value !== 'string' || value.trim().length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) fail('invalid string length/type');
    } else if (schema.type === 'number' || schema.type === 'integer') {
        if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value))) fail(`expected finite ${schema.type}`);
        if (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) fail('out of range');
    }
    if (schema.enum && !schema.enum.includes(value)) fail(`expected one of ${schema.enum.join(', ')}`);
}
