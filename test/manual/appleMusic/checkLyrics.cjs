// Inspect only the presence and timing of lyrics; never print account data or lyrics.
const endpoint = 'http://127.0.0.1:19225/json';
// An optional storefront allows a controlled comparison when the webpage uses another region.
const storefront = process.argv[2];
if (storefront && !/^[a-z]{2}$/.test(storefront)) {
    console.error('Storefront must be a lowercase two-letter code');
    process.exit(1);
}
(async () => {
    const pages = await (await fetch(endpoint)).json();
    const page = pages.find(item => item.type === 'page' && /^https:\/\/music\.apple\.com\//.test(item.url));
    if (!page) throw new Error('Apple Music page not found');
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    const expression = `(async () => {
        try {
            const mk = window.MusicKit?.getInstance();
            const item = mk?.nowPlayingItem;
            const id = item?.attributes?.playParams?.catalogId || item?.attributes?.playParams?.id || item?.id;
            if (!mk || !id) return {status:'no-current-track'};
            const request = mk.api?.v3?.music?.bind(mk.api.v3) ?? mk.api?.music?.bind(mk.api);
            if (!request) return {status:'lyrics-api-unavailable'};
            let store = ${JSON.stringify(storefront || null)};
            if (!store) {
                const account = await request('v1/me/storefront');
                store = account?.data?.data?.[0]?.id;
                if (typeof store !== 'string' || !/^[a-z]{2}$/.test(store)) {
                    return {status:'storefront-unavailable', httpStatus:Number(account?.status) || null};
                }
            }
            const path = 'v1/catalog/' + encodeURIComponent(store) + '/songs/' + encodeURIComponent(id) + '/syllable-lyrics';
            const response = await request(path);
            if (Number(response?.status) >= 400 || response?.data?.errors?.length) {
                return {status:'request-failed', httpStatus:Number(response?.status) || null};
            }
            const ttml = response?.data?.data?.[0]?.attributes?.ttml;
            if (typeof ttml !== 'string') return {status:'no-ttml'};
            const xml = new DOMParser().parseFromString(ttml, 'application/xml');
            const spans = [...xml.getElementsByTagNameNS('*', 'span')];
            const timedSpans = spans.filter(span => span.hasAttribute('begin') && span.hasAttribute('end'));
            const lines = [...xml.getElementsByTagNameNS('*', 'p')];
            const timedLines = lines.filter(line => line.hasAttribute('begin') && line.hasAttribute('end'));
            return {status:'ok', spanCount:spans.length, timedSpanCount:timedSpans.length, timedLineCount:timedLines.length, parseError:xml.getElementsByTagName('parsererror').length > 0};
        } catch (error) { return {status:'request-failed', name:String(error?.name || 'Error')}; }
    })()`;
    const result = await new Promise((resolve, reject) => {
        socket.onmessage = event => { const data = JSON.parse(event.data); if (data.id === 1) resolve(data.result); };
        socket.onerror = reject;
        socket.send(JSON.stringify({id:1, method:'Runtime.evaluate', params:{expression, awaitPromise:true, returnByValue:true}}));
        setTimeout(() => reject(new Error('Probe timed out')), 30000).unref();
    });
    console.log(JSON.stringify(result?.result?.value ?? {status:'evaluation-failed'}));
    socket.close();
})().catch(error => { console.error(error.message); process.exitCode = 1; });
