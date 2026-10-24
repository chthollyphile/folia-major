import React, { useCallback, useState } from 'react';
import LyricFilterSettingsModal from '../../src/components/modal/LyricFilterSettingsModal';
import type { LyricFilterDraft } from '../../src/components/modal/LyricFilterSettingsModal';
import { parseLyricsByFormat } from '../../src/utils/lyrics/parserCore';
import { DEFAULT_LYRIC_STAFF_ABSORB_MODE, DEFAULT_LYRIC_STAFF_MIN_DWELL_SECONDS } from '../../src/utils/lyrics/staffCreditsPolicy';
import type { ProbeDefinition } from './definition';
// dev/probes/lyricFilterModal.probe.tsx

/**
 * 歌词过滤面板整体。
 *
 * 主要盯保存按钮的可用性：自定义识别规则填了非法正则后切到「始终显示」，输入框和报错
 * 都会收起来，此时按钮必须重新可点——否则用户只能切回去清空，界面上却看不到原因。
 * 这类「校验对象已经不在屏幕上了」的状态，单测和整应用截图都不容易盯住。
 */
const SAMPLE = [
    '[00:00.00]作词 Lyricist：A',
    '[00:00.20]作曲 Composer：B',
    '[00:00.40]编曲 Arranger：C',
    '[00:03.00]第一句歌词',
    '[00:07.00]第二句歌词',
].join('\n');

const LyricFilterModalProbe: React.FC = () => {
    const [savedDraft, setSavedDraft] = useState<LyricFilterDraft | null>(null);
    const loadPreviewLyrics = useCallback(async () => parseLyricsByFormat('lrc', SAMPLE), []);

    return (
        <div className="min-h-screen bg-zinc-950">
            <div data-probe-saved-draft={savedDraft ? JSON.stringify(savedDraft) : ''} />
            <LyricFilterSettingsModal
                isOpen
                isDaylight={false}
                currentSongTitle="某首歌"
                initialRules={[]}
                initialStaffPolicy="smart"
                initialStaffMinDwellSeconds={DEFAULT_LYRIC_STAFF_MIN_DWELL_SECONDS}
                initialStaffAbsorbMode={DEFAULT_LYRIC_STAFF_ABSORB_MODE}
                initialStaffPattern=""
                loadPreviewLyrics={loadPreviewLyrics}
                onClose={() => {}}
                onSave={setSavedDraft}
            />
        </div>
    );
};

const probe: ProbeDefinition = {
    id: 'lyricFilterModal',
    title: '歌词过滤面板',
    description: '两套机制的开关归属，以及非法 staff 正则被收起后保存按钮能否恢复',
    Component: LyricFilterModalProbe,
};

export default probe;
