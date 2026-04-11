import React from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ThemedDialog from './ThemedDialog';

interface PlaylistSelectionDialogItem {
    id: string | number;
    name: string;
    description?: string;
}

interface PlaylistSelectionDialogProps {
    isOpen: boolean;
    title: string;
    description?: string;
    playlists: PlaylistSelectionDialogItem[];
    isDaylight?: boolean;
    onClose: () => void;
    onSelect: (playlistId: string | number) => Promise<void> | void;
    onCreate?: () => void;
    createLabel?: string;
}

const PlaylistSelectionDialog: React.FC<PlaylistSelectionDialogProps> = ({
    isOpen,
    title,
    description,
    playlists,
    isDaylight = false,
    onClose,
    onSelect,
    onCreate,
    createLabel,
}) => {
    const { t } = useTranslation();
    const [submittingId, setSubmittingId] = React.useState<string | number | null>(null);
    const panelClass = isDaylight ? 'bg-black/[0.04] border-black/5 hover:bg-black/[0.06]' : 'bg-white/[0.05] border-white/10 hover:bg-white/[0.08]';

    React.useEffect(() => {
        if (!isOpen) {
            setSubmittingId(null);
        }
    }, [isOpen]);

    return (
        <ThemedDialog
            isOpen={isOpen}
            onClose={onClose}
            isDaylight={isDaylight}
            title={title}
            description={description}
            maxWidthClass="max-w-lg"
        >
            {playlists.length > 0 ? (
                <div className="space-y-3">
                    {onCreate && (
                        <button
                            type="button"
                            onClick={onCreate}
                            disabled={submittingId !== null}
                            className={`flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed px-5 py-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${panelClass}`}
                        >
                            <Plus size={16} />
                            {createLabel || t('localMusic.saveQueueAsPlaylist') || 'Create Playlist'}
                        </button>
                    )}
                    <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                    {playlists.map((playlist) => (
                        <button
                            key={playlist.id}
                            type="button"
                            onClick={async () => {
                                try {
                                    setSubmittingId(playlist.id);
                                    await onSelect(playlist.id);
                                    onClose();
                                } finally {
                                    setSubmittingId(null);
                                }
                            }}
                            disabled={submittingId !== null}
                            className={`flex w-full items-center gap-3 rounded-2xl border px-5 py-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${panelClass}`}
                        >
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold">{playlist.name}</div>
                                {playlist.description && (
                                    <div className="truncate text-xs opacity-50">{playlist.description}</div>
                                )}
                            </div>
                            <Plus size={16} className="opacity-35" />
                        </button>
                    ))}
                    </div>
                </div>
            ) : (
                <div className="space-y-3">
                    {onCreate && (
                        <button
                            type="button"
                            onClick={onCreate}
                            disabled={submittingId !== null}
                            className={`flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed px-5 py-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${panelClass}`}
                        >
                            <Plus size={16} />
                            {createLabel || t('localMusic.saveQueueAsPlaylist') || 'Create Playlist'}
                        </button>
                    )}
                    <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm opacity-50">
                        {t('localMusic.noPlaylistsFound') || 'No playlists yet'}
                    </div>
                </div>
            )}
        </ThemedDialog>
    );
};

export default PlaylistSelectionDialog;
