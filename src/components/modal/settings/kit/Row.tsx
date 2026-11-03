import React, { createContext, useContext, useId, useRef, useState } from 'react';
import { ChevronRight, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SettingsOptionDef } from './options';
import { Unfold } from './Reveal';

// src/components/modal/settings/kit/Row.tsx
// The one row every option is drawn as: label at the left, the control at the right, a hairline
// above every row but a card's first. One short line may sit under the label; a longer explanation
// sits behind the "i" beside the label and unfolds under the row. When the control does not fit
// beside the label (narrow window, long translation) it drops to the next line by itself.

type RowNaming = {
    /** The id of the row's label, when it has one. */
    labelId?: string;
    /** The id of the short line under the label, when there is one. */
    hintId?: string;
};

const RowNamingContext = createContext<RowNaming>({});

/** Whether this is the desktop app: the test the settings window and the views before the kit use. */
const isDesktopApp = () => typeof window !== 'undefined' && Boolean(window.electron);

/** What names a control: the label of the row it sits in, wherever in the row it sits. */
export const useRowNaming = (): RowNaming => useContext(RowNamingContext);

/** The naming as the two attributes a control spreads on its element. */
export const useRowAria = () => {
    const { labelId, hintId } = useRowNaming();
    return { 'aria-labelledby': labelId, 'aria-describedby': hintId };
};

type RowProps = {
    /** An option of the page: gives the label, and is where a search hit or a link lands. */
    option?: SettingsOptionDef;
    /** Label of a row that is not one of the page's options. */
    label?: React.ReactNode;
    /** A caution, shown with a dot in place of a label. */
    notice?: React.ReactNode;
    /** One short line under the label: a few words that say what the option does. */
    hint?: React.ReactNode;
    /** The longer explanation behind the "i". */
    note?: React.ReactNode;
    /** A row that belongs under the one above it: indented. One that depends on a switch goes in a Reveal. */
    sub?: boolean;
    /** Makes the whole row a link that opens something. */
    onClick?: () => void;
    /** Dims the label and the controls and takes them away from the pointer and the keyboard; the note stays readable. */
    disabled?: boolean;
    /** An option that only does something in the desktop app: on the web the row says so in a small tag and is disabled. */
    desktopOnly?: boolean;
    /** Spans the row's width under the label line. */
    below?: React.ReactNode;
    /** The control, or controls, at the right end. */
    children?: React.ReactNode;
};

export const Row: React.FC<RowProps> = ({ option, label, notice, hint, note, sub, onClick, disabled: disabledByPage, desktopOnly, below, children }) => {
    const { t } = useTranslation();
    const [noteOpen, setNoteOpen] = useState(false);
    const linkRef = useRef<HTMLButtonElement>(null);
    const id = useId();
    const text = option ? t(option.labelKey) : label;
    const isLink = Boolean(onClick);
    const notHere = Boolean(desktopOnly) && !isDesktopApp();
    const disabled = disabledByPage || notHere;
    const naming: RowNaming = {
        labelId: !notice && text ? `${id}label` : undefined,
        hintId: !notice && text && hint ? `${id}hint` : undefined,
    };
    const noteId = `${id}note`;

    // A click on a control in the row, or in a menu one of them opened, is that control's; any
    // other click in the row, and the keyboard on the link itself, opens the link.
    const openLink = (event: React.MouseEvent) => {
        const control = (event.target as Element).closest('button, a, input, textarea, [role="listbox"]');
        if (!control || control === linkRef.current) {
            onClick?.();
        }
    };

    return (
        <div
            data-settings-row={option?.id}
            data-sub={sub || undefined}
            onClick={isLink && !disabled ? openLink : undefined}
            className={`st-row relative flex min-h-14 flex-wrap items-center gap-x-6 py-2.5 pr-4 ${sub ? 'pl-10' : 'pl-4'}${isLink && !disabled ? ' st-t-fast cursor-pointer transition-colors hover:bg-[var(--st-fill)]' : ''}`}
        >
            <RowNamingContext.Provider value={naming}>
                {isLink && (
                    // The link for the keyboard and assistive tech: it lies under the row's content, so
                    // nothing interactive is nested in it.
                    <button
                        ref={linkRef}
                        type="button"
                        disabled={disabled}
                        aria-labelledby={naming.labelId}
                        onKeyDown={(event) => {
                            // A held Enter opens the link once; other held keys do what they do.
                            if (event.repeat && event.key === 'Enter') event.preventDefault();
                        }}
                        className="st-focus-inside absolute inset-0 cursor-pointer rounded-[10px] disabled:cursor-default"
                    />
                )}
                {notice ? (
                    <div className="relative flex min-w-0 flex-[1_1_140px] items-start gap-2 text-[13px] leading-5 text-[color:var(--st-t1)]">
                        <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--st-warn)]" />
                        <span>{notice}</span>
                    </div>
                ) : text ? (
                    <div className="relative min-w-0 flex-[1_1_140px]">
                        <div className="flex items-center gap-1.5 text-sm leading-5 text-[color:var(--st-t1)]">
                            <span id={naming.labelId} className={`min-w-0${disabled ? ' opacity-40' : ''}`}>{text}</span>
                            {notHere && (
                                <span className="shrink-0 rounded bg-[var(--st-fill)] px-1.5 text-[11px] leading-[18px] text-[color:var(--st-t2)]">
                                    {t('options.settingsDesktopOnly')}
                                </span>
                            )}
                            {note && (
                                <button
                                    type="button"
                                    aria-label={t('options.settingsRowDetails')}
                                    aria-expanded={noteOpen}
                                    aria-controls={noteOpen ? noteId : undefined}
                                    onClick={() => setNoteOpen(open => !open)}
                                    className={`st-t-fast grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full transition-colors hover:text-[color:var(--st-t1)] ${noteOpen ? 'text-[color:var(--st-t1)]' : 'text-[color:var(--st-t3)]'}`}
                                >
                                    <Info size={15} />
                                </button>
                            )}
                        </div>
                        {hint && (
                            <div id={naming.hintId} className={`mt-0.5 text-xs leading-[18px] text-[color:var(--st-t2)]${disabled ? ' opacity-40' : ''}`}>
                                {hint}
                            </div>
                        )}
                    </div>
                ) : null}
                {(children || isLink) && (
                    // kit.css takes this box away around a stacked slider (.st-slider-stacked).
                    <div inert={disabled} className={`relative ml-auto flex max-w-full flex-wrap items-center justify-end gap-2${disabled ? ' opacity-40' : ''}`}>
                        {children}
                        {isLink && <ChevronRight size={16} className="shrink-0 text-[color:var(--st-t2)]" />}
                    </div>
                )}
                {note && (
                    <Unfold open={noteOpen} className="relative basis-full">
                        <div id={noteId} className="max-w-[540px] pb-0.5 pt-1.5 text-xs leading-[19px] text-[color:var(--st-t2)]">
                            {note}
                        </div>
                    </Unfold>
                )}
                {below && <div inert={disabled} className="relative mb-1 mt-2.5 min-w-0 basis-full">{below}</div>}
            </RowNamingContext.Provider>
        </div>
    );
};

export default Row;
