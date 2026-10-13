import React from 'react';
import { PolaroidCard, type GridItem } from '../../src/library/suites/grid/shared/PolaroidCard';
import { normalizeQqCollection } from '../../src/services/onlineMusic/qqNormalize';
import type { ProbeDefinition } from './definition';

// dev/probes/categoryCoverReal.probe.tsx
// 用真实抓到的 /getSongLists 响应走一遍正规化，验证分类卡片的封面真的能加载。
//
// 为什么要有这个探针：分类歌单没封面的 bug 藏得很深——字段映射漏一个键，
// 渲染层完全不报错，只是安静地少一张图。而浏览器会话没有 Electron 的登录态，
// 拿不到真实分类数据，所以把真实响应固化成 fixture，让真实组件在真实浏览器里渲染。

const theme = {
    name: 'Probe',
    backgroundColor: '#18181b',
    primaryColor: '#fafafa',
    accentColor: '#a1a1aa',
    secondaryColor: '#a1a1aa',
    fontStyle: 'sans' as const,
    animationIntensity: 'normal' as const,
};

// 实测 2026-10-11 抓 /getSongLists 的三条真实条目（含 imgurl 封面与 listennum 播放量）。
const REAL_CATEGORY_ITEMS = [
    {
        dissid: 7707261125,
        dissname: '甜度爆表 | 旋律说唱狙击少女心',
        imgurl: 'http://qpic.y.qq.com/music_cover/s4SoBc0IrDEDpHKlDkDflKbCgbic5ldSQrdsEafqvxULdib5CvKhaibww/300?n=1',
        listennum: 8553372,
    },
    {
        dissid: 7707261126,
        dissname: '丧系Rap丨渐渐不再期待任何东西',
        imgurl: 'http://qpic.y.qq.com/music_cover/1Jcpjia5qaEibPyTuy709wFiapqHbxdewwwc5yBJI7NiaNMN9XDhUJPibJA/300?n=1',
        listennum: 1814465,
    },
    {
        dissid: 7707261127,
        dissname: '耳机里的秘密 | 宝藏女声集合站',
        imgurl: 'http://qpic.y.qq.com/music_cover/qhuJFHlwiayRp1rhWoJk9HaAkric2uNwiaX5vwuDF1mb4LgEId9z2eExg/300?n=1',
        listennum: 55497489,
    },
];

// 走真实的正规化——这一步才是 bug 的位置（漏 imgurl 键）。
const normalized = REAL_CATEGORY_ITEMS.map(item => normalizeQqCollection(item, 'playlist'));

const Component: React.FC = () => (
    <div className="flex gap-6 p-10" style={{ background: theme.backgroundColor }}>
        {normalized.map((collection, index) => (
            <div key={String(collection.id ?? index)} data-probe-card="category" className="w-56">
                <PolaroidCard
                    item={{
                        id: String(collection.id ?? index),
                        name: collection.name,
                        coverUrl: collection.coverUrl,
                        description: collection.description || '',
                        summary: '',
                    } as unknown as GridItem}
                    isDaylight={false}
                    theme={theme}
                    mode="collection"
                    t={(key: string) => key}
                    cardWidth={220}
                    cardHeight={280}
                    onSelect={() => undefined}
                    onCenter={() => undefined}
                />
                <p
                    className="mt-2 text-xs text-white/60"
                    data-probe-meta={String(collection.id ?? index)}
                >
                    {JSON.stringify({ hasCover: Boolean(collection.coverUrl), playCount: collection.playCount })}
                </p>
            </div>
        ))}
    </div>
);

export default {
    id: 'categoryCoverReal',
    title: '分类歌单真实数据封面',
    description: '用真实 /getSongLists 响应走正规化，验证 imgurl 封面与 listennum 播放量都能取到，且封面 img 真的加载成功。',
    Component,
} satisfies ProbeDefinition;
