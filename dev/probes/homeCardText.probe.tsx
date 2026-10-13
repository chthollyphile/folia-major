import React from 'react';
import { PolaroidCard, type GridItem } from '../../src/library/suites/grid/shared/PolaroidCard';
import {
    getGrid3DSliderDisplayName,
    getGrid3DSliderSecondaryText,
    getGrid3DSliderSummaryText,
} from '../../src/library/suites/grid/home/Grid3DSlider';
import type { ProbeDefinition } from './definition';

// dev/probes/homeCardText.probe.tsx
// 首页各 tab 的「卡片文字」回归防线。
//
// 2026-10-09 用户实测反馈：点进某些 tab 后只剩封面图，歌名/歌手/来源行不见。这类退化不报错
// （名字与描述都是可选链，取不到就是 undefined），只会让界面安静地变成一堵图墙，所以要把
// 三种 tab 的卡片形状钉在这里：专辑卡、分类筛出来的歌单卡（summary=分类名那个特例）。

// Grid3DSlider 的三个取值函数看的是（type / summary 全的）Grid3DSliderItem 子集，
// 这里按它们实际读到的字段声明，不引入整个组件的依集。
type SliderTextItem = {
    id: string;
    name: string;
    type: string;
    isVirtual?: boolean;
    description?: string;
    summary?: string;
};

const theme = {
    name: 'Probe',
    backgroundColor: '#18181b',
    primaryColor: '#fafafa',
    accentColor: '#a1a1aa',
    secondaryColor: '#a1a1aa',
    fontStyle: 'sans' as const,
    animationIntensity: 'normal' as const,
};

const albumCard = {
    id: 'album-1',
    name: '叶惠美',
    coverUrl: 'https://p1.music.126.net/QrD8drwrRcegfKLPoiiG2Q==/109951166288436155.jpg',
    description: '周杰伦',
    summary: '2003 · 11 首',
    type: 'album',
} as SliderTextItem;

// 分类筛出来的歌单卡：summary 是来源分类，description 必须仍是歌单自己的描述（2026-10-09 修过
// 一处把描述位让给分类名的回归）。
const categoryPlaylistCard = {
    id: 'pl-1',
    name: '睡前轻音乐：把灯调暗，让耳朵慢下来',
    coverUrl: 'https://p1.music.126.net/QrD8drwrRcegfKLPoiiG2Q==/109951166288436155.jpg',
    description: '适合在睡前置顶播放的安静歌单',
    summary: '睡前',
    trackCount: 42,
    type: 'playlist',
} as SliderTextItem;

const HomeCardTextProbe: React.FC = () => (
    <div className="min-h-screen bg-zinc-900 p-8 text-zinc-100" data-probe-id="homeCardText">
        <h2 className="mb-4 text-sm font-semibold">卡片文字（三种 tab 形状）</h2>
        <div className="flex gap-8" data-probe-cards>
            <div data-probe-card="album">
                <PolaroidCard
                    item={albumCard as unknown as GridItem}
                    isDaylight={false}
                    theme={theme}
                    mode="collection"
                    t={(key: string) => key}
                    cardWidth={220}
                    cardHeight={280}
                    onSelect={() => undefined}
                    onCenter={() => undefined}
                />
            </div>
            <div data-probe-card="category-playlist">
                <PolaroidCard
                    item={categoryPlaylistCard as unknown as GridItem}
                    isDaylight={false}
                    theme={theme}
                    mode="collection"
                    t={(key: string) => key}
                    cardWidth={220}
                    cardHeight={280}
                    onSelect={() => undefined}
                    onCenter={() => undefined}
                />
            </div>
        </div>

        <h2 className="mb-2 mt-10 text-sm font-semibold">Grid3DSlider 取值函数</h2>
        <table className="text-xs">
            <thead>
                <tr>
                    <th className="pr-4 text-left">type</th>
                    <th className="pr-4 text-left">name</th>
                    <th className="pr-4 text-left">副标题</th>
                    <th className="pr-4 text-left">来源行</th>
                </tr>
            </thead>
            <tbody>
                {[albumCard, categoryPlaylistCard].map(item => (
                    <tr key={item.id} data-probe-row={item.id}>
                        <td className="pr-4">{String(item.type)}</td>
                        <td className="pr-4" data-probe-name>{getGrid3DSliderDisplayName(item)}</td>
                        <td className="pr-4" data-probe-secondary>{getGrid3DSliderSecondaryText(item)}</td>
                        <td className="pr-4" data-probe-summary>{getGrid3DSliderSummaryText(item)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

const probe: ProbeDefinition = {
    id: 'homeCardText',
    title: '首页卡片文字',
    description: '钉住专辑卡与分类歌单卡的歌名/副标题/来源行，防止退回「只剩封面图」',
    Component: HomeCardTextProbe,
};

export default probe;
