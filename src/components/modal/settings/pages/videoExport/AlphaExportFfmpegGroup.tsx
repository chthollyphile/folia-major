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

// The container each format is written in, shown beside its name.
const FORMAT_CONTAINERS = { prores: 'MOV', vp9: 'WebM', qtrle: 'MOV' } as const;

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

    // The build string after the version (`5.1.2-essentials_build-www.gyan.dev`) is too long for the
    // status line; the full one is the path line's tooltip.
    const shortVersion = status?.version ? (/^n?\d+(?:\.\d+)*/.exec(status.version)?.[0] ?? status.version) : '?';
    const sourceText = !status
        ? t('options.alphaExportSearching')
        : status.available
            ? t(status.source === 'manual' ? 'options.alphaExportSourceManual' : 'options.alphaExportSourceAuto', { version: shortVersion })
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
            {/* Status under the label, the two buttons at the right, the full path on a line of its own. */}
            <Row
                option={O.ffmpeg}
                hint={<Status tone={!status ? undefined : status.available ? 'ok' : 'error'}>{sourceText}</Status>}
                note={t('options.alphaExportFfmpegNote')}
                below={status?.path ? (
                    <div className="break-all text-xs leading-[18px] text-[color:var(--st-t3)]" title={status.version ?? undefined}>{status.path}</div>
                ) : undefined}
            >
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
                // The path is the one above while it is in use; a broken choice shows its own here.
                <Row sub label={t('options.alphaExportManualPath')} hint={status.manualProblem ? status.manualPath : undefined}>
                    <Button disabled={busy} onClick={() => { setRejected(null); void clearChoice(); }}>
                        {t('options.alphaExportUseSearch')}
                    </Button>
                </Row>
            )}
            {status && !status.available && <Row sub notice={t('options.alphaExportMissing')} />}
            <Row
                option={O.formats}
                note={t('options.alphaExportFormatsHint')}
                below={formats.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                        {formats.map(id => (
                            <span key={id} className="inline-flex items-baseline gap-1.5 rounded-md bg-[var(--st-fill)] px-2 py-0.5 text-xs leading-[18px] text-[color:var(--st-t1)]">
                                {t(FORMAT_LABEL_KEYS[id])}
                                <span className="text-[11px] text-[color:var(--st-t3)]">{FORMAT_CONTAINERS[id]}</span>
                            </span>
                        ))}
                    </div>
                ) : undefined}
            >
                {formats.length === 0 && <span className="text-xs text-[color:var(--st-t3)]">—</span>}
            </Row>
        </Group>
    );
};

export default AlphaExportFfmpegGroup;
