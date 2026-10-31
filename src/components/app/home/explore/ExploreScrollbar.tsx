import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGlass } from '@/shinoinject/useGlass';
import { useReducedMotionFor } from '../../../../hooks/useReducedMotionFor';
import { useThemeSettingsStore } from '../../../../stores/useThemeSettingsStore';

// src/components/app/home/explore/ExploreScrollbar.tsx
// The explore page's floating scrollbar: a glass pill at the window's right edge. Its thumb shows
// where the list stands; a mark for each section jumps the list to that section.

/** A section of the list, and where its top lies in the list's scroll. */
interface Mark {
    id: string;
    title: string;
    top: number;
    ratio: number;
}

interface Metrics {
    maxScroll: number;
    clientHeight: number;
    scrollHeight: number;
}

type Drag = {
    mode: 'track' | 'thumb';
    pointerId: number;
    startY: number;
    startScroll: number;
    range: number;
};

interface ExploreScrollbarProps {
    list: React.RefObject<HTMLDivElement | null>;
    /** The id of the list this scrollbar controls. */
    controls: string;
}

const sameMarks = (a: Mark[], b: Mark[]) => a.length === b.length && a.every((mark, index) => (
    mark.id === b[index].id && mark.top === b[index].top && mark.ratio === b[index].ratio
));

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const ExploreScrollbar: React.FC<ExploreScrollbarProps> = ({ list: listRef, controls }) => {
    const { t } = useTranslation();
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const calm = useReducedMotionFor('uiMicroMotion');
    useGlass();
    const trackRef = useRef<HTMLDivElement>(null);
    const thumbRef = useRef<HTMLDivElement>(null);
    const marksLayerRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<Drag | null>(null);
    const metricsRef = useRef<Metrics>({ maxScroll: 0, clientHeight: 0, scrollHeight: 0 });
    const marksRef = useRef<Mark[]>([]);
    // Sections are watched as they arrive: their heights settle after pictures load, and a mark
    // written before that would stand at the wrong place in the list.
    const resizeObserverRef = useRef<ResizeObserver | null>(null);
    const [marks, setMarks] = useState<Mark[]>([]);
    const [scrollable, setScrollable] = useState(false);
    const syncFrame = useRef(0);
    const measureFrame = useRef(0);

    // Writes the thumb and the active section mark straight to the DOM: scrolling must not render.
    const syncThumb = useCallback(() => {
        const list = listRef.current;
        const track = trackRef.current;
        const thumb = thumbRef.current;
        if (!list || !track || !thumb) return;
        const { maxScroll, clientHeight, scrollHeight } = metricsRef.current;
        const trackHeight = track.clientHeight;
        if (!trackHeight) return;
        const thumbHeight = Math.min(trackHeight, Math.max(24, trackHeight * (scrollHeight > 0 ? clientHeight / scrollHeight : 1)));
        const range = Math.max(0, trackHeight - thumbHeight);
        const scrollTop = Math.min(Math.max(0, list.scrollTop), Math.max(0, maxScroll));
        const top = maxScroll > 0 ? (scrollTop / maxScroll) * range : 0;
        thumb.style.height = `${thumbHeight}px`;
        thumb.style.transform = `translateY(${top}px)`;
        track.setAttribute('aria-valuemax', String(Math.round(maxScroll)));
        track.setAttribute('aria-valuenow', String(Math.round(scrollTop)));
        let active = -1;
        marksRef.current.forEach((mark, index) => {
            if (scrollTop + 1 >= mark.top) active = index;
        });
        const title = active >= 0 ? marksRef.current[active].title : '';
        if (title) track.setAttribute('aria-valuetext', title);
        else track.removeAttribute('aria-valuetext');
        marksLayerRef.current?.querySelectorAll<HTMLElement>('[data-explore-mark]').forEach((mark, index) => {
            const current = index === active;
            mark.style.opacity = current ? '0.9' : '0.35';
            mark.style.scale = current ? '1.5' : '1';
        });
    }, [listRef]);

    const scheduleSync = useCallback(() => {
        if (syncFrame.current) return;
        syncFrame.current = requestAnimationFrame(() => {
            syncFrame.current = 0;
            syncThumb();
        });
    }, [syncThumb]);

    // Reads the list and its sections, then hands the thumb its new range. Sections arrive and
    // change height as pages are read, so this is not tied to a render.
    const measure = useCallback(() => {
        const list = listRef.current;
        if (!list) return;
        const scrollHeight = list.scrollHeight;
        const clientHeight = list.clientHeight;
        const maxScroll = Math.max(0, scrollHeight - clientHeight);
        metricsRef.current = { maxScroll, clientHeight, scrollHeight };
        setScrollable(current => (current === (maxScroll > 1) ? current : maxScroll > 1));
        const listRect = list.getBoundingClientRect();
        const untitled = t('home.explore');
        const shelves = Array.from(list.querySelectorAll<HTMLElement>('[data-explore-shelf]'));
        shelves.forEach(section => resizeObserverRef.current?.observe(section));
        const next = shelves.map((section, index) => {
            const title = section.querySelector('h2')?.textContent?.trim() || untitled;
            const top = Math.round(Math.min(maxScroll, Math.max(0, section.getBoundingClientRect().top - listRect.top + list.scrollTop)));
            return { id: `${index}:${title}`, title, top, ratio: maxScroll > 0 ? top / maxScroll : 0 };
        });
        marksRef.current = next;
        setMarks(current => (sameMarks(current, next) ? current : next));
        syncThumb();
    }, [listRef, syncThumb, t]);

    const scheduleMeasure = useCallback(() => {
        if (measureFrame.current) return;
        measureFrame.current = requestAnimationFrame(() => {
            measureFrame.current = 0;
            measure();
        });
    }, [measure]);

    useLayoutEffect(() => {
        const list = listRef.current;
        if (!list) return undefined;
        const onScroll = () => scheduleSync();
        list.addEventListener('scroll', onScroll, { passive: true });
        // A picture that loads settles its section's height without a mutation to the list.
        const onLoad = () => scheduleMeasure();
        list.addEventListener('load', onLoad, true);
        const observer = new ResizeObserver(() => {
            scheduleMeasure();
            scheduleSync();
        });
        resizeObserverRef.current = observer;
        observer.observe(list);
        Array.from(list.children).forEach(child => observer.observe(child));
        const mutations = new MutationObserver(scheduleMeasure);
        mutations.observe(list, { childList: true, subtree: true });
        measure();
        syncThumb();
        return () => {
            list.removeEventListener('scroll', onScroll);
            list.removeEventListener('load', onLoad, true);
            resizeObserverRef.current = null;
            observer.disconnect();
            mutations.disconnect();
            cancelAnimationFrame(syncFrame.current);
            cancelAnimationFrame(measureFrame.current);
        };
    }, [listRef, measure, scheduleMeasure, scheduleSync, syncThumb]);

    useLayoutEffect(() => {
        if (!scrollable) return undefined;
        const track = trackRef.current;
        if (!track) return undefined;
        const observer = new ResizeObserver(scheduleSync);
        observer.observe(track);
        measure();
        syncThumb();
        return () => observer.disconnect();
    }, [scrollable, measure, scheduleSync, syncThumb]);

    useLayoutEffect(() => {
        marksRef.current = marks;
        syncThumb();
    }, [marks, syncThumb]);

    const scrollTo = useCallback((top: number, smooth: boolean) => {
        const list = listRef.current;
        if (!list) return;
        const max = Math.max(0, list.scrollHeight - list.clientHeight);
        list.scrollTo({ top: Math.min(max, Math.max(0, top)), behavior: smooth && !calm ? 'smooth' : 'auto' });
    }, [calm, listRef]);

    const jumpTo = (mark: Mark) => {
        scrollTo(mark.top, true);
    };

    const onTrackPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        const list = listRef.current;
        const track = trackRef.current;
        if (!list || !track) return;
        if (event.target instanceof Element && event.target.closest('[data-explore-mark]')) return;
        event.preventDefault();
        track.setPointerCapture(event.pointerId);
        dragRef.current = { mode: 'track', pointerId: event.pointerId, startY: event.clientY, startScroll: list.scrollTop, range: 0 };
        const rect = track.getBoundingClientRect();
        const max = Math.max(0, list.scrollHeight - list.clientHeight);
        scrollTo(clamp01((event.clientY - rect.top) / Math.max(1, rect.height)) * max, false);
    };

    const onThumbPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        event.stopPropagation();
        event.preventDefault();
        const list = listRef.current;
        const track = trackRef.current;
        const thumb = thumbRef.current;
        if (!list || !track || !thumb) return;
        const range = track.clientHeight - thumb.offsetHeight;
        if (range <= 0) return;
        thumb.setPointerCapture(event.pointerId);
        dragRef.current = { mode: 'thumb', pointerId: event.pointerId, startY: event.clientY, startScroll: list.scrollTop, range };
    };

    const onTrackPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        const list = listRef.current;
        const track = trackRef.current;
        if (!drag || drag.pointerId !== event.pointerId || !list || !track) return;
        const max = Math.max(0, list.scrollHeight - list.clientHeight);
        if (drag.mode === 'thumb') {
            const delta = ((event.clientY - drag.startY) / drag.range) * max;
            scrollTo(drag.startScroll + delta, false);
            return;
        }
        const rect = track.getBoundingClientRect();
        scrollTo(clamp01((event.clientY - rect.top) / Math.max(1, rect.height)) * max, false);
    };

    const endDrag = () => {
        dragRef.current = null;
    };

    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const list = listRef.current;
        if (!list) return;
        const page = Math.max(40, list.clientHeight * 0.9);
        let next: number;
        switch (event.key) {
            case 'ArrowDown': next = list.scrollTop + 40; break;
            case 'ArrowUp': next = list.scrollTop - 40; break;
            case 'PageDown': next = list.scrollTop + page; break;
            case 'PageUp': next = list.scrollTop - page; break;
            case 'Home': next = 0; break;
            case 'End': next = list.scrollHeight; break;
            default: return;
        }
        event.preventDefault();
        event.stopPropagation();
        scrollTo(next, false);
    };

    const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
        const list = listRef.current;
        if (!list) return;
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? list.clientHeight : 1;
        list.scrollTop += event.deltaY * unit;
    };

    if (!scrollable) return null;

    return (
        <div
            data-explore-scrollbar
            className="pointer-events-none fixed right-2 top-1/2 z-30 -translate-y-1/2 select-none"
            onWheel={onWheel}
        >
            <div className="relative h-[min(58vh,440px)] w-3">
                <div
                    ref={trackRef}
                    role="scrollbar"
                    aria-controls={controls}
                    aria-orientation="vertical"
                    aria-label={t('home.exploreScrollbar')}
                    tabIndex={0}
                    onPointerDown={onTrackPointerDown}
                    onPointerMove={onTrackPointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onLostPointerCapture={endDrag}
                    onKeyDown={onKeyDown}
                    data-glass
                    data-glass-light
                    className={`pointer-events-auto absolute inset-0 touch-none rounded-full outline outline-1 outline-[rgba(40,40,40,0.2)] shadow-[2px_2px_8px_2px_rgba(40,40,40,0.4)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--text-primary)] ${isDaylight ? 'border-y border-black/[0.08] bg-white/35' : 'border-y border-white/[0.12] bg-black/35'}`}
                >
                    <div
                        ref={thumbRef}
                        aria-hidden
                        className="absolute inset-x-0 top-0 z-10 mx-auto w-2 cursor-grab rounded-full active:cursor-grabbing"
                        style={{
                            height: 0,
                            backgroundColor: 'color-mix(in srgb, var(--text-primary) 45%, transparent)',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
                        }}
                        onPointerDown={onThumbPointerDown}
                    />
                </div>
                <div ref={marksLayerRef} className="pointer-events-none absolute inset-0 z-20">
                    {/* {marks.map(mark => (
                        <button
                            key={mark.id}
                            type="button"
                            data-explore-mark
                            title={mark.title}
                            aria-label={t('home.exploreJumpToSection', { section: mark.title })}
                            onPointerDown={event => event.stopPropagation()}
                            onClick={() => jumpTo(mark)}
                            className="pointer-events-auto absolute left-1/2 flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center border-0 bg-transparent p-0 transition-[opacity,scale] duration-200 ease-out"
                            style={{ top: `${mark.ratio * 100}%`, opacity: 0.35 }}
                        >
                            <span className="block h-1 w-1 rounded-full" style={{ backgroundColor: 'var(--text-primary)' }} />
                        </button>
                    ))} */}
                </div>
            </div>
        </div>
    );
};

export default ExploreScrollbar;
