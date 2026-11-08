import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// An unrelated window or an embedded frame must never reach the companion.
const require = createRequire(import.meta.url);
const { createCompanionRequestHandler } = require('../../../electron/appleMusic/companionIpc.cjs');

describe('Apple Music IPC access', () => {
    it('accepts only the trusted main frame', () => {
        const frame = {};
        const sender = { mainFrame: frame };
        const request = vi.fn(() => ({ ok: true, data: {} }));
        const handler = createCompanionRequestHandler({ isTrusted: (value: unknown) => value === sender, client: { request } });
        expect(handler({ sender, senderFrame: frame }, 'accountStatus', {})).toEqual({ ok: true, data: {} });
        expect(handler({ sender, senderFrame: {} }, 'accountStatus', {})).toEqual({ ok: false, error: 'unavailable' });
        expect(handler({ sender: { mainFrame: frame }, senderFrame: frame }, 'accountStatus', {})).toEqual({ ok: false, error: 'unavailable' });
        expect(request).toHaveBeenCalledOnce();
    });
});
