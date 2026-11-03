import React, { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useLyricMatchSources } from '../../../../hooks/useLyricMatchSources';
import { resyncAllFolders } from '../../../../services/localMusicService';
import { useLyricSettingsStore } from '../../../../stores/useLyricSettingsStore';
import { setStatusMessage } from '../../../../stores/useStatusMessageStore';
import { DEFAULT_LOCAL_LYRIC_FORMAT_ORDER, isSameLocalLyricFormatOrder, type LocalLyricFileFormat } from '../../../../utils/lyrics/localLyricFormatOrder';
import { getLyricProviderPreferenceLabel } from '../../../../utils/lyrics/lyricSourceLabels';
import { DEFAULT_PREFERRED_LYRIC_SOURCE } from '../../../../utils/lyrics/sourcePriority';
import { Button, FoldedGroup, Group, OrderList, Reveal, Row, Segmented, Select, Toggle, Value, option, type SettingsGroupDef, type SettingsOptionDef } from '../kit';
import { useSettingsPage } from './settingsPageContext';

// src/components/modal/settings/pages/LyricsPage.tsx
// The 歌词 page: where a song's lyrics come from, the two tools that shift and filter them (their
// rows open the existing dialogs), and a folded group with the order in which lyric files beside a
// local song are preferred.

const SOURCE: SettingsGroupDef = { id: 'lyrics', titleKey: 'options.settingsHeadingLyricSource' };
const ADJUST: SettingsGroupDef = { id: 'lyricAdjust', titleKey: 'options.settingsHeadingLyricTiming' };
const FORMATS: SettingsGroupDef = { id: 'localLyricFormatOrder', titleKey: 'options.localLyricFormatOrder' };

const O = {
    autoBest: option(SOURCE, 'autoUseBestLyric', 'options.autoUseBestLyric'),
    matchPriority: option(SOURCE, 'lyricMatchPriority', 'settings.lyricMatchPriority'),
    localPriority: option(SOURCE, 'localLyricsPriority', 'options.localLyricsPriority'),
    globalOffset: option(ADJUST, 'globalLyricTimelineOffset', 'options.globalLyricTimelineOffset'),
    filter: option(ADJUST, 'lyricFilterRegex', 'options.lyricFilterRegex'),
    formatOrder: option(FORMATS, 'localLyricFormatOrderList', 'options.localLyricFormatOrderList'),
};

export const OPTIONS: SettingsOptionDef[] = Object.values(O);

const LyricsPage: React.FC = () => {
    const { t } = useTranslation();
    const { onOpenGlobalLyricOffsetSettings, onOpenLyricFilterSettings } = useSettingsPage().viewProps.playback;
    const lyric = useLyricSettingsStore(useShallow(state => ({
        autoBest: state.autoUseBestLyric,
        preferredSource: state.preferredAlternativeLyricSource,
        localPriority: state.localLyricsPriority,
        formatOrder: state.localLyricFormatOrder,
        globalOffsetMs: state.globalLyricTimelineOffsetMs,
        setAutoBest: state.handleToggleAutoUseBestLyric,
        setPreferredSource: state.handleSetPreferredAlternativeLyricSource,
        setLocalPriority: state.handleSetLocalLyricsPriority,
        setFormatOrder: state.handleSetLocalLyricFormatOrder,
    })));
    const sources = useLyricMatchSources();
    // A choice that is not on offer now is not in force either: the matcher falls back the same way.
    const shownSource = sources.includes(lyric.preferredSource) ? lyric.preferredSource : DEFAULT_PREFERRED_LYRIC_SOURCE;

    // A new order only applies on the next scan of the local folders, so a change offers one.
    const [needsResync, setNeedsResync] = useState(false);
    const [isResyncing, setIsResyncing] = useState(false);
    const applyFormatOrder = (next: LocalLyricFileFormat[]) => {
        lyric.setFormatOrder(next);
        setNeedsResync(true);
    };
    // The scan tells the library itself that the songs changed; nothing to pass on from here.
    const resync = async () => {
        setIsResyncing(true);
        try {
            const importedSongs = await resyncAllFolders();
            setNeedsResync(false);
            setStatusMessage({
                type: importedSongs === null ? 'info' : 'success',
                text: t(importedSongs === null ? 'options.localLyricFormatResyncNoFolders' : 'options.localLyricFormatResyncDone'),
            });
        } catch (error) {
            console.error('[LocalLyricFormatOrder] Failed to resync local folders:', error);
            setStatusMessage({ type: 'error', text: t('options.localLyricFormatResyncFailed') });
        } finally {
            setIsResyncing(false);
        }
    };

    return (
        <>
            <Group def={SOURCE}>
                <Row option={O.autoBest} note={t(sources.includes('spotify') ? 'options.autoUseBestLyricDescSpotify' : 'options.autoUseBestLyricDesc')}>
                    <Toggle checked={lyric.autoBest} onChange={lyric.setAutoBest} />
                </Row>
                <Row option={O.matchPriority} note={t('settings.lyricMatchPriorityDesc')}>
                    <Select
                        value={shownSource}
                        options={sources.map(source => ({ value: source, label: getLyricProviderPreferenceLabel(source) }))}
                        onChange={lyric.setPreferredSource}
                    />
                </Row>
                <Row
                    option={O.localPriority}
                    hint={t(lyric.localPriority === 'local' ? 'options.localLyricsPriorityLocalDesc' : 'options.localLyricsPriorityOnlineDesc')}
                    note={t('options.localLyricsPriorityDesc')}
                >
                    <Segmented
                        value={lyric.localPriority}
                        options={[
                            { value: 'local', label: t('options.localLyricsPriorityLocal') },
                            { value: 'online', label: t('options.localLyricsPriorityOnline') },
                        ]}
                        onChange={lyric.setLocalPriority}
                    />
                </Row>
            </Group>

            <Group def={ADJUST}>
                <Row option={O.globalOffset} hint={t('options.globalLyricTimelineOffsetDesc')} onClick={onOpenGlobalLyricOffsetSettings}>
                    <Value>{`${lyric.globalOffsetMs > 0 ? '+' : ''}${lyric.globalOffsetMs} ms`}</Value>
                </Row>
                <Row option={O.filter} hint={t('options.lyricFilterRegexDesc')} onClick={onOpenLyricFilterSettings} />
            </Group>

            <FoldedGroup def={FORMATS} summary={t('options.localLyricFormatOrderFirst', { format: `.${lyric.formatOrder[0]}` })}>
                <Row
                    option={O.formatOrder}
                    hint={t('options.localLyricFormatOrderDesc')}
                    below={(
                        <OrderList
                            items={lyric.formatOrder.map(format => ({ id: format, label: `.${format}` }))}
                            onChange={applyFormatOrder}
                        />
                    )}
                >
                    <Button
                        icon={RotateCcw}
                        onClick={() => applyFormatOrder([...DEFAULT_LOCAL_LYRIC_FORMAT_ORDER])}
                        disabled={isSameLocalLyricFormatOrder(lyric.formatOrder, DEFAULT_LOCAL_LYRIC_FORMAT_ORDER)}
                    >
                        {t('options.localLyricFormatOrderReset')}
                    </Button>
                </Row>
                <Reveal when={needsResync}>
                    <Row notice={t('options.localLyricFormatResyncHint')}>
                        <Button onClick={() => void resync()} disabled={isResyncing}>
                            {t(isResyncing ? 'options.localLyricFormatResyncing' : 'options.localLyricFormatResync')}
                        </Button>
                    </Row>
                </Reveal>
            </FoldedGroup>
        </>
    );
};

export default LyricsPage;
