import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { buildCurrentObsUrl } from '../../../../services/obs/currentObsUrl';
import { buildObsCustomCss } from '../../../../services/obs/obsCustomCss';
import { computeHasUploadedObsAsset, resolveObsCopyHintKey } from '../../../../services/obs/visualSettingsConfig';
import { resolveWebObsTarget } from '../../../../services/obs/webObsTarget';
import { useStageSettingsStore } from '../../../../stores/useStageSettingsStore';
import { setStatusMessage } from '../../../../stores/useStatusMessageStore';
import { useVisualizerAssetStore } from '../../../../stores/useVisualizerAssetStore';
import { useVisualizerSettingsStore } from '../../../../stores/useVisualizerSettingsStore';
import { CopyButton, Row, Segmented } from '../kit';

// src/components/modal/settings/pages/ObsLinkRows.tsx
// The web build's link for an OBS browser source, two rows: which theme the link carries, and the
// buttons that copy the link and, while an uploaded picture is in use, the CSS that carries it.
// Drawn under the stage mode of 连接与集成 and beside the config code of 存储与备份, in both
// places only while a web stage source is on: the link is for that source.

const THEME_MODE_HINT = {
    static: 'options.obsThemeModeStaticHint',
    builtin: 'options.obsThemeModeBuiltinHint',
    ai: 'options.obsThemeModeAiHint',
} as const;

type ObsLinkRowsProps = {
    /** Indented under the row above. */
    sub?: boolean;
};

export const ObsLinkRows: React.FC<ObsLinkRowsProps> = ({ sub }) => {
    const { t } = useTranslation();
    const themeMode = useStageSettingsStore(state => state.webObsThemeMode);
    const setThemeMode = useStageSettingsStore(state => state.setWebObsThemeMode);
    // The link cannot carry an uploaded picture; the CSS button shows only while one is in use.
    const hasUploadedAsset = computeHasUploadedObsAsset({
        ...useVisualizerSettingsStore(useShallow(state => ({
            monetBackgroundTuning: state.monetBackgroundTuning,
            nomandBackgroundTuning: state.nomandBackgroundTuning,
            monetTuning: state.monetTuning,
            cappellaTuning: state.cappellaTuning,
        }))),
        ...useVisualizerAssetStore(useShallow(state => ({
            monetBackgroundImage: state.monetBackgroundImage,
            monetPortraitImage: state.monetPortraitImage,
            cappellaCustomEmojiImages: state.cappellaCustomEmojiImages,
            cappellaCustomAvatarImages: state.cappellaCustomAvatarImages,
        }))),
    });

    /** The link for the web stage source that is on. */
    const obsUrl = async () => {
        const target = resolveWebObsTarget();
        if (!target) {
            throw new Error('No web stage source is on');
        }
        return buildCurrentObsUrl(target.source, target.host, target.extra);
    };

    /** Once the link is on the clipboard: says so when it needs a font or the CSS to look the same in OBS. */
    const sayLinkNote = () => {
        const hint = resolveObsCopyHintKey();
        if (hint.type === 'info') {
            setStatusMessage({ type: 'info', text: t(hint.key) });
        }
    };

    // The note on where the CSS goes, made with the CSS and said once the clipboard has it.
    const cssNoteRef = useRef('');

    /** The CSS that carries the uploaded pictures. */
    const obsCss = async () => {
        const result = await buildObsCustomCss();
        if (!result) {
            throw new Error('No uploaded asset is in use');
        }
        cssNoteRef.current = result.degradedGifCount > 0
            ? t('options.obsCssCopiedHintDegraded', { count: result.degradedGifCount })
            : t('options.obsCssCopiedHint');
        return result.css;
    };

    return (
        <>
            <Row sub={sub} label={t('options.obsThemeMode')} hint={t(THEME_MODE_HINT[themeMode])}>
                <Segmented
                    value={themeMode}
                    options={[
                        { value: 'static', label: t('options.obsThemeModeStatic') },
                        { value: 'builtin', label: t('options.obsThemeModeBuiltin') },
                        { value: 'ai', label: t('options.obsThemeModeAi') },
                    ]}
                    onChange={setThemeMode}
                />
            </Row>
            <Row sub={sub}>
                {hasUploadedAsset && (
                    <CopyButton text={obsCss} onCopied={() => setStatusMessage({ type: 'info', text: cssNoteRef.current })}>
                        {t('options.copyObsCss')}
                    </CopyButton>
                )}
                <CopyButton text={obsUrl} onCopied={sayLinkNote}>{t('options.copyObsUrl')}</CopyButton>
            </Row>
        </>
    );
};

export default ObsLinkRows;
