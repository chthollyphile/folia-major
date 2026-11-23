import React, { useState } from 'react';
import { FolderOpen, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useVideoExportFfmpegStatus } from '../../../../../hooks/useVideoExportFfmpegStatus';
import { isAlphaVideoFormatId, type VideoExportFfmpegProblem } from '../../../../../types/videoExport';
import { Button, Group, Row, Status, option, type SettingsGroupDef } from '../../kit';

// src/components/modal/settings/pages/videoExport/AlphaExportFfmpegGroup.tsx
// The 透明视频导出 group of the Remote Control page (the export lives in that window): which ffmpeg
// the transparent export uses (found by the search, chosen by hand, or none), its version and the
// transparent formats it can write, with "search again", "choose a file" and "back to the search".

export const ALPHA_EXPORT_GROUP: SettingsGroupDef = { id: 'alphaVideoExport', titleKey: 'options.alphaExportGroup', electronOnly: true };

export const ALPHA_EXPORT_OPTIONS = {
    ffmpeg: option(ALPHA_EXPORT_GROUP, 'alphaExportFfmpeg', 'options.alphaExportFfmpeg'),
    formats: option(ALPHA_EXPORT_GROUP, 'alphaExportFormats', 'options.alphaExportFormats'),
};

const FORMAT_LABEL_KEYS = {
    prores: 'options.alphaExportFormatProres',
    vp9: 'options.alphaExportFormatVp9',
    qtrle: 'options.alphaExportFormatQtrle',
} as const;

const PROBLEM_KEYS: Record<VideoExportFfmpegProblem, string> = {
    'not-found': 'options.alphaExportProblemNotFound',
    'not-runnable': 'options.alphaExportProblemNotRunnable',
    'not-ffmpeg': 'options.alphaExportProblemNotFfmpeg',
    'no-rawvideo': 'options.alphaExportProblemNoRawvideo',
    'no-alpha-encoder': 'options.alphaExportProblemNoAlphaEncoder',
};

const problemKey = (problem: VideoExportFfmpegProblem) => PROBLEM_KEYS[problem];

export const AlphaExportFfmpegGroup: React.FC = () => {
    const { t } = useTranslation();
    const { status, busy, refresh, choose, clearChoice } = useVideoExportFfmpegStatus();
    // What the last file chosen in the dialog was refused for, until the next action.
    const [rejected, setRejected] = useState<VideoExportFfmpegProblem | null>(null);
    const O = ALPHA_EXPORT_OPTIONS;

    const sourceText = !status
        ? t('options.alphaExportSearching')
        : status.available
            ? t(status.source === 'manual' ? 'options.alphaExportSourceManual' : 'options.alphaExportSourceAuto', { version: status.version ?? '?' })
            : t('options.alphaExportSourceNone');
    const formats = (status?.formats ?? []).filter(isAlphaVideoFormatId);

    const onChoose = async () => {
        setRejected(null);
        const result = await choose();
        if (result && !result.canceled && !result.ok && result.problem) {
            setRejected(result.problem);
        }
    };

    return (
        <Group def={ALPHA_EXPORT_GROUP}>
            <Row option={O.ffmpeg} hint={status?.path ?? t('options.alphaExportFfmpegHint')} note={t('options.alphaExportFfmpegNote')}>
                <Status tone={!status ? undefined : status.available ? 'ok' : 'error'}>{sourceText}</Status>
                <Button icon={RefreshCw} tip={t('options.alphaExportSearchAgain')} disabled={busy} onClick={() => { setRejected(null); void refresh(); }} />
                <Button icon={FolderOpen} disabled={busy} onClick={() => { void onChoose(); }}>
                    {t('options.alphaExportChoose')}
                </Button>
            </Row>
            {rejected && <Row sub notice={t('options.alphaExportRejected', { reason: t(problemKey(rejected)) })} />}
            {status?.manualPath && status.manualProblem && (
                <Row sub notice={t('options.alphaExportManualBroken', { reason: t(problemKey(status.manualProblem)) })} />
            )}
            {status?.manualPath && (
                <Row sub label={t('options.alphaExportManualPath')} hint={status.manualPath}>
                    <Button disabled={busy} onClick={() => { setRejected(null); void clearChoice(); }}>
                        {t('options.alphaExportUseSearch')}
                    </Button>
                </Row>
            )}
            {status && !status.available && <Row sub notice={t('options.alphaExportMissing')} />}
            {/* The list goes on the hint line: it wraps there, where a control would be cut short. */}
            <Row
                option={O.formats}
                hint={formats.length > 0 ? formats.map(id => t(FORMAT_LABEL_KEYS[id])).join(' · ') : '—'}
                note={t('options.alphaExportFormatsHint')}
            />
        </Group>
    );
};

export default AlphaExportFfmpegGroup;
