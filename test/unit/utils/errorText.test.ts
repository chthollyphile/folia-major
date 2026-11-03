import { describe, expect, it } from 'vitest';
import { codeText, errorFields, errorMessage } from '@/utils/errorText';

// test/unit/utils/errorText.test.ts
// What a thrown thing gives when it is split into fields or a sentence: its own words, whole.

describe('errorMessage', () => {
    it('is the sentence of an error, word for word', () => {
        const said = "EPERM: operation not permitted, open 'C:\\Users\\Zhang San\\AppData\\Roaming\\Folia\\key'";
        expect(errorMessage(new Error(said))).toBe(said);
        expect(errorMessage(new Error('x'.repeat(1000)))).toHaveLength(1000);
    });

    it('is the first inner error\'s sentence when the error has none of its own', () => {
        expect(errorMessage(new AggregateError([new Error('first'), new Error('second')], ''))).toBe('first');
        expect(errorMessage(new Error('', { cause: new Error('beneath') }))).toBe('beneath');
        expect(errorMessage(new Error(''))).toBe('');
    });

    it('is the JSON of a thrown object, and the text of anything else', () => {
        expect(errorMessage({ code: 301, msg: 'need login' })).toBe('{"code":301,"msg":"need login"}');
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(errorMessage(circular)).toBe('[object Object]');
        expect(errorMessage('plain words')).toBe('plain words');
        expect(errorMessage(undefined)).toBe('undefined');
    });
});

describe('codeText', () => {
    it('keeps a string as it is and turns a number into one', () => {
        expect(codeText('auth-required')).toBe('auth-required');
        expect(codeText(-462)).toBe('-462');
        expect(codeText(Number.NaN)).toBeUndefined();
        expect(codeText({ code: 1 })).toBeUndefined();
        expect(codeText(undefined)).toBeUndefined();
    });
});

describe('errorFields', () => {
    it('holds the name, the sentence, the code and the stack of an error', () => {
        const error = Object.assign(new TypeError('bad answer'), { code: 'ECONNRESET' });
        expect(errorFields(error)).toEqual({ name: 'TypeError', message: 'bad answer', code: 'ECONNRESET', stack: error.stack });
    });

    it('names anything that is not an error Error, with its text and nothing else', () => {
        expect(errorFields('refused')).toEqual({ name: 'Error', message: 'refused' });
    });
});
