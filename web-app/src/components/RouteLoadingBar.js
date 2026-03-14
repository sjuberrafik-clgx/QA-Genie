'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import BouncingLoader from '@/components/BouncingLoader';
import RobotMascotLogo from '@/components/RobotMascotLogo';

const EXIT_DELAY_MS = 120;
const STALL_MESSAGE_DELAY_MS = 900;
const MAX_WAIT_MS = 15000;
const ROUTE_LOADING_EVENT = 'qa-route-loading:start';

export function triggerRouteLoading(pendingRouteKey = null) {
    if (typeof window === 'undefined') return;

    window.dispatchEvent(new CustomEvent(ROUTE_LOADING_EVENT, {
        detail: { pendingRouteKey },
    }));
}

function isModifiedEvent(event) {
    return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

function getRouteKey(pathname, searchParams) {
    const query = searchParams?.toString();
    return query ? `${pathname}?${query}` : pathname;
}

function getInternalNavigationTarget(event, currentRouteKey) {
    if (event.defaultPrevented || event.button !== 0 || isModifiedEvent(event)) return null;

    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!anchor) return null;
    if (anchor.hasAttribute('download')) return null;

    const target = anchor.getAttribute('target');
    if (target && target !== '_self') return null;

    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return null;

    try {
        const url = new URL(anchor.href, window.location.href);
        if (url.origin !== window.location.origin) return null;

        const nextRouteKey = `${url.pathname}${url.search}`;
        if (nextRouteKey === currentRouteKey) return null;

        return nextRouteKey;
    } catch {
        return null;
    }
}

/**
 * RouteLoadingBar — Shows an immediate branded route transition overlay during navigation.
 */
export default function RouteLoadingBar() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [isLoading, setIsLoading] = useState(false);
    const [showSlowHint, setShowSlowHint] = useState(false);
    const currentRouteRef = useRef(getRouteKey(pathname, searchParams));
    const pendingRouteRef = useRef(null);
    const exitTimerRef = useRef(null);
    const slowHintTimerRef = useRef(null);
    const maxWaitTimerRef = useRef(null);

    const startLoading = (pendingRouteKey = null) => {
        pendingRouteRef.current = pendingRouteKey;
        setIsLoading(true);
        setShowSlowHint(false);

        if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
        if (slowHintTimerRef.current) clearTimeout(slowHintTimerRef.current);
        if (maxWaitTimerRef.current) clearTimeout(maxWaitTimerRef.current);

        slowHintTimerRef.current = setTimeout(() => {
            setShowSlowHint(true);
        }, STALL_MESSAGE_DELAY_MS);

        maxWaitTimerRef.current = setTimeout(() => {
            pendingRouteRef.current = null;
            setIsLoading(false);
            setShowSlowHint(false);
        }, MAX_WAIT_MS);
    };

    useEffect(() => {
        const handleProgrammaticNavigation = (event) => {
            startLoading(event.detail?.pendingRouteKey ?? null);
        };

        const handleDocumentClick = (event) => {
            const nextRouteKey = getInternalNavigationTarget(event, currentRouteRef.current);
            if (!nextRouteKey) return;

            startLoading(nextRouteKey);
        };

        const handleHistoryNavigation = () => {
            startLoading('__history__');
        };

        document.addEventListener('click', handleDocumentClick, true);
        window.addEventListener('popstate', handleHistoryNavigation);
        window.addEventListener(ROUTE_LOADING_EVENT, handleProgrammaticNavigation);

        return () => {
            document.removeEventListener('click', handleDocumentClick, true);
            window.removeEventListener('popstate', handleHistoryNavigation);
            window.removeEventListener(ROUTE_LOADING_EVENT, handleProgrammaticNavigation);
        };
    }, []);

    useEffect(() => {
        const routeKey = getRouteKey(pathname, searchParams);
        const routeChanged = routeKey !== currentRouteRef.current;
        currentRouteRef.current = routeKey;

        if (!isLoading) {
            return () => {
                if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
                if (slowHintTimerRef.current) clearTimeout(slowHintTimerRef.current);
                if (maxWaitTimerRef.current) clearTimeout(maxWaitTimerRef.current);
            };
        }

        const shouldFinish = pendingRouteRef.current === routeKey || (pendingRouteRef.current === '__history__' && routeChanged);

        if (shouldFinish) {
            pendingRouteRef.current = null;

            if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
            if (slowHintTimerRef.current) clearTimeout(slowHintTimerRef.current);
            if (maxWaitTimerRef.current) clearTimeout(maxWaitTimerRef.current);

            exitTimerRef.current = setTimeout(() => {
                setIsLoading(false);
                setShowSlowHint(false);
            }, EXIT_DELAY_MS);
        }

        return () => {
            if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
            if (slowHintTimerRef.current) clearTimeout(slowHintTimerRef.current);
            if (maxWaitTimerRef.current) clearTimeout(maxWaitTimerRef.current);
        };
    }, [isLoading, pathname, searchParams]);

    if (!isLoading) return null;

    return (
        <div className="fixed inset-0 z-[9998] bg-white/72 backdrop-blur-md" role="status" aria-live="polite" aria-label="Loading page">
            <div className="route-progress-shell">
                <div className="route-progress-track">
                    <div className="route-progress-bar" />
                </div>
            </div>

            <div className="flex min-h-screen items-center justify-center px-6">
                <div className="w-full max-w-sm rounded-[30px] border border-surface-200/80 bg-white/92 px-8 py-9 shadow-[0_28px_80px_rgba(15,23,42,0.14)]">
                    <div className="mb-6 flex items-center justify-center">
                        <div className="rounded-[28px] bg-[radial-gradient(circle_at_30%_20%,rgba(180,92,255,0.24),transparent_42%),radial-gradient(circle_at_72%_72%,rgba(31,158,171,0.18),transparent_48%),linear-gradient(180deg,rgba(248,250,252,0.96),rgba(255,255,255,0.9))] p-2.5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
                            <RobotMascotLogo size={74} emphasis="hero" mood="glossy" />
                        </div>
                    </div>

                    <BouncingLoader
                        label="Opening workspace"
                        caption={showSlowHint
                            ? 'Preparing the selected page. First-time opens can take a little longer.'
                            : 'Loading the selected page and keeping your place ready.'}
                        size="lg"
                    />
                </div>
            </div>
        </div>
    );
}
