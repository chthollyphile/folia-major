import React from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet, SheetButton } from '../shared/Sheet';
import { NewFeaturesIntro } from './NewFeaturesIntro';
import { USER_GUIDE_AUTO_OPEN_VERSION } from './userGuideContent';

// src/components/modal/ReleaseNotesDialog.tsx
// The 版本更新 dialog: what the current release brought. Opened from the Help page, and by the app
// shell on the first start of a new release.

type ReleaseNotesDialogProps = {
    isOpen: boolean;
    isDaylight: boolean;
    onClose: () => void;
};

const ReleaseNotesDialog: React.FC<ReleaseNotesDialogProps> = ({ isOpen, isDaylight, onClose }) => {
    const { t } = useTranslation();

    return (
        <Sheet
            isOpen={isOpen}
            onClose={onClose}
            isDaylight={isDaylight}
            size="m"
            title={t('help.releaseNotes')}
            // The release the notes were written for.
            subtitle={USER_GUIDE_AUTO_OPEN_VERSION ? `v${USER_GUIDE_AUTO_OPEN_VERSION}` : undefined}
            footer={<SheetButton data-testid="release-notes-close" onClick={onClose}>{t('ui.close')}</SheetButton>}
        >
            <div data-testid="release-notes-dialog">
                <NewFeaturesIntro />
            </div>
        </Sheet>
    );
};

export default ReleaseNotesDialog;
