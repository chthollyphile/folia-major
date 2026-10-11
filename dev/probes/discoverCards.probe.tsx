import React from 'react';
import { PolaroidCardCover, type GridItem } from '../../src/components/folia-grid/polaroidCardParts';
import { PERSONAL_FM_CARD_ID, buildDiscoverSections } from '../../src/components/app/home/buildDiscoverSections';
import type { ProbeDefinition } from './definition';

// dev/probes/discoverCards.probe.tsx
// 「发现」页的两处容易悄悄退化、而整应用测试很难到达的地方：
//
// 1. 猜你喜欢卡的 `id` / `isFm`。`GridView` 认 `type === 'radio' && id === 'personal_fm'` 才会切进
//    FM 模式（队列末尾自动补歌由 `usePlaybackQueueController` 接）。改了 id 就等于静默关掉刷歌，
//    而首页只是少一张卡，肉眼看不出坏了。
// 2. 封面加载失败时的落点。失败的封面必须停在**静止**的占位图上；没有这条路径时它会永远转下去，
//    读起来像还在加载。

// 同源路径 + 测试 route 桩（同仓库 latticeArtwork 的做法）：曾经用真实外网起义云图，封面加载慢或被网络拦下时卡片会走占位图，
// 断言「三张卡」就变成 2 张——这种失败与被测代码无关，纯粹环境抖动，会掩盖真回归。
const COVER_OK = '/probe-cover-ok.png';
/** 同源不存在的路径：立刻 404，不依赖网络可达性，失败态是确定的。 */
const COVER_BROKEN = '/probe-definitely-missing-cover.png';

const DiscoverCardsProbe: React.FC = () => {
    // 装配契约：FM 段必须排第一，空段必须被丢弃。
    const sections = buildDiscoverSections({
        fmSongs: [{
            id: 'fm-1',
            name: 'Whatever Happens',
            qqMid: '004X4tBC4ez4FP',
            sourceRef: { kind: 'online', providerId: 'qq', mediaId: '004X4tBC4ez4FP' },
        } as never],
        similarSongs: [],
        radarSongs: [],
        newSongs: [{
            id: 'ns-1',
            name: 'New Song',
            qqMid: 'newsong-mid-1',
            sourceRef: { kind: 'online', providerId: 'qq', mediaId: 'newsong-mid-1' },
        } as never],
        hasSeed: false,
        titles: { personalFm: '私人FM', similar: '相似歌曲', radar: '雷达', newSongs: '新歌速递' },
    });

    const gridItem = (id: string, name: string, coverUrl: string): GridItem => ({ id, name, coverUrl }) as GridItem;

    return (
        <div className="min-h-screen bg-zinc-900 p-8 text-zinc-100" data-probe-id="discoverCards">
            <section className="mb-8">
                <h2 className="mb-3 text-sm font-semibold">装配结果（FM 卡必须在第一位且契约字段正确）</h2>
                <ul className="space-y-1 text-xs" data-probe-items>
                    {sections.map(section => (
                        <li key={section.id} data-probe-item-id={section.id} data-probe-item-fm={section.id === 'personal-fm' ? 'true' : 'false'}>
                            {section.id} · {section.title} · {section.songs.length} 首
                        </li>
                    ))}
                </ul>
            </section>

            <section className="flex gap-6">
                <figure className="relative">
                    <figcaption className="mb-2 text-xs opacity-70">封面可用</figcaption>
                    <div className="relative h-40 w-40 overflow-hidden rounded-2xl border border-white/10">
                        <PolaroidCardCover item={gridItem('ok', 'ok', COVER_OK)} isUnavailable={false} />
                    </div>
                </figure>

                <figure className="relative">
                    <figcaption className="mb-2 text-xs opacity-70">封面 404（应停在静止占位图）</figcaption>
                    <div className="relative h-40 w-40 overflow-hidden rounded-2xl border border-white/10">
                        <PolaroidCardCover item={gridItem('bad', 'bad', COVER_BROKEN)} isUnavailable={false} />
                    </div>
                </figure>
            </section>

            <p className="mt-8 text-xs opacity-60">
                FM 卡 id 常量：<code>{PERSONAL_FM_CARD_ID}</code>
            </p>
        </div>
    );
};

const definition: ProbeDefinition = {
    id: 'discoverCards',
    title: '首页 · 发现卡片装配',
    description: '猜你喜欢卡的 id/isFm 契约（GridView 靠它切进 FM 模式），以及封面加载失败时是否停在静止占位图而不是一直转。',
    Component: DiscoverCardsProbe,
};

export default definition;
