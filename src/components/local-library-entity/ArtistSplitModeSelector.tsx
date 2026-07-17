import { ListPlus, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LocalLibraryArtistAssignmentMode } from '../../types/localLibrary';

// src/components/local-library-entity/ArtistSplitModeSelector.tsx
// Makes the destructive difference between appending and replacing artist links explicit.

type ArtistSplitModeSelectorProps = {
    mode: LocalLibraryArtistAssignmentMode;
    resultTheme: string;
    selectedTheme: string;
    onChange: (mode: LocalLibraryArtistAssignmentMode) => void;
};

export const ArtistSplitModeSelector = ({ mode, resultTheme, selectedTheme, onChange }: ArtistSplitModeSelectorProps) => {
    const { t } = useTranslation();
    return (
        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('localMusic.artistAssignmentMode')}>
            {([
                { value: 'replace' as const, icon: RefreshCw, label: t('localMusic.replaceAllArtists'), hint: t('localMusic.replaceAllArtistsHint') },
                { value: 'append' as const, icon: ListPlus, label: t('localMusic.appendArtists'), hint: t('localMusic.appendArtistsHint') },
            ]).map(option => {
                const Icon = option.icon;
                return (
                    <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={mode === option.value}
                        onClick={() => onChange(option.value)}
                        className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${mode === option.value ? selectedTheme : resultTheme}`}
                    >
                        <Icon size={17} className="mt-0.5 shrink-0 text-blue-500" />
                        <span>
                            <span className="block text-sm font-semibold">{option.label}</span>
                            <span className="mt-0.5 block text-xs font-normal opacity-60">{option.hint}</span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
};
