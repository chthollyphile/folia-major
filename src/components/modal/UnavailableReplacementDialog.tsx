import React from 'react';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../../types';
import ThemedDialog from '../shared/ThemedDialog';
import { formatSongName } from '../../utils/songNameFormatter';

interface UnavailableReplacementDialogProps {
    isOpen: boolean;
    song: SongResult | null;
    typeDesc?: string;
    isDaylight?: boolean;
    onClose: () => void;
    onConfirm: () => Promise<void> | void;
}

const UnavailableReplacementDialog: React.FC<UnavailableReplacementDialogProps> = ({
    isOpen,
    song,
    typeDesc,
    isDaylight = false,
    onClose,
    onConfirm,
}) => {
    const { t } = useTranslation();
    const [isSubmitting, setIsSubmitting] = React.useState(false);

    React.useEffect(() => {
        if (isOpen) {
            setIsSubmitting(false);
        }
    }, [isOpen]);

    const cancelClass = isDaylight
        ? 'bg-zinc-100/80 hover:bg-zinc-200 border-zinc-200 text-zinc-700'
        : 'bg-white/5 hover:bg-white/10 border-white/10 text-white';
    const confirmClass = isDaylight
        ? 'bg-zinc-900 text-white hover:bg-zinc-700'
        : 'bg-white text-zinc-950 hover:bg-zinc-200';

    const handleConfirm = async () => {
        try {
            setIsSubmitting(true);
            await onConfirm();
        } finally {
            setIsSubmitting(false);
        }
    };

    const songName = song?.name || t('status.songUnavailable');
    const artistText = song?.ar?.map((artist) => artist.name).join(', ') || song?.artists?.map((artist) => artist.name).join(', ') || '';
    const albumText = song?.al?.name || song?.album?.name || '';

    return (
        <ThemedDialog
            isOpen={isOpen}
            onClose={() => {
                if (!isSubmitting) {
                    onClose();
                }
            }}
            isDaylight={isDaylight}
            title={t('status.songUnavailableAlternativeTitle')}
            description={t('status.songUnavailableAlternativeDescription', {
                song: songName,
                typeDesc: typeDesc || t('status.songUnavailableAlternativeDefaultType'),
            })}
            footer={(
                <>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSubmitting}
                        className={`rounded-full border px-5 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${cancelClass}`}
                    >
                        {t('status.cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={() => void handleConfirm()}
                        disabled={isSubmitting}
                        className={`rounded-full px-5 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${confirmClass}`}
                    >
                        {t('status.playAlternativeVersion')}
                    </button>
                </>
            )}
        >
            <div className={`rounded-2xl border px-4 py-3 ${isDaylight ? 'border-black/8 bg-black/[0.035]' : 'border-white/10 bg-white/[0.04]'}`}>
                <div className={`text-sm font-medium ${isDaylight ? 'text-zinc-700' : 'text-zinc-200'}`}>
                    {song ? formatSongName(song) : songName}
                </div>
                {(artistText || albumText) && (
                    <div className={`mt-1 text-xs ${isDaylight ? 'text-zinc-500' : 'text-zinc-400'}`}>
                        {artistText}
                        {artistText && albumText ? ' • ' : ''}
                        {albumText}
                    </div>
                )}
            </div>
        </ThemedDialog>
    );
};

export default UnavailableReplacementDialog;
