import React from 'react';
import NowPlayingToast from '../../src/components/app/overlays/NowPlayingToast';
import { announceTransition } from '../../src/services/automix/transitionCue';
import { useSettingsUiStore } from '../../src/stores/useSettingsUiStore';
import type { ProbeDefinition } from './definition';
// dev/probes/nowPlayingToastTransitionBorder.probe.tsx

/**
 * automix 混音进度长在 now playing 卡片边框上的那圈发光描边。
 * 原型是 exp/ps-borderPgrs 的 pulsingBorderProgress 探针，这里挂的是接进 app 之后的成品：
 * 真的 NowPlayingToast + 真的 transitionCue 广播。
 *
 * 要看的是三件事：
 * 1. 描边真的画出来了，而且位置是绕着卡片而不是错开的——画布尺寸是 ResizeObserver 量出来的，
 *    量错一点点就整体偏；
 * 2. 描边的内侧那一半被卡片背景盖住，露在外面的是外侧和辉光；
 * 3. 混音期间卡片不隐藏，即使模式是「限时显示」且计时早就到了。
 *
 * 卡片是 fixed 定位的（左下角），所以下面那两块留白只是把按钮推开，不是它的容器。
 */

const DEMO_COVER = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <defs>
    <radialGradient id="g" cx="50%" cy="38%" r="70%">
      <stop offset="0%" stop-color="#ffd8a8"/>
      <stop offset="45%" stop-color="#e8763c"/>
      <stop offset="100%" stop-color="#2b1b4d"/>
    </radialGradient>
  </defs>
  <rect width="200" height="200" fill="url(#g)"/>
  <circle cx="100" cy="86" r="34" fill="#fff3d6" opacity="0.85"/>
</svg>`)}`;

const SONG = { title: '秘密のメリーゴーランド (ft. Sohbana)', artist: 'ミカヅキ BIGWAVE', coverUrl: DEMO_COVER };
const NEXT_UP = { title: 'Neon Aquarium', artist: 'Sunset Rollercoaster', coverUrl: null };

/** 和设置页开开关时广播的那条预览一样：十秒、交接点略过中点、120 BPM */
const PREVIEW_CUE = { seconds: 10, crossover: 0.55, periodSec: 0.5 };

/** 几个差别够大的主题色，用来看「同色系摆开」在饱和色和灰色上分别是什么样 */
const ACCENTS = ['#e8763c', '#4f8cf7', '#22c58b', '#c05fd8', '#fafafa'];

const NowPlayingToastTransitionBorderProbe: React.FC = () => {
    const [isDaylight, setIsDaylight] = React.useState(false);
    const [transitionBorder, setTransitionBorder] = React.useState(true);
    const [isNextUp, setIsNextUp] = React.useState(false);
    const [accent, setAccent] = React.useState(ACCENTS[0]);
    // 点卡片的动作在真实 app 里按页面分岔（首页跳播放页，播放页展开歌曲卡片），这里只数次数：
    // 要验的是外层那层 pointer-events-none 之下这个 button 真的收得到点击。
    const [activations, setActivations] = React.useState(0);

    // cue 到达时开关是从 store 里读的，所以这个探针要把两个设置真的拨上去，不能只给 prop。
    React.useEffect(() => {
        useSettingsUiStore.setState({ transitionAnimation: transitionBorder, transitionMode: 'automix' });
    }, [transitionBorder]);

    const buttonClass = 'rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/10';

    return (
        <div className={`min-h-screen p-8 ${isDaylight ? 'bg-zinc-200' : 'bg-zinc-900'}`}>
            <div className="flex flex-wrap gap-2">
                <button type="button" data-probe-action="cue" className={buttonClass} onClick={() => announceTransition(PREVIEW_CUE)}>
                    广播一次混音（10s）
                </button>
                <button type="button" data-probe-action="end" className={buttonClass} onClick={() => announceTransition(null)}>
                    提前结束
                </button>
                <button
                    type="button"
                    data-probe-action="settings-preview"
                    className={buttonClass}
                    onClick={() => {
                        // 一字不差地照抄设置页那个开关：先关掉，再在同一个处理函数里拨上去并立刻
                        // 广播预览。React 要等这次事件结束才提交，所以只有「无条件订阅 + cue 到达
                        // 时读 store」才收得到这一条。
                        useSettingsUiStore.setState({ transitionAnimation: false });
                        setTransitionBorder(true);
                        useSettingsUiStore.setState({ transitionAnimation: true, transitionMode: 'automix' });
                        announceTransition(PREVIEW_CUE);
                    }}
                >
                    照抄设置页开关（同步广播）
                </button>
                <button type="button" className={buttonClass} onClick={() => setTransitionBorder(v => !v)}>
                    描边：{transitionBorder ? '开' : '关'}
                </button>
                <button type="button" className={buttonClass} onClick={() => setIsNextUp(v => !v)}>
                    接下来播放：{isNextUp ? '开' : '关'}
                </button>
                <button type="button" className={buttonClass} onClick={() => setIsDaylight(v => !v)}>
                    {isDaylight ? '白天' : '夜晚'}
                </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className={`text-xs ${isDaylight ? 'text-zinc-600' : 'text-zinc-400'}`}>accentColor</span>
                {ACCENTS.map(color => (
                    <button
                        key={color}
                        type="button"
                        data-probe-accent={color}
                        onClick={() => setAccent(color)}
                        className={`h-6 w-6 rounded-full border-2 ${accent === color ? 'border-white' : 'border-white/20'}`}
                        style={{ backgroundColor: color }}
                        aria-label={color}
                    />
                ))}
            </div>
            <p className={`mt-4 text-xs ${isDaylight ? 'text-zinc-600' : 'text-zinc-400'}`}>
                卡片在左下角。模式是「限时显示」、时长取最短的 3 秒，所以先等它自己淡出，再广播混音——
                描边要能把它重新撑开。点卡片的次数：<span data-probe-activations={activations}>{activations}</span>
            </p>

            <NowPlayingToast
                song={SONG}
                trackKey="probe-track"
                isDaylight={isDaylight}
                mode="auto"
                timeoutSec={3}
                nextUp={NEXT_UP}
                isNextUp={isNextUp}
                transitionBorder={transitionBorder}
                theme={{ accentColor: accent } as never}
                onActivate={() => setActivations(count => count + 1)}
                activateLabel="展开歌曲卡片"
            />
        </div>
    );
};

const definition: ProbeDefinition = {
    id: 'nowPlayingToastTransitionBorder',
    title: 'Now playing 卡片的混音进度描边',
    description: 'automix 过渡动画和歌曲信息卡片同时开着时，全屏圆环让位给卡片边框上的进度描边。',
    Component: NowPlayingToastTransitionBorderProbe,
};

export default definition;
