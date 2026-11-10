import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/qqServerlessAdapter.test.ts
// 两个平台的部署 adapter 只负责一件事：把 `/api/qq/...` 还原成后端 `./serverless` 认识的路径。
// 这里断言的是「还原结果」，不是后端行为 —— 后端契约由 qq-music-api 自己的测试守。

const handleRequestMock = vi.hoisted(() => vi.fn());

vi.mock('@yakult-green-tea/qq-music-api/serverless', () => ({
    default: handleRequestMock,
}));

import { handleQq } from '../../../worker/qq';
import vercelHandler, { config } from '../../../api-ts/qq';

// 取出 adapter 实际转发给后端的那个 Request 的 URL。
const forwardedUrl = (): URL => new URL(handleRequestMock.mock.calls[0][0].url);
const forwardedEnv = () => handleRequestMock.mock.calls[0][1];
const forwardedRelay = () => handleRequestMock.mock.calls[0][2]?.qqRelay;

/** 一个假的 DO namespace：记下每次拿到的对象名和转发给 stub 的请求。 */
const createNamespace = (respond: (operation: string) => Response = () => new Response('{}')) => {
    const names: string[] = [];
    const operations: string[] = [];
    return {
        names,
        operations,
        namespace: {
            idFromName: (name: string) => {
                names.push(name);
                return { toString: () => name };
            },
            get: () => ({
                fetch: async (request: Request) => {
                    const operation = new URL(request.url).pathname;
                    operations.push(operation);
                    return respond(operation);
                },
            }),
        },
    };
};

describe('QQ serverless deployment adapters', () => {
    beforeEach(() => {
        handleRequestMock.mockReset();
        handleRequestMock.mockResolvedValue(new Response('{}', { status: 200 }));
    });

    describe('Cloudflare worker entry', () => {
        it('strips the /api/qq prefix and keeps the query untouched', async () => {
            await handleQq(
                new Request('https://folia.example/api/qq/login/qr/check?key=abc&timestamp=1'),
                { QQ_SESSION_SECRET: 'secret' },
            );

            const url = forwardedUrl();
            expect(url.pathname).toBe('/login/qr/check');
            expect(url.searchParams.get('key')).toBe('abc');
            expect(url.searchParams.get('timestamp')).toBe('1');
        });

        it('forwards path parameters that the backend reads off the pathname', async () => {
            await handleQq(
                new Request('https://folia.example/api/qq/getMusicPlay/003abc'),
                { QQ_SESSION_SECRET: 'secret' },
            );

            expect(forwardedUrl().pathname).toBe('/getMusicPlay/003abc');
        });

        it('carries the session header through instead of rebuilding the request', async () => {
            await handleQq(
                new Request('https://folia.example/api/qq/login/status', {
                    headers: { 'X-QQ-Session': 'qq1.a.k.i.c' },
                }),
                { QQ_SESSION_SECRET: 'secret' },
            );

            expect(handleRequestMock.mock.calls[0][0].headers.get('x-qq-session')).toBe('qq1.a.k.i.c');
        });

        it('passes only the two secrets the backend declares', async () => {
            await handleQq(
                new Request('https://folia.example/api/qq/login/channels'),
                { QQ_SESSION_SECRET: 'current', QQ_SESSION_SECRET_PREVIOUS: 'previous' },
            );

            expect(forwardedEnv()).toEqual({
                QQ_SESSION_SECRET: 'current',
                QQ_SESSION_SECRET_PREVIOUS: 'previous',
            });
        });

        it('reduces a bare prefix to the backend root rather than an empty path', async () => {
            await handleQq(new Request('https://folia.example/api/qq'), {});

            expect(forwardedUrl().pathname).toBe('/');
        });
    });

    describe('Vercel edge entry', () => {
        it('rebuilds the backend path from the rewrite parameter and drops it from the query', async () => {
            // vercel.json 把 /api/qq/login/qr/check?key=abc 改写成这个形状。
            await vercelHandler(
                new Request('https://folia.example/api/qq?path=login/qr/check&key=abc'),
            );

            const url = forwardedUrl();
            expect(url.pathname).toBe('/login/qr/check');
            expect(url.searchParams.get('key')).toBe('abc');
            // `path` 是 rewrite 的内部约定，不能泄漏给后端当成业务参数。
            expect(url.searchParams.has('path')).toBe(false);
        });

        it('produces the same backend URL as the Cloudflare entry for the same public URL', async () => {
            await handleQq(
                new Request('https://folia.example/api/qq/getSongInfo/003abc?timestamp=7'),
                {},
            );
            const cloudflare = forwardedUrl();

            handleRequestMock.mockClear();
            await vercelHandler(
                new Request('https://folia.example/api/qq?path=getSongInfo/003abc&timestamp=7'),
            );
            const vercel = forwardedUrl();

            expect(vercel.pathname).toBe(cloudflare.pathname);
            expect(vercel.search).toBe(cloudflare.search);
        });

        it('declares the edge runtime, whose closure rules keep node builtins out', () => {
            expect(config).toEqual({ runtime: 'edge' });
        });

        it('never offers a QQ relay: Vercel has no primitive that outlives one invocation', async () => {
            await vercelHandler(new Request('https://folia.example/api/qq?path=login/channels'));

            expect(forwardedRelay()).toBeUndefined();
        });
    });

    // QQ 扫码登录需要一条能跨调用存活的 MQTT 连接，Cloudflare 上由 Durable Object 提供。
    // 这里守的是「什么时候交出 relay」以及「平台细节有没有留在这一层」——DO 自己的行为在
    // test/unit/worker/qqQrChannel.test.ts。
    describe('QQ scan channel relay', () => {
        it('offers no relay when the Durable Object is not bound', async () => {
            // 🔴 没绑定不是错误，是能力声明：后端据此只宣告微信。binding 故意不在入库的
            // wrangler.jsonc 里，所以这才是绝大多数部署的形态。
            await handleQq(new Request('https://folia.example/api/qq/login/channels'), {
                QQ_SESSION_SECRET: 'secret',
            });

            expect(forwardedRelay()).toBeUndefined();
        });

        it('offers no relay without a secret, so nobody scans a code that cannot be exchanged', async () => {
            // 没有 secret 时登录路由本来就回 501；此时宣告一条点进去必定失败的通道只会白扫一次。
            await handleQq(new Request('https://folia.example/api/qq/login/channels'), {
                QQ_QR_CHANNEL: createNamespace().namespace,
            });

            expect(forwardedRelay()).toBeUndefined();
        });

        it('offers a relay once both the binding and the secret exist', async () => {
            await handleQq(new Request('https://folia.example/api/qq/login/channels'), {
                QQ_SESSION_SECRET: 'secret',
                QQ_QR_CHANNEL: createNamespace().namespace,
            });

            expect(forwardedRelay()).toBeDefined();
        });

        it('addresses one code to one object, so open and poll reach the same connection', async () => {
            const fake = createNamespace();
            await handleQq(new Request('https://folia.example/api/qq/login/qr/check'), {
                QQ_SESSION_SECRET: 'secret',
                QQ_QR_CHANNEL: fake.namespace,
            });
            const relay = forwardedRelay();

            await relay.open('qr-fixture', 'data:image/png;base64,AAAA', 60_000);
            await relay.poll('qr-fixture', 0);

            expect(fake.names[0]).toBe(fake.names[1]);
            expect(fake.operations).toEqual(['/open', '/poll']);
        });

        it('does not use the qrcodeID as the object name', async () => {
            // qrcodeID 就印在二维码图里，扫过的人都知道。对外确实要有合法 unikey 才进得来，但把
            // 对象名做成不可猜是零成本的纵深。
            const fake = createNamespace();
            await handleQq(new Request('https://folia.example/api/qq/login/qr/check'), {
                QQ_SESSION_SECRET: 'secret',
                QQ_QR_CHANNEL: fake.namespace,
            });

            await forwardedRelay().close('qr-fixture');

            expect(fake.names[0]).not.toContain('qr-fixture');
        });

        it('gives two deployments different object names for the same code', async () => {
            const first = createNamespace();
            await handleQq(new Request('https://folia.example/api/qq/login/qr/check'), {
                QQ_SESSION_SECRET: 'secret-one',
                QQ_QR_CHANNEL: first.namespace,
            });
            await forwardedRelay().close('qr-fixture');

            handleRequestMock.mockClear();
            const second = createNamespace();
            await handleQq(new Request('https://folia.example/api/qq/login/qr/check'), {
                QQ_SESSION_SECRET: 'secret-two',
                QQ_QR_CHANNEL: second.namespace,
            });
            await forwardedRelay().close('qr-fixture');

            expect(first.names[0]).not.toBe(second.names[0]);
        });

        it('surfaces a failed channel call instead of reporting an empty observation', async () => {
            // 静默回空会让 checkLogin 一路回 801：二维码明明已经废了，界面却一直转。
            const fake = createNamespace(() => new Response('{}', { status: 500 }));
            await handleQq(new Request('https://folia.example/api/qq/login/qr/check'), {
                QQ_SESSION_SECRET: 'secret',
                QQ_QR_CHANNEL: fake.namespace,
            });

            await expect(forwardedRelay().poll('qr-fixture', 0)).rejects.toThrow('poll');
        });

        it('reads the event list back off the channel response', async () => {
            const events = [{ type: 'waiting', payload: null }, { type: 'scanned', payload: null }];
            const fake = createNamespace(() => new Response(JSON.stringify({ events })));
            await handleQq(new Request('https://folia.example/api/qq/login/qr/check'), {
                QQ_SESSION_SECRET: 'secret',
                QQ_QR_CHANNEL: fake.namespace,
            });

            expect(await forwardedRelay().poll('qr-fixture', 20_000)).toEqual(events);
        });
    });
});
