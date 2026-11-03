import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Group, PictureChecks, Row, Value, type SettingsGroupDef } from '../../modal/settings/kit';
import { drawRandomPoolChoice } from './lyricStyleChoices';
import { useRandomPool } from './useRandomPool';

// src/components/visualizer/random/RandomPoolGroup.tsx
// The 歌词动画 tab of the lyric style window while 随机 is chosen on the shelf: the random pool as
// tiles of the built-in styles, each switched on and off by itself, and the style this song drew.
// A tile shows the style's glyph, not a live picture: the shelf above has those already, and
// fourteen more would only cost. No style's own options are here: random plays each style with
// the tuning it keeps.

const GROUP: SettingsGroupDef = { id: 'random-visualizer-modes', titleKey: 'options.randomPool' };

const RandomPoolGroup: React.FC = () => {
    const { t } = useTranslation();
    const pool = useRandomPool();
    const gridRef = useRef<HTMLDivElement>(null);

    return (
        <Group
            def={GROUP}
            action={(
                <span className="flex items-center gap-1.5">
                    <span className="text-xs text-[color:var(--st-t3)]">{pool.countLabel}</span>
                    <Button variant="quiet" disabled={pool.allOn} onClick={() => pool.selectAll(gridRef.current)}>{t('options.randomVisualizerSelectAll')}</Button>
                </span>
            )}
            foot={t('options.randomPoolDesc')}
        >
            <Row label={t('options.randomVisualizerCurrentStyle')}>
                <Value>{pool.currentLabel}</Value>
            </Row>
            <div ref={gridRef} className="pb-3 pt-1">
                <PictureChecks
                    value={pool.modes}
                    options={pool.options}
                    picture={drawRandomPoolChoice}
                    columns={4}
                    compact
                    onChange={pool.setModes}
                    least={1}
                    onRefuse={pool.refuse}
                    label={t('options.randomPool')}
                />
            </div>
        </Group>
    );
};

export default RandomPoolGroup;
