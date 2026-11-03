import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Reveal, TextArea } from '../settings/kit';

// src/components/modal/lyric-filter/LyricFilterPatternField.tsx
// The field of one regular expression in the lyric filter window: the text area, the line that
// says why the expression is not valid, and an example. Given `onClear`, a clear button sits in the
// corner of the field while it holds text.

type LyricFilterPatternFieldProps = {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    example: string;
    error: string | null;
    onClear?: () => void;
};

const LyricFilterPatternField: React.FC<LyricFilterPatternFieldProps> = ({ value, onChange, placeholder, example, error, onClear }) => {
    const { t } = useTranslation();
    const fieldRef = useRef<HTMLDivElement>(null);
    // The line keeps its last text while it folds away.
    const shownError = useRef(error);
    if (error) {
        shownError.current = error;
    }

    return (
        <>
            <div ref={fieldRef} className="relative">
                <TextArea value={value} onChange={onChange} placeholder={placeholder} />
                {onClear && value && (
                    <span className="absolute bottom-1.5 right-1.5">
                        <Button
                            variant="quiet"
                            onClick={() => {
                                onClear();
                                fieldRef.current?.querySelector('textarea')?.focus();
                            }}
                        >
                            {t('lyricFilter.clear')}
                        </Button>
                    </span>
                )}
            </div>
            <Reveal when={Boolean(error)}>
                <div className="pt-1.5 text-xs leading-[18px] text-[color:var(--st-err)]">
                    {t('lyricFilter.invalidRegex', { error: shownError.current })}
                </div>
            </Reveal>
            <div className="mt-1.5 break-all text-xs leading-[18px] text-[color:var(--st-t3)]">
                {t('lyricFilter.example')} <code className="select-text font-mono text-[11.5px] text-[color:var(--st-t2)]">{example}</code>
            </div>
        </>
    );
};

export default LyricFilterPatternField;
