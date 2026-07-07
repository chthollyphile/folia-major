import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import type { StatusMessage } from '../../../types';

// src/components/app/dialogs/createCopySongInfoSuccessHandler.ts

type CreateCopySongInfoSuccessHandlerParams = {
    setStatusMsg: Dispatch<SetStateAction<StatusMessage | null>>;
    t: TFunction;
};

// Creates the toast callback used by app-level dialogs feedback for successful song-info copies.
export const createCopySongInfoSuccessHandler = ({
    setStatusMsg,
    t,
}: CreateCopySongInfoSuccessHandlerParams) => {
    return () => {
        setStatusMsg({
            type: 'success',
            text: t('status.copiedSongInfo'),
        });
    };
};
