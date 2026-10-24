import React, { useMemo, useState } from 'react';
import LyricStaffSection from '../../src/components/modal/lyric-filter/LyricStaffSection';
import LyricRuleList, { lyricRuleLabel } from '../../src/components/modal/lyric-filter/LyricRuleList';
import { compileLyricLineRules, type LyricLineRule } from '../../src/utils/lyrics/lyricLineRules';
import { useTranslation } from 'react-i18next';
import { buildLyricFilterPreviewModel } from '../../src/components/modal/lyric-filter/buildLyricFilterPreviewModel';
import LyricFilterPreviewList from '../../src/components/modal/lyric-filter/LyricFilterPreviewList';
import { SettingsKitThemeContext, settingsTokens } from '../../src/components/modal/settings/kit/kitTheme';
import { kitMotionTokens } from '../../src/components/modal/settings/kit/motion';
import { parseLyricsByFormat } from '../../src/utils/lyrics/parserCore';
import { DEFAULT_LYRIC_STAFF_ABSORB_MODE, DEFAULT_LYRIC_STAFF_MIN_DWELL_SECONDS, type LyricStaffAbsorbMode, type LyricStaffPolicy } from '../../src/utils/lyrics/staffCreditsPolicy';
import { DAYLIGHT_THEME, DEFAULT_THEME } from '../../src/services/baseThemes';
import type { ProbeDefinition } from './definition';
// dev/probes/lyricStaffSection.probe.tsx

/**
 * 开头制作人员信息的设置区块 + 它驱动的预览。
 *
 * 这里要看的是判定结果会不会随着控件实时变化：策略三态、每行停留滑块和自定义正则
 * 任何一个动了，右边的判定行和左边的预览标记都得跟着改。单测只能证明纯函数算得对，
 * 证明不了这几个受控输入接对了地方——这类接线错误只在真实渲染里暴露。
 *
 * 两段歌词分别对应「前奏够长」和「前奏太短」，可以直接对比同一组设置下的两种判定。
 * 逐行过滤那张卡也挂在这里，是为了确认它的开关长在自己卡里、读起来只管这条正则，
 * 而不是像早先那样浮在面板顶部、被当成整个歌词过滤的总开关。
 *
 * 顶部可以切亮色：策略三选一的选中态早先在亮色背景上和未选中看不出区别，
 * 两种配色都要能一眼看出当前选的是哪个。
 */
const LONG_INTRO = [
    '[00:00.00]某首歌 - 某歌手',
    '[00:01.00]作词 : A',
    '[00:01.20]作曲 : B',
    '[00:01.40]编曲 : C',
    '[00:01.60]制作人 : D',
    '[00:40.00]第一句歌词',
    '[00:44.00]第二句歌词',
].join('\n');

// 真实文件长这样：词表只认得开头几条，后面是任意乐器/职位，中间还夹着 "#" 分隔行。
const SHORT_INTRO = [
    '[00:00.00]作词 Lyricist：A',
    '[00:00.10]#',
    '[00:00.20]作曲 Composer：B',
    '[00:00.30]#',
    '[00:00.40]斯瓦希里语顾问 Swahili Language Consultant：C',
    '[00:00.50]#',
    '[00:00.60]乐队 Orchestra：D',
    '[00:00.70]//',
    '[00:03.00]第一句歌词',
    '[00:07.00]第二句歌词',
].join('\n');

// 块前一条短标题行、块后一条词表认不出来的短行，用来看吸收把块撑大之后的效果。
// 行尾那句 "Ah~" 是反向对照：字数也很短，但唱足了三秒，按耗时应被放过。
const NEIGHBOURS = [
    '[00:00.00]某首歌 - 某歌手',
    '[00:01.00]作词 : A',
    '[00:01.20]作曲 : B',
    '[00:01.40]Genshin Folk Ensemble',
    '[00:04.00]Ah~~~~~~',
    '[00:07.00]第一句歌词',
    '[00:11.00]第二句歌词',
].join('\n');

const SAMPLES = [
    { id: 'long-intro', label: '长前奏', lrc: LONG_INTRO },
    { id: 'short-intro', label: '短前奏', lrc: SHORT_INTRO },
    { id: 'neighbours', label: '块外相邻行', lrc: NEIGHBOURS },
] as const;

const LyricStaffSectionProbe: React.FC = () => {
    const [policy, setPolicy] = useState<LyricStaffPolicy>('smart');
    const [minDwell, setMinDwell] = useState(DEFAULT_LYRIC_STAFF_MIN_DWELL_SECONDS);
    const [absorbMode, setAbsorbMode] = useState<LyricStaffAbsorbMode>(DEFAULT_LYRIC_STAFF_ABSORB_MODE);
    const [pattern, setPattern] = useState('');
    const { t } = useTranslation();
    const [rules, setRules] = useState<LyricLineRule[]>([]);
    const [isDaylight, setIsDaylight] = useState(false);

    const parsed = useMemo(() => SAMPLES.map(sample => ({
        ...sample,
        lyrics: parseLyricsByFormat('lrc', sample.lrc),
    })), []);
    const theme = isDaylight ? DAYLIGHT_THEME : DEFAULT_THEME;
    const kitTheme = useMemo(() => ({ isDaylight, theme }), [isDaylight, theme]);

    return (
        <SettingsKitThemeContext.Provider value={kitTheme}>
        <div
            data-probe-daylight={String(isDaylight)}
            className={`min-h-screen p-8 ${isDaylight ? 'bg-zinc-100' : 'bg-zinc-950'}`}
            // 组件读的是主题变量，探针要跟着 baseThemes 一起翻，否则亮色下全是白字白底。
            style={{
                '--text-primary': isDaylight ? DAYLIGHT_THEME.primaryColor : DEFAULT_THEME.primaryColor,
                '--text-secondary': isDaylight ? DAYLIGHT_THEME.secondaryColor : DEFAULT_THEME.secondaryColor,
            } as React.CSSProperties}
        >
            <button
                type="button"
                data-probe-toggle-daylight
                onClick={() => setIsDaylight(previous => !previous)}
                className={`mb-6 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                    isDaylight ? 'border-black/15 text-zinc-900' : 'border-white/15 text-zinc-200'
                }`}
            >
                {isDaylight ? 'daylight' : 'dark'}
            </button>
            <div className="grid gap-6 lg:grid-cols-2">
            {parsed.map(({ id, label, lyrics }) => {
                const preview = buildLyricFilterPreviewModel(lyrics, compileLyricLineRules(rules), {
                    policy,
                    minDwellSeconds: minDwell,
                    absorbMode,
                    pattern,
                });

                return (
                    <div
                        key={id}
                        data-probe-sample={id}
                        // 这几块是用设置窗口的共用控件画的，颜色和动效变量平时由弹窗外框给，探针里自己给。
                        className="st-window rounded-2xl bg-[var(--st-win)] p-4 text-[color:var(--st-t1)]"
                        style={{ ...settingsTokens(isDaylight, theme), ...kitMotionTokens(false) }}
                    >
                        <div className={`mb-3 text-xs font-semibold ${isDaylight ? 'text-zinc-500' : 'text-zinc-400'}`}>{label}</div>
                        <div className="mb-4">
                            <LyricRuleList rules={rules} songLines={[]} perRule={new Map()} hasLibrary={false} onChange={setRules} />
                        </div>
                        <LyricStaffSection
                            policy={policy}
                            minDwellSeconds={minDwell}
                            absorbMode={absorbMode}
                            pattern={pattern}
                            onPolicyChange={setPolicy}
                            onMinDwellChange={setMinDwell}
                            onAbsorbModeChange={setAbsorbMode}
                            onPatternChange={setPattern}
                        />
                        <div className="mt-4 rounded-xl bg-[var(--st-pv)] p-3" data-probe-preview={id}>
                            <LyricFilterPreviewList isLoading={false} rows={preview.rows} staff={preview.staff} staffPolicy={policy} ruleLabel={rule => lyricRuleLabel(t, rule)} pickedIndex={null} onPickLine={() => {}} />
                        </div>
                    </div>
                );
            })}
            </div>
        </div>
        </SettingsKitThemeContext.Provider>
    );
};

const probe: ProbeDefinition = {
    id: 'lyricStaffSection',
    title: '开头制作人员信息设置',
    description: '策略三态、每行停留滑块和自定义正则是否实时驱动判定结果与预览标记',
    Component: LyricStaffSectionProbe,
};

export default probe;
