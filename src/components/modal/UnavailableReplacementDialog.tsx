import React from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown } from 'lucide-react';
import type { SongResult } from '../../types';
import ThemedDialog from '../shared/ThemedDialog';
import { formatSongName } from '../../utils/songNameFormatter';

interface UnavailableReplacementDialogProps {
    isOpen: boolean;
    originalSong: SongResult | null;
    replacementSong: SongResult | null;
    typeDesc?: string;
    isDaylight?: boolean;
    onClose: () => void;
    onConfirm: () => Promise<void> | void;
}

const UnavailableReplacementDialog: React.FC<UnavailableReplacementDialogProps> = ({
    isOpen,
    originalSong,
    replacementSong,
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

    const songName = originalSong?.name || t('status.songUnavailable');

    const renderSongCard = (song: SongResult | null, tone: 'muted' | 'normal') => {
        const artistText = song?.ar?.map((artist) => artist.name).join(', ') || song?.artists?.map((artist) => artist.name).join(', ') || '';
        const albumText = song?.al?.name || song?.album?.name || '';
        const cardClass = tone === 'muted'
            ? (isDaylight ? 'border-black/8 bg-black/[0.025]' : 'border-white/10 bg-white/[0.025]')
            : (isDaylight ? 'border-black/8 bg-black/[0.045]' : 'border-white/10 bg-white/[0.05]');
        const titleClass = tone === 'muted'
            ? (isDaylight ? 'text-zinc-500' : 'text-zinc-400')
            : (isDaylight ? 'text-zinc-700' : 'text-zinc-200');
        const metaClass = tone === 'muted'
            ? (isDaylight ? 'text-zinc-400' : 'text-zinc-500')
            : (isDaylight ? 'text-zinc-500' : 'text-zinc-400');

        return (
            <div className={`rounded-2xl border px-4 py-3 ${cardClass}`}>
                <div className={`text-sm font-medium ${titleClass}`}>
                    {song ? formatSongName(song) : t('status.songUnavailable')}
                </div>
                {(artistText || albumText) && (
                    <div className={`mt-1 text-xs ${metaClass}`}>
                        {artistText}
                        {artistText && albumText ? ' • ' : ''}
                        {albumText}
                    </div>
                )}
            </div>
        );
    };

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
            <div className="space-y-3">
                {renderSongCard(originalSong, 'muted')}
                <div className="flex justify-center">
                    <ArrowDown size={18} className={isDaylight ? 'text-zinc-500' : 'text-zinc-400'} />
                </div>
                {renderSongCard(replacementSong, 'normal')}
            </div>
        </ThemedDialog>
    );
};

export default UnavailableReplacementDialog;
