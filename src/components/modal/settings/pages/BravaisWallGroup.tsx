import React from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { isBravaisLibraryActive, useIsBravaisLibraryActive } from '../../../../library/app/bravaisLibraryActive';
import { useLibraryWallLookStore } from '../../../../stores/useLibraryWallLookStore';
import {
    LIBRARY_WALL_LOOKS,
    LIBRARY_WALL_WINDOW_COUNTS,
    libraryWallWindowSharePercent,
    type LibraryWallLook,
} from '../../../../utils/libraryWallLook';
import {
    LIBRARY_WALL_SEAM_STYLE_LABEL_KEYS,
    LIBRARY_WALL_SEAM_STYLE_LOOKS,
    LIBRARY_WALL_SEAM_STYLES,
    type LibraryWallSeamStyle,
} from '../../../../utils/libraryWallSeamStyle';
import { LIBRARY_WALL_SEAM_DIRECTIONS, LIBRARY_WALL_SEAM_DIRECTION_TEXT } from '../../../../utils/libraryWallSeamDirection';
import { Group, PictureChoice, Reveal, Row, Segmented, Toggle, option, type SettingsGroupDef } from '../kit';

// src/components/modal/settings/pages/BravaisWallGroup.tsx
// The Bravais 墙面 group of the 主页与歌单 page: every setting only the bravais library UI has. How
// much of the wall lets the visualizer through (and, when partly, how many windows a block has),
// the collections' stack edges, which way the seam opens (vertical, horizontal, or by the screen's
// shape, either way round), the seam's material (always clear, or one of eight solid
// presets; the two exclude each other), and whether the picture behind the wall has lyrics and
// blur. The group is drawn only while bravais is the library UI in effect, the same test the
// command palette asks (isBravaisLibraryActive): under any other UI these settings do nothing.
// The look and the window count are not in the config export (useLibraryWallLookStore says why);
// the rest are (pages/storage/visualConfigTransfer).

export const BRAVAIS_WALL: SettingsGroupDef = { id: 'bravaisSettings', titleKey: 'options.bravaisSettings', available: isBravaisLibraryActive };

const O = {
    look: option(BRAVAIS_WALL, 'libraryWallLook', 'options.libraryWallLook'),
    windows: option(BRAVAIS_WALL, 'libraryWallWindows', 'options.libraryWallWindows'),
    stackEdges: option(BRAVAIS_WALL, 'bravaisStackEdges', 'options.bravaisStackEdges'),
    seamDirection: option(BRAVAIS_WALL, 'bravaisSeamDirection', 'options.bravaisSeamDirection'),
    seamClear: option(BRAVAIS_WALL, 'bravaisSeamClear', 'options.bravaisSeamClear'),
    seamStyle: option(BRAVAIS_WALL, 'bravaisSeamStyle', 'options.bravaisSeamStyle'),
    backdropLyrics: option(BRAVAIS_WALL, 'bravaisBackdropLyrics', 'options.bravaisBackdropLyrics'),
    backdropBlur: option(BRAVAIS_WALL, 'bravaisBackdropBlur', 'options.bravaisBackdropBlur'),
};

export const BRAVAIS_WALL_OPTIONS = Object.values(O);

const LOOK_KEYS: Record<LibraryWallLook, { label: string; description: string }> = {
    solid: { label: 'options.libraryWallLookSolid', description: 'options.libraryWallLookSolidDesc' },
    partial: { label: 'options.libraryWallLookPartial', description: 'options.libraryWallLookPartialDesc' },
    clear: { label: 'options.libraryWallLookClear', description: 'options.libraryWallLookClearDesc' },
};

/** A seam preset as the wall draws it: its paper, and a glyph in its ink. */
const SeamSwatch: React.FC<{ style: LibraryWallSeamStyle; glyph: string }> = ({ style, glyph }) => {
    const look = LIBRARY_WALL_SEAM_STYLE_LOOKS[style];
    return (
        <span
            className="flex h-full w-full items-center justify-center text-base font-extrabold"
            style={{ background: look.surface, color: look.ink ?? 'var(--st-t1)' }}
        >
            {glyph}
        </span>
    );
};

export const BravaisWallGroup: React.FC = () => {
    const { t } = useTranslation();
    const isBravaisActive = useIsBravaisLibraryActive();
    const wall = useLibraryWallLookStore(useShallow(state => ({
        look: state.look,
        windowsPerBlock: state.windowsPerBlock,
        stackEdges: state.collectionStackEdges,
        seamClear: state.seamClear,
        seamStyle: state.seamStyle,
        backdropLyrics: state.backdropLyrics,
        backdropBlur: state.backdropBlur,
        seamDirection: state.seamDirection,
        setLook: state.setLook,
        setWindowsPerBlock: state.setWindowsPerBlock,
        setStackEdges: state.setCollectionStackEdges,
        setSeamClear: state.setSeamClear,
        setSeamStyle: state.setSeamStyle,
        setBackdropLyrics: state.setBackdropLyrics,
        setBackdropBlur: state.setBackdropBlur,
        setSeamDirection: state.setSeamDirection,
    })));

    if (!isBravaisActive) return null;

    const glyph = t('options.bravaisSeamSwatchGlyph');

    return (
        <Group def={BRAVAIS_WALL}>
            <Row option={O.look} hint={t(LOOK_KEYS[wall.look].description)} note={t('options.libraryWallLookDesc')}>
                <Segmented
                    value={wall.look}
                    options={LIBRARY_WALL_LOOKS.map(look => ({ value: look, label: t(LOOK_KEYS[look].label) }))}
                    onChange={wall.setLook}
                />
            </Row>
            {/* Windows exist only on a partly clear wall. */}
            <Reveal when={wall.look === 'partial'}>
                <Row
                    sub
                    option={O.windows}
                    hint={t('options.libraryWallWindowsOption', { count: wall.windowsPerBlock, percent: libraryWallWindowSharePercent(wall.windowsPerBlock) })}
                    note={t('options.libraryWallWindowsDesc')}
                >
                    <Segmented
                        value={String(wall.windowsPerBlock)}
                        options={LIBRARY_WALL_WINDOW_COUNTS.map(count => ({ value: String(count), label: String(count) }))}
                        onChange={count => wall.setWindowsPerBlock(Number(count))}
                    />
                </Row>
            </Reveal>
            <Row option={O.stackEdges} note={t('options.bravaisStackEdgesDesc')}>
                <Toggle checked={wall.stackEdges} onChange={wall.setStackEdges} />
            </Row>
            <Row option={O.seamDirection} hint={t(LIBRARY_WALL_SEAM_DIRECTION_TEXT[wall.seamDirection].description)} note={t('options.bravaisSeamDirectionDesc')}>
                <Segmented
                    value={wall.seamDirection}
                    options={LIBRARY_WALL_SEAM_DIRECTIONS.map(direction => ({ value: direction, label: t(LIBRARY_WALL_SEAM_DIRECTION_TEXT[direction].label) }))}
                    onChange={wall.setSeamDirection}
                />
            </Row>
            <Row option={O.seamClear} note={t('options.bravaisSeamClearDesc')}>
                <Toggle checked={wall.seamClear} onChange={wall.setSeamClear} />
            </Row>
            {/* A clear seam draws no paper: the presets keep their value and wait until it is off. */}
            <Row
                option={O.seamStyle}
                hint={wall.seamClear ? t('options.bravaisSeamStyleDisabled') : undefined}
                note={t('options.bravaisSeamStyleDesc')}
            >
                <PictureChoice
                    value={wall.seamStyle}
                    options={LIBRARY_WALL_SEAM_STYLES.map(style => ({
                        value: style,
                        label: t(LIBRARY_WALL_SEAM_STYLE_LABEL_KEYS[style]),
                        picture: <SeamSwatch style={style} glyph={glyph} />,
                    }))}
                    onChange={wall.setSeamStyle}
                    disabled={wall.seamClear}
                />
            </Row>
            <Row option={O.backdropLyrics} note={t('options.bravaisBackdropLyricsDesc')}>
                <Toggle checked={wall.backdropLyrics} onChange={wall.setBackdropLyrics} />
            </Row>
            <Row option={O.backdropBlur} note={t('options.bravaisBackdropBlurDesc')}>
                <Toggle checked={wall.backdropBlur} onChange={wall.setBackdropBlur} />
            </Row>
        </Group>
    );
};

export default BravaisWallGroup;
