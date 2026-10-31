import React, { useEffect, useId, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { Unfold } from './Reveal';
import { useRowNaming } from './Row';

// src/components/modal/settings/kit/KeyCapture.tsx
// Keys of the keyboard. Keys shows a shortcut as key caps. KeyCapture is the field that records
// one: press it, then press the key. While it listens every key press is its own and no shortcut
// of the app acts on it; modifier keys alone and a held key's repeats are waited through, Escape
// gives up, a key the page refuses shows the reason under the field and the field keeps listening,
// and leaving the field stops it. A field that records a whole combination reads the modifiers with
// the key (`control+shift+p`) and shows every part as its own cap.

const CAP_CLASS = 'inline-grid h-[22px] min-w-6 place-items-center rounded-md px-1.5 font-mono text-[11px]';
const QUIET_CAP_CLASS = `${CAP_CLASS} bg-[var(--st-fill)] text-[color:var(--st-t2)] shadow-[inset_0_0_0_1px_var(--st-line2)]`;
const RAISED_CAP_CLASS = `${CAP_CLASS} bg-[var(--st-raise)] text-[color:var(--st-t1)] shadow-[0_1px_2px_rgba(0,0,0,0.2)]`;

const Plus: React.FC = () => <span aria-hidden className="text-[11px] text-[color:var(--st-t3)]">+</span>;

/** Held down on the way to the key that is meant. */
const MODIFIER_KEYS = new Set(['Alt', 'Shift', 'Control', 'Meta', 'AltGraph', 'CapsLock']);

type KeysProps = {
    /** The keys of one shortcut, in the order they are held: ['Alt', 'Shift', 'D']. */
    keys: ReadonlyArray<string>;
};

export const Keys: React.FC<KeysProps> = ({ keys }) => (
    <span className="inline-flex shrink-0 items-center gap-1">
        {keys.map((key, index) => (
            <React.Fragment key={key}>
                {index > 0 && <Plus />}
                <kbd className={QUIET_CAP_CLASS}>{key}</kbd>
            </React.Fragment>
        ))}
    </span>
);

type KeyCaptureProps = {
    /** The key that is set, or null. A whole combination comes as `control+shift+p`. */
    value: string | null;
    /** Called with the key that was pressed, in lower case (a whole combination as `control+shift+p`), or
     * with null when the key is cleared. */
    onChange: (key: string | null) => void;
    /** Refuses a key and says why. */
    validate?: (key: string) => string | null;
    /** Keys that are always part of the shortcut and are not recorded: they show before the key. */
    prefix?: ReadonlyArray<string>;
    /** Reads the key a press means; the default is the press's `key` in lower case. */
    readKey?: (event: KeyboardEvent) => string;
    /** Writes one part of the shown value; the default is that part in upper case. */
    formatKey?: (part: string) => string;
};

export const KeyCapture: React.FC<KeyCaptureProps> = ({ value, onChange, validate, prefix, readKey, formatKey }) => {
    const { t } = useTranslation();
    const { labelId, hintId } = useRowNaming();
    const keysId = useId();
    const [listening, setListening] = useState(false);
    // The reason stays while its line folds away; `refused` is whether the line shows.
    const [reason, setReason] = useState('');
    const [refused, setRefused] = useState(false);
    const parts = value ? value.split('+') : [];

    useEffect(() => {
        if (!listening) {
            return;
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            // Capture phase, and it stops here: the app's own keys listen for exactly the kind of
            // press that is being recorded. The listeners put on `window` in this phase before this
            // one still run first: Ponder's two see the mark on the button and leave the key alone
            // (isKeyCaptureTarget); the automix ring goes away on any key, as it is meant to.
            event.preventDefault();
            event.stopPropagation();
            // A held key is one press: what the keyboard repeats is neither recorded nor refused
            // (the Enter that started the listening would otherwise be the first key it hears).
            if (event.repeat || MODIFIER_KEYS.has(event.key)) {
                return;
            }
            if (event.key === 'Escape') {
                setListening(false);
                setRefused(false);
                return;
            }
            const key = readKey ? readKey(event) : event.key.toLowerCase();
            const refusal = validate?.(key);
            if (refusal) {
                setReason(refusal);
                setRefused(true);
                return;
            }
            onChange(key);
            setListening(false);
            setRefused(false);
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [listening, onChange, readKey, validate]);

    return (
        <div className="flex max-w-full flex-col items-end">
            <div className="flex items-center gap-1">
                {value && !listening && (
                    <Button variant="quiet" icon={X} tip={t('options.settingsKeyCaptureClear')} onClick={() => onChange(null)} />
                )}
                <button
                    type="button"
                    // Named by its row, then by the keys it shows.
                    aria-labelledby={labelId ? `${labelId} ${keysId}` : undefined}
                    aria-describedby={hintId}
                    data-folia-key-capture={listening || undefined}
                    onClick={() => {
                        setRefused(false);
                        setListening(current => !current);
                    }}
                    onBlur={() => {
                        setListening(false);
                        setRefused(false);
                    }}
                    // While it listens it carries the kit's focus ring, whatever it was reached with.
                    className={`st-t-fast inline-flex h-8 cursor-pointer items-center rounded-lg px-2 transition-[background-color] ${listening ? 'bg-[var(--st-fill2)] outline outline-2 outline-offset-2 outline-[color:var(--st-accent)]' : 'bg-[var(--st-fill)] hover:bg-[var(--st-fill2)]'}`}
                >
                    <span id={keysId} className="inline-flex items-center gap-1">
                        {prefix?.map(key => (
                            <React.Fragment key={key}>
                                <kbd className={QUIET_CAP_CLASS}>{key}</kbd>
                                <Plus />
                            </React.Fragment>
                        ))}
                        {listening || !value ? (
                            <span className={`px-1 text-xs ${listening ? 'text-[color:var(--st-t1)]' : 'text-[color:var(--st-t3)]'}`}>
                                {t(listening ? 'options.settingsKeyCaptureListening' : 'options.settingsKeyCaptureEmpty')}
                            </span>
                        ) : (
                            parts.map((part, index) => (
                                <React.Fragment key={part}>
                                    {index > 0 && <Plus />}
                                    <kbd className={index === parts.length - 1 ? RAISED_CAP_CLASS : QUIET_CAP_CLASS}>
                                        {formatKey ? formatKey(part) : part.toUpperCase()}
                                    </kbd>
                                </React.Fragment>
                            ))
                        )}
                    </span>
                </button>
            </div>
            <Unfold open={refused}>
                <div role="alert" className="pt-1 text-right text-xs leading-[18px] text-[color:var(--st-err)]">{reason}</div>
            </Unfold>
        </div>
    );
};

export default KeyCapture;
