import { readQishuiSceneIcon } from './qishuiTransport';

// Compose small platform icons into crisp, spacious vector artwork suitable for any card aspect ratio.
const covers = new Map<string, Promise<string>>();
const PALETTES = [[222, 270], [166, 215], [304, 248], [24, 346], [190, 239], [258, 323], [145, 194], [345, 26]];
export function createQishuiSceneCover(id: string, iconUrl: string): Promise<string> {
    const key = `${id}:${iconUrl}`;
    const kept = covers.get(key);
    if (kept) return kept;
    // Set when the icon could not be read: that artwork is shown this time only, and a later card asks again.
    let withoutIcon = false;
    const task = (async () => {
        let icon = '';
        if (iconUrl) {
            try { icon = await readQishuiSceneIcon(iconUrl); }
            catch (error) {
                console.warn('[Qishui] Scene artwork uses its vector background', error);
                withoutIcon = true;
            }
        }
        const seed = [...id].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 7);
        const [a, b] = PALETTES[seed % PALETTES.length];
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">
<defs>
<linearGradient id="base" x2="1" y2="1"><stop stop-color="hsl(${a},35%,12%)"/><stop offset="1" stop-color="hsl(${b},29%,7%)"/></linearGradient>
<radialGradient id="light"><stop stop-color="hsl(${a},65%,49%)" stop-opacity=".54"/><stop offset="1" stop-color="hsl(${a},60%,30%)" stop-opacity="0"/></radialGradient>
<radialGradient id="warm"><stop stop-color="hsl(${b},60%,44%)" stop-opacity=".38"/><stop offset="1" stop-color="hsl(${b},60%,25%)" stop-opacity="0"/></radialGradient>
<linearGradient id="disc" x2="0" y2="1"><stop stop-color="#fff" stop-opacity=".065"/><stop offset="1" stop-color="#fff" stop-opacity=".012"/></linearGradient>
</defs>
<path fill="url(#base)" d="M0 0H640V640H0Z"/>
<ellipse fill="url(#light)" cx="105" cy="130" rx="500" ry="420"/>
<ellipse fill="url(#warm)" cx="590" cy="570" rx="450" ry="460"/>
<g fill="none" stroke="#fff" stroke-opacity=".055">
<path d="M-90 520C120 ${220 + seed % 120} 430 140 740 280"/>
<path d="M-90 550C120 ${250 + seed % 120} 430 170 740 310"/>
<path d="M-90 580C120 ${280 + seed % 120} 430 200 740 340"/>
</g>
<circle cx="320" cy="320" r="110" fill="url(#disc)" stroke="#fff" stroke-opacity=".09"/>
<circle cx="320" cy="320" r="134" fill="none" stroke="#fff" stroke-opacity=".035"/>
${icon ? `<image href="${icon}" x="256" y="256" width="128" height="128" opacity=".9" style="mix-blend-mode:screen"/>` : ''}
</svg>`;
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    })();
    covers.set(key, task);
    while (covers.size > 64) covers.delete(covers.keys().next().value!);
    void task.then(() => { if (withoutIcon && covers.get(key) === task) covers.delete(key); });
    return task;
}
