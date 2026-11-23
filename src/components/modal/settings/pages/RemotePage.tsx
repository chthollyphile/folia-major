import React from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useDesktopSettingsStore } from '../../../../stores/useDesktopSettingsStore';
import type { RemoteLyricMainRow, RemoteLyricSubRow } from '../../../../types/remoteControl';
import { REMOTE_LYRIC_MAIN_ROWS, REMOTE_LYRIC_SUB_ROWS, withRemoteLyricPairs, withRemoteLyricRow } from '../../../../utils/remoteLyricLayout';
import { Group, Reveal, Row, Segmented, Select, Toggle, option, type SettingsGroupDef } from '../kit';
import { ALPHA_EXPORT_OPTIONS, AlphaExportFfmpegGroup } from './videoExport/AlphaExportFfmpegGroup';

// src/components/modal/settings/pages/RemotePage.tsx
// The Remote Control page (desktop app only): the remote window's own switches, and its lyric rows,
// one pair or two, each row chosen like the bottom subtitle's rows. The remote window's settings key
// (top left) opens the dialog here. Its export tab's transparent formats need a full ffmpeg: the
// group that says which one is used is the last one here.

const WINDOW: SettingsGroupDef = { id: 'remoteControl', titleKey: 'options.remoteControlWindowGroup', electronOnly: true };
const LYRICS: SettingsGroupDef = { id: 'remoteLyrics', titleKey: 'options.remoteLyricsGroup', electronOnly: true };

const O = {
    remoteTaskbarIcon: option(WINDOW, 'hideRemoteControlTaskbarIcon', 'options.hideRemoteControlTaskbarIcon'),
    remoteTitlebar: option(WINDOW, 'hideRemoteControlTitlebar', 'options.hideRemoteControlTitlebar'),
    remoteClickThrough: option(WINDOW, 'remoteControlClickThrough', 'options.remoteControlClickThrough'),
    remoteExpandCover: option(WINDOW, 'remoteControlExpandCover', 'options.remoteControlExpandCover'),
    remoteTextShade: option(WINDOW, 'remoteControlTextShade', 'options.remoteControlTextShade'),
    lyricPairs: option(LYRICS, 'remoteLyricPairs', 'options.remoteLyricPairs'),
    lyricRow1: option(LYRICS, 'remoteLyricRow1', 'options.remoteLyricRow1'),
    lyricRow2: option(LYRICS, 'remoteLyricRow2', 'options.remoteLyricRow2'),
    lyricRow3: option(LYRICS, 'remoteLyricRow3', 'options.remoteLyricRow3'),
    lyricRow4: option(LYRICS, 'remoteLyricRow4', 'options.remoteLyricRow4'),
};

export const OPTIONS = [...Object.values(O), ...Object.values(ALPHA_EXPORT_OPTIONS)];

const MAIN_ROW_KEYS: Record<RemoteLyricMainRow, string> = {
    original: 'options.remoteLyricSourceOriginal',
    translation: 'options.subtitleContentTranslation',
    romanization: 'options.subtitleContentRomanization',
};

const SUB_ROW_KEYS: Record<RemoteLyricSubRow, string> = {
    auto: 'options.remoteLyricSourceAuto',
    translation: 'options.subtitleContentTranslation',
    romanization: 'options.subtitleContentRomanization',
    original: 'options.remoteLyricSourceOriginal',
    none: 'options.remoteLyricSourceNone',
};

type PairsValue = '1' | '2';

const RemotePage: React.FC = () => {
    const { t } = useTranslation();
    const desktop = useDesktopSettingsStore(useShallow(state => ({
        remoteTaskbarIcon: state.hideRemoteControlTaskbarIcon,
        remoteTitlebar: state.hideRemoteControlTitlebar,
        remoteClickThrough: state.remoteControlClickThrough,
        remoteExpandCover: state.remoteControlExpandCover,
        remoteTextShade: state.remoteControlTextShade,
        setRemoteTaskbarIcon: state.handleToggleHideRemoteControlTaskbarIcon,
        setRemoteTitlebar: state.handleToggleHideRemoteControlTitlebar,
        setRemoteClickThrough: state.handleToggleRemoteControlClickThrough,
        setRemoteExpandCover: state.handleToggleRemoteControlExpandCover,
        setRemoteTextShade: state.handleToggleRemoteControlTextShade,
    })));
    const layout = useDesktopSettingsStore(state => state.remoteControlLyricLayout);
    const setLayout = useDesktopSettingsStore(state => state.handleSetRemoteControlLyricLayout);
    const mainOptions = REMOTE_LYRIC_MAIN_ROWS.map(value => ({ value, label: t(MAIN_ROW_KEYS[value]) }));
    const subOptions = REMOTE_LYRIC_SUB_ROWS.map(value => ({ value, label: t(SUB_ROW_KEYS[value]) }));
    const [main1, sub1, main2, sub2] = layout.rows;

    return (
        <>
            <Group def={WINDOW}>
                <Row option={O.remoteTaskbarIcon}>
                    <Toggle checked={desktop.remoteTaskbarIcon} onChange={desktop.setRemoteTaskbarIcon} />
                </Row>
                <Row option={O.remoteTitlebar} hint={t('options.hideRemoteControlTitlebarHint')} note={t('options.hideRemoteControlTitlebarDesc')}>
                    <Toggle checked={desktop.remoteTitlebar} onChange={desktop.setRemoteTitlebar} />
                </Row>
                <Row option={O.remoteClickThrough} hint={t('options.remoteControlClickThroughHint')} note={t('options.remoteControlClickThroughDesc')}>
                    <Toggle checked={desktop.remoteClickThrough} onChange={desktop.setRemoteClickThrough} />
                </Row>
                <Row option={O.remoteExpandCover} hint={t('options.remoteControlExpandCoverHint')}>
                    <Toggle checked={desktop.remoteExpandCover} onChange={desktop.setRemoteExpandCover} />
                </Row>
                {/* Not greyed out: the transparent background is chosen in the remote window itself, so this page cannot tell. */}
                <Row option={O.remoteTextShade} hint={t('options.remoteControlTextShadeHint')}>
                    <Toggle checked={desktop.remoteTextShade} onChange={desktop.setRemoteTextShade} />
                </Row>
            </Group>

            <Group def={LYRICS}>
                <Row option={O.lyricPairs} note={t('options.remoteLyricPairsDesc')}>
                    <Segmented<PairsValue>
                        value={String(layout.pairs) as PairsValue}
                        options={[
                            { value: '1', label: t('options.remoteLyricPairsOne') },
                            { value: '2', label: t('options.remoteLyricPairsTwo') },
                        ]}
                        onChange={next => setLayout(withRemoteLyricPairs(layout, next === '2' ? 2 : 1))}
                    />
                </Row>
                <Row sub option={O.lyricRow1}>
                    <Select<RemoteLyricMainRow>
                        value={main1}
                        options={mainOptions}
                        onChange={row => setLayout(withRemoteLyricRow(layout, 0, row))}
                    />
                </Row>
                <Row sub option={O.lyricRow2} hint={sub1 === 'auto' ? t('options.remoteLyricSourceAutoHint') : undefined}>
                    <Select<RemoteLyricSubRow>
                        value={sub1}
                        options={subOptions}
                        onChange={row => setLayout(withRemoteLyricRow(layout, 1, row))}
                    />
                </Row>
                <Reveal when={layout.pairs === 2}>
                    <Row sub option={O.lyricRow3}>
                        <Select<RemoteLyricMainRow>
                            value={main2}
                            options={mainOptions}
                            onChange={row => setLayout(withRemoteLyricRow(layout, 2, row))}
                        />
                    </Row>
                    <Row sub option={O.lyricRow4}>
                        <Select<RemoteLyricSubRow>
                            value={sub2}
                            options={subOptions}
                            onChange={row => setLayout(withRemoteLyricRow(layout, 3, row))}
                        />
                    </Row>
                </Reveal>
            </Group>

            <AlphaExportFfmpegGroup />
        </>
    );
};

export default RemotePage;
