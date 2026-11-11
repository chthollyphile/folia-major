import React from 'react';
import type { SubtitleOverlayFollowRow, SubtitleOverlayLayout } from '../../../types';
import { Reveal, Row, Segmented, Select, Toggle } from '../../modal/settings/kit';
import {
    getSubtitleOverlayRowCount,
    getSubtitleOverlayRows,
    SUBTITLE_OVERLAY_FOLLOW_ROWS,
    SUBTITLE_OVERLAY_SINGLE_ROWS,
    subtitleOverlayPreviewsUpcoming,
    withSubtitleOverlayRow,
    withSubtitleOverlayRowCount,
    withSubtitleOverlayUpcomingPreview,
    type SubtitleOverlayRowCount,
    type SubtitleOverlaySingleRow,
} from '../../../utils/lyrics/subtitleOverlayLayout';

// src/components/visualizer/window/SubtitleOverlayRowsSetting.tsx
// The bottom subtitle's rows in the lyric style window's 字幕 page: how many, then what each one shows.
// The first row can be the translation or the romanization as well as the current line, so a stack can leave the
// original text out. A layout without the current line also says what a line with none of its content shows:
// the coming lyrics, or nothing.

const ROW_COUNT_KEYS: Record<SubtitleOverlayRowCount, string> = {
    1: 'options.subtitleOverlayRowsOne',
    2: 'options.subtitleOverlayRowsTwo',
    3: 'options.subtitleOverlayRowsThree',
};

const SOURCE_KEYS: Record<SubtitleOverlaySingleRow | SubtitleOverlayFollowRow, string> = {
    current: 'options.subtitleOverlaySourceCurrent',
    next: 'options.subtitleOverlaySourceNext',
    translation: 'options.subtitleContentTranslation',
    romanization: 'options.subtitleContentRomanization',
};

const ROW_LABEL_KEYS = ['options.subtitleOverlayRow1', 'options.subtitleOverlayRow2', 'options.subtitleOverlayRow3'];

type CountValue = `${SubtitleOverlayRowCount}`;

interface SubtitleOverlayRowsSettingProps {
    t: (key: string) => string;
    layout: SubtitleOverlayLayout;
    onChange?: (layout: SubtitleOverlayLayout) => void;
}

const SubtitleOverlayRowsSetting: React.FC<SubtitleOverlayRowsSettingProps> = ({ t, layout, onChange }) => {
    const rows = getSubtitleOverlayRows(layout);
    const count = getSubtitleOverlayRowCount(layout);
    const disabled = !onChange;
    const countOptions = ([1, 2, 3] as const).map(value => ({ value: String(value) as CountValue, label: t(ROW_COUNT_KEYS[value]) }));
    const singleOptions = SUBTITLE_OVERLAY_SINGLE_ROWS.map(value => ({ value, label: t(SOURCE_KEYS[value]) }));
    const followOptions = SUBTITLE_OVERLAY_FOLLOW_ROWS.map(value => ({ value, label: t(SOURCE_KEYS[value]) }));
    const followRow = (index: 1 | 2) => (
        <Row sub label={t(ROW_LABEL_KEYS[index])}>
            <Select<SubtitleOverlayFollowRow>
                value={(rows[index] ?? 'next') as SubtitleOverlayFollowRow}
                options={followOptions}
                disabled={disabled}
                onChange={source => onChange?.(withSubtitleOverlayRow(layout, index, source))}
            />
        </Row>
    );

    return (
        <>
            <Row label={t('options.subtitleOverlayRows')} note={t('options.subtitleOverlayRowsDesc')}>
                <Segmented<CountValue>
                    value={String(count) as CountValue}
                    options={countOptions}
                    disabled={disabled}
                    onChange={next => onChange?.(withSubtitleOverlayRowCount(layout, Number(next) as SubtitleOverlayRowCount))}
                />
            </Row>
            <Row sub label={t(ROW_LABEL_KEYS[0])}>
                <Select<SubtitleOverlaySingleRow>
                    value={rows[0] as SubtitleOverlaySingleRow}
                    options={singleOptions}
                    disabled={disabled}
                    onChange={source => onChange?.(withSubtitleOverlayRow(layout, 0, source))}
                />
            </Row>
            <Reveal when={count >= 2}>{followRow(1)}</Reveal>
            <Reveal when={count === 3}>{followRow(2)}</Reveal>
            <Reveal when={rows[0] !== 'current'}>
                <Row sub label={t('options.subtitleOverlayUpcomingFallback')} note={t('options.subtitleOverlayUpcomingFallbackDesc')}>
                    <Toggle
                        checked={subtitleOverlayPreviewsUpcoming(layout)}
                        disabled={disabled}
                        onChange={next => onChange?.(withSubtitleOverlayUpcomingPreview(layout, next))}
                    />
                </Row>
            </Reveal>
        </>
    );
};

export default SubtitleOverlayRowsSetting;
