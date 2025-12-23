import React from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { SongResult } from '../../types';

interface CoverTabProps {
    currentSong: SongResult | null;
    onAlbumSelect: (albumId: number) => void;
    onSelectArtist: (artistId: number) => void;
}

const CoverTab: React.FC<CoverTabProps> = ({ currentSong, onAlbumSelect, onSelectArtist }) => {
    const { t } = useTranslation();

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center text-center space-y-4 mt-4"
        >
            <div className="space-y-1">
                <h2 className="text-2xl font-bold line-clamp-2">{currentSong?.name || t('ui.noTrack')}</h2>
                <div className="text-sm opacity-60 space-y-1">
                    <div className="font-medium">
                        {currentSong?.ar?.map((a, i) => (
                            <React.Fragment key={a.id}>
                                {i > 0 && ", "}
                                <span
                                    className="cursor-pointer hover:underline hover:opacity-100 transition-opacity"
                                    onClick={() => onSelectArtist(a.id)}
                                >
                                    {a.name}
                                </span>
                            </React.Fragment>
                        ))}
                    </div>
                    <div
                        className="opacity-60 cursor-pointer hover:opacity-100 hover:underline transition-all"
                        onClick={() => {
                            if (currentSong?.al?.id || currentSong?.album?.id) {
                                onAlbumSelect(currentSong?.al?.id || currentSong?.album?.id);
                            }
                        }}
                    >
                        {currentSong?.al?.name || currentSong?.album?.name}
                    </div>
                </div>
            </div>
        </motion.div>
    );
};

export default CoverTab;

