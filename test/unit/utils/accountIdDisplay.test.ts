import { describe, expect, it } from 'vitest';
import { shortAccountId } from '@/utils/accountIdDisplay';

// test/unit/utils/accountIdDisplay.test.ts
// The account row keeps the start of a long pseudonymous id and marks the rest with an ellipsis.

describe('shortAccountId', () => {
    it('keeps a short id as it is', () => {
        expect(shortAccountId('12345')).toBe('12345');
        expect(shortAccountId('a'.repeat(12))).toBe('a'.repeat(12));
    });

    it('keeps the start of a long id and marks the rest', () => {
        expect(shortAccountId('a'.repeat(64))).toBe(`${'a'.repeat(12)}...`);
        expect(shortAccountId('0123456789abcdef', 8)).toBe('01234567...');
    });
});
