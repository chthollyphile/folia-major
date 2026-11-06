import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Upload, Check, Trash2 } from 'lucide-react';
import { useStylePackLibrary } from './library';
import { readStylePack, formatStylePack } from './validate';
import { EXAMPLE_PACK } from './example';
import { RENDERER_PACK } from './code/example';
import { downloadStyleFile } from './download';
import { errorMessage } from '../utils/errorText';
import type { AnyStylePack as StylePack } from './code/contract';
import { packKind, STYLE_KINDS } from './catalog';

// The same pack manager is used in the lyric-style settings and command-palette surface.
export default function StylePackManager({ pack, onApply }: { pack: StylePack; onApply: (pack: StylePack) => void }) {
    const { t } = useTranslation();
    const library = useStylePackLibrary();
    const fileInput = useRef<HTMLInputElement>(null);
    const [status, setStatus] = useState('');
    const [confirm, setConfirm] = useState('');
    const [busy, setBusy] = useState(false);
    const button = 'inline-flex items-center gap-2 rounded-lg border border-current/15 px-3 py-2 text-sm hover:bg-current/10 disabled:opacity-40';
    const report = (error: unknown) => {
        console.warn('[StylePacks] Pack action failed', error);
        const message = errorMessage(error);
        setStatus(message.startsWith('stylePacks.') ? t(message) : `${t('stylePacks.failed')} ${message}`);
    };
    const importFile = async (file?: File) => {
        if (!file || busy) return;
        setBusy(true);
        try {
            const imported = await readStylePack(file);
            library.install(imported);
            setStatus(t('stylePacks.imported'));
        } catch (error) { report(error); }
        finally { setBusy(false); }
    };
    const packs = [RENDERER_PACK, EXAMPLE_PACK, ...library.packs];
    return <section className="space-y-4 p-3" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void importFile(event.dataTransfer.files[0]); }}>
        <h3 className="text-lg font-semibold">{t('stylePacks.title')}</h3>
        <p className="text-sm opacity-70">{t('stylePacks.hint')}</p>
        <div className="flex flex-wrap gap-2">
            <button className={button} disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={16} />{t('stylePacks.import')}</button>
            <button className={button} onClick={() => downloadStyleFile(`${pack.id}.folia-style.json`, formatStylePack(pack))}><Download size={16} />{t('stylePacks.export')}</button>
            <button className={button} onClick={() => onApply(RENDERER_PACK)}>{t('stylePacks.reset')}</button>
            <input ref={fileInput} type="file" accept=".json,.folia-style" className="hidden" onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ''; }} />
        </div>
        <p className="text-sm">{t('stylePacks.active')}: {pack.name} · {pack.version}</p>
        {STYLE_KINDS.map(kind => <section key={kind} className="space-y-2">
            <h4 className="font-semibold">{t(kind === 'personality' ? 'stylePacks.personality' : 'stylePacks.lyricTemplate')}</h4>
            <p className="text-xs opacity-60">{t(kind === 'personality' ? 'stylePacks.personalityHint' : 'stylePacks.lyricTemplateHint')}</p>
        {packs.filter(item => packKind(item) === kind).map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-current/10 p-3">
            <div><strong>{item.name}</strong><p className="text-xs opacity-60">{item.id} · {item.version} · {item.author}</p>
                {!item.kind && <p className="text-xs opacity-60">{t('stylePacks.legacyKind')}</p>}</div>
            <div className="flex gap-2">
                <button className={button} onClick={() => { try { onApply(item); setStatus(t('stylePacks.applied')); } catch (error) { report(error); } }}><Check size={14} />{t('stylePacks.apply')}</button>
                {![EXAMPLE_PACK.id, RENDERER_PACK.id].includes(item.id) && <button className={button} onClick={() => {
                    if (confirm !== item.id) { setConfirm(item.id); return; }
                    try { library.remove(item.id); setConfirm(''); } catch (error) { report(error); }
                }}><Trash2 size={14} />{t(confirm === item.id ? 'stylePacks.confirmRemove' : 'stylePacks.remove')}</button>}
            </div>
        </div>)}</section>)}
        <p className="text-sm opacity-70">{t('stylePacks.studioHelp')}</p>
        <p role="status" className="whitespace-pre-wrap text-sm">{status}</p>
    </section>;
}
