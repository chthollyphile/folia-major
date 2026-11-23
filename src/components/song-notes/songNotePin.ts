import { create } from 'zustand';
import type { SongResult } from '../../types';
import i18n from '../../i18n/config';
import { selectDisplaySong, usePlaybackStore } from '../../stores/usePlaybackStore';
import { currentTime } from '../../stores/motionSignals';
import { setStatusMessage } from '../../stores/useStatusMessageStore';
import { isStagePlaybackSong } from '../../utils/appPlaybackGuards';
import { formatNoteAt } from './songNotesModel';
import { writeSongComment } from './songNoteActions';

// src/components/song-notes/songNotePin.ts
// 「记下这个时刻」：胶囊右侧可自定义槽位里的一个动作（playerControlSlotActions 的 mark-moment），
// 不常驻在进度条上。点了记下此刻的位置，在按下的那个按钮上方弹出一个小输入框（SongNotePinHost 挂在 App 上，全局一份）。
// 这里只放状态和入口，不带组件，槽位模块引它不会把弹框的 React 树和样式一起拉进来。

export type SongNotePinPending = { song: SongResult; at: number; anchor: DOMRect };

type SongNotePinState = {
    pending: SongNotePinPending | null;
    /** 上一次是点空白处（输入框失焦）取消的时刻：紧跟着的那一下点在槽位上，是想收起，不是再开一个。 */
    blurClosedAt: number;
};

export const useSongNotePinStore = create<SongNotePinState>(() => ({ pending: null, blurClosedAt: 0 }));

/** 屏幕上正在播的那首（自动混音过渡中是淡入的下一首）；舞台歌不算。 */
export const playingNoteSong = (): SongResult | null => {
    const song = selectDisplaySong(usePlaybackStore.getState());
    return song && !isStagePlaybackSong(song) ? song : null;
};

/** 不弹框，直接在此刻留一道刻痕（命令面板的「记下这个时刻」，和拿不到按钮位置的槽位）。 */
export const markSongMoment = () => {
    const song = playingNoteSong();
    if (!song) return;
    const at = currentTime.get();
    void writeSongComment(song, '', at).then(result => {
        if (result.ok) setStatusMessage({ type: 'success', text: i18n.t('songNotes.markedAt', { at: formatNoteAt(at) }) });
    });
};

/** 槽位按钮点下：记下此刻，在 anchor 上方弹框。 */
export const openSongNotePin = (anchor?: DOMRect) => {
    const state = useSongNotePinStore.getState();
    if (state.pending) return;
    // 弹框开着时点这个按钮：按下先让输入框失焦、取消收起，随后的 click 不该再开一个新的。
    if (performance.now() - state.blurClosedAt < 400) return;
    if (!anchor) {
        markSongMoment();
        return;
    }
    const song = playingNoteSong();
    if (!song) return;
    useSongNotePinStore.setState({ pending: { song, at: currentTime.get(), anchor } });
};

export const closeSongNotePin = (byBlur: boolean) => {
    useSongNotePinStore.setState(byBlur ? { pending: null, blurClosedAt: performance.now() } : { pending: null });
};
