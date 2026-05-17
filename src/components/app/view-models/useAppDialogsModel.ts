import { useMemo } from 'react';
import type React from 'react';
import type LyricMatchModal from '../../modal/LyricMatchModal';
import type NaviLyricMatchModal from '../../modal/NaviLyricMatchModal';
import type UnavailableReplacementDialog from '../../modal/UnavailableReplacementDialog';
import type { StatusMessage } from '../../../types';

// Dialog view model centralizes app-level modal and toast mounts.
type LyricMatchDialogProps = React.ComponentProps<typeof LyricMatchModal>;
type NaviLyricMatchDialogProps = React.ComponentProps<typeof NaviLyricMatchModal>;
type UnavailableReplacementDialogProps = React.ComponentProps<typeof UnavailableReplacementDialog>;

type AppStatusToast = StatusMessage & {
    isDaylight: boolean;
};

type AppDialogsModelInput = {
    statusToast?: AppStatusToast | null;
    lyricMatchDialog?: LyricMatchDialogProps | null;
    naviLyricMatchDialog?: NaviLyricMatchDialogProps | null;
    unavailableReplacementDialog?: UnavailableReplacementDialogProps | null;
};

export type AppDialogsModel = AppDialogsModelInput;

export const useAppDialogsModel = (input: AppDialogsModelInput): AppDialogsModel => {
    return useMemo(() => input, [input]);
};
