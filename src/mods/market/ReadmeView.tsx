import React, { useMemo } from 'react';
import { openOutsideLink, opensThroughDesktopApp } from '../../utils/system/outsideLink';
import { parseReadme, type ReadmeBlock, type ReadmeInline } from './readmeMarkdown';

// src/mods/market/ReadmeView.tsx
// A mod's README in the detail pane, drawn from readmeMarkdown.ts's tree as React elements only (no
// innerHTML). Links open in the system browser; images come only from the market site.

const openLink = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!opensThroughDesktopApp()) return;
    event.preventDefault();
    void openOutsideLink(event.currentTarget.href);
};

const Inline: React.FC<{ nodes: ReadmeInline[] }> = ({ nodes }) => (
    <>
        {nodes.map((node, index) => {
            switch (node.type) {
                case 'text': return <React.Fragment key={index}>{node.text}</React.Fragment>;
                case 'code': return <code key={index} className="rounded bg-[var(--st-fill)] px-1 py-px font-mono text-[0.92em]">{node.text}</code>;
                case 'strong': return <strong key={index} className="font-semibold"><Inline nodes={node.children} /></strong>;
                case 'em': return <em key={index}><Inline nodes={node.children} /></em>;
                case 'link': return (
                    <a
                        key={index}
                        href={node.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={openLink}
                        className="underline decoration-[var(--st-line2)] underline-offset-2 hover:decoration-current"
                    >
                        <Inline nodes={node.children} />
                    </a>
                );
                case 'image': return (
                    <img key={index} src={node.src} alt={node.alt} loading="lazy" referrerPolicy="no-referrer" className="my-1 inline-block max-h-[360px] max-w-full rounded-lg" />
                );
                default: return null;
            }
        })}
    </>
);

const HEADING_CLASS: Record<number, string> = {
    1: 'mt-4 text-[17px] font-semibold first:mt-0',
    2: 'mt-4 border-b border-[var(--st-line)] pb-1 text-[15px] font-semibold first:mt-0',
    3: 'mt-3 text-[14px] font-semibold first:mt-0',
    4: 'mt-3 text-[13px] font-semibold first:mt-0',
};

const Block: React.FC<{ block: ReadmeBlock }> = ({ block }) => {
    switch (block.type) {
        case 'heading': {
            const Tag = `h${Math.min(6, block.level + 2)}` as 'h3';
            return <Tag className={HEADING_CLASS[block.level]}><Inline nodes={block.children} /></Tag>;
        }
        case 'paragraph': return <p><Inline nodes={block.children} /></p>;
        case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul';
            return (
                <Tag className={`${block.ordered ? 'list-decimal' : 'list-disc'} space-y-1 pl-5`}>
                    {block.items.map((item, index) => <li key={index}><Inline nodes={item} /></li>)}
                </Tag>
            );
        }
        case 'quote': return (
            <blockquote className="border-l-2 border-[var(--st-line2)] pl-3 text-[color:var(--st-t2)]"><Inline nodes={block.children} /></blockquote>
        );
        case 'code': return (
            <pre className="st-scroll overflow-x-auto rounded-lg bg-[var(--st-fill)] px-3 py-2 font-mono text-[12px] leading-[18px]">{block.text}</pre>
        );
        case 'rule': return <hr className="border-[var(--st-line)]" />;
        default: return null;
    }
};

export const ReadmeView: React.FC<{ text: string; base: string | null; imageOrigin: string | null }> = ({ text, base, imageOrigin }) => {
    // The reader is bounded, but a README is someone else's text: should it still fail, the text is shown as it is
    // rather than taking the window down with it.
    const blocks = useMemo(() => {
        try {
            return parseReadme(text, { base, imageOrigin });
        } catch {
            return null;
        }
    }, [text, base, imageOrigin]);
    if (!blocks) {
        return <div className="select-text whitespace-pre-wrap break-words text-[13px] leading-[21px] text-[color:var(--st-t1)]">{text}</div>;
    }
    return (
        <div className="flex select-text flex-col gap-2.5 break-words text-[13px] leading-[21px] text-[color:var(--st-t1)]">
            {blocks.map((block, index) => <Block key={index} block={block} />)}
        </div>
    );
};

export default ReadmeView;
