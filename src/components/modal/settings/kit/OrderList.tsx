import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Reorder } from 'framer-motion';
import { GripVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { kitTransition, useKitReducedMotion } from './motion';
import { useRowAria } from './Row';

// src/components/modal/settings/kit/OrderList.tsx
// A few items whose order is the setting: a line of chips, each with its place in front and a grip
// behind. A chip is dragged to another place, or moved one place at a time with the arrow keys
// while it has the focus. It goes in a row's `below`; in a narrow window the line scrolls sideways.

type OrderListProps<T extends string> = {
    /** The items, in their order. */
    items: ReadonlyArray<{ id: T; label: string }>;
    /** Called with the new order when a chip is dropped in another place, and for each step by keyboard. */
    onChange: (order: T[]) => void;
};

export const OrderList = <T extends string>({ items, onChange }: OrderListProps<T>): React.ReactElement => {
    const { t } = useTranslation();
    const reduced = useKitReducedMotion();
    const rowAria = useRowAria();
    const listRef = useRef<HTMLUListElement>(null);
    const given = items.map(item => item.id);
    const givenKey = given.join('\n');
    // A drag reorders this copy; the page hears of the new order once, when the chip is dropped.
    // The ref gives the drop the latest order even if it closed over an earlier render.
    const [order, setOrder] = useState<T[]>(given);
    const orderRef = useRef(order);
    const draft = (next: T[]) => {
        orderRef.current = next;
        setOrder(next);
    };
    // The copy follows the page's order: when that changes (a reset, a new order that was stored),
    // and after each order handed to the page, which may have refused it.
    const [handed, setHanded] = useState(0);
    useEffect(() => {
        draft(given);
    }, [givenKey, handed]);
    const hand = (next: T[]) => {
        onChange(next);
        setHanded(count => count + 1);
    };
    const drop = () => {
        if (orderRef.current.join('\n') !== givenKey) {
            hand(orderRef.current);
        }
    };

    /** The chip the keyboard moved: React moves the element of a chip that went later, which takes its focus. */
    const movedRef = useRef<T | null>(null);
    const moveBy = (id: T, step: 1 | -1) => {
        const from = order.indexOf(id);
        const to = from + step;
        if (to < 0 || to >= order.length) {
            return;
        }
        const next = [...order];
        next.splice(to, 0, ...next.splice(from, 1));
        movedRef.current = id;
        draft(next);
        hand(next);
    };
    useLayoutEffect(() => {
        const moved = movedRef.current;
        if (moved === null) {
            return;
        }
        movedRef.current = null;
        [...(listRef.current?.children ?? [])]
            .find((chip): chip is HTMLElement => chip instanceof HTMLElement && chip.dataset.orderItem === moved)
            ?.focus();
    }, [order]);

    const labels = new Map(items.map(item => [item.id, item.label]));

    return (
        <Reorder.Group
            ref={listRef}
            axis="x"
            values={order}
            onReorder={draft}
            // The line may be scrolled sideways while a chip is measured.
            layoutScroll
            {...rowAria}
            // The padding leaves room for a chip's focus ring inside the scrolling line.
            className="-m-1 flex gap-1.5 overflow-x-auto p-1 [scrollbar-width:none]"
        >
            {order.map((id, index) => (
                <Reorder.Item
                    key={id}
                    value={id}
                    data-order-item={id}
                    tabIndex={0}
                    aria-label={t('options.settingsOrderItem', { name: labels.get(id), position: index + 1, count: order.length })}
                    onDragEnd={drop}
                    onKeyDown={(event: React.KeyboardEvent) => {
                        const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                            ? -1
                            : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0;
                        if (step === 0) {
                            return;
                        }
                        // The key is the chip's alone: it scrolls nothing and reaches no shortcut of the app.
                        event.preventDefault();
                        event.stopPropagation();
                        moveBy(id, step);
                    }}
                    transition={kitTransition('move', reduced)}
                    // A dropped chip settles into its place on framer-motion's own spring; this stiff
                    // one is as good as none.
                    dragTransition={reduced ? { bounceStiffness: 1000000, bounceDamping: 10000000 } : undefined}
                    // A sideways drag is the chip's; an up or down swipe still scrolls the page.
                    style={{ touchAction: 'pan-y' }}
                    className="st-t-fast flex h-8 shrink-0 cursor-grab select-none items-center gap-2 rounded-lg bg-[var(--st-fill)] pl-2.5 pr-1.5 font-mono text-[13px] text-[color:var(--st-t1)] transition-[background-color,box-shadow] hover:bg-[var(--st-fill2)] active:cursor-grabbing active:bg-[var(--st-raise)] active:shadow-[0_6px_16px_rgba(0,0,0,0.28)]"
                >
                    <span aria-hidden className="font-sans text-xs text-[color:var(--st-t3)]">{index + 1}</span>
                    {labels.get(id)}
                    <GripVertical aria-hidden size={14} className="text-[color:var(--st-t3)]" />
                </Reorder.Item>
            ))}
        </Reorder.Group>
    );
};

export default OrderList;
