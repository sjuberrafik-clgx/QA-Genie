'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

// Resolve the (vendor-prefixed) SpeechRecognition constructor. Chrome, Edge,
// Safari and Opera expose `webkitSpeechRecognition`; the unprefixed name is the
// eventual standard. Firefox does not implement it, so this returns null there.
function getSpeechRecognitionCtor() {
    if (typeof window === 'undefined') return null;
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

// Translate raw SpeechRecognitionErrorEvent codes into friendly, user-facing
// copy. Returns null for codes we intentionally swallow (e.g. a user-initiated
// abort is not worth surfacing as an error).
function mapRecognitionError(code) {
    switch (code) {
        case 'not-allowed':
        case 'service-not-allowed':
            return { code, message: 'Microphone access is blocked. Allow it in your browser settings to use voice input.' };
        case 'audio-capture':
            return { code, message: 'No microphone was found. Connect a mic and try again.' };
        case 'no-speech':
            return { code, message: 'No speech detected. Try speaking again.' };
        case 'network':
            return { code, message: 'Network error during voice recognition. Check your connection.' };
        case 'aborted':
            return null;
        default:
            return { code, message: 'Voice input failed. Please try again.' };
    }
}

/**
 * React hook wrapping the browser-native Web Speech API (`SpeechRecognition`)
 * for dictation. It streams interim + finalized results to a single callback so
 * the caller decides how to compose them into an input field.
 *
 * @param {Object}   options
 * @param {(chunk: { final: string, interim: string }) => void} [options.onTranscript]
 *        Fired on every recognition result. `final` holds text the engine has
 *        committed; `interim` holds the still-being-spoken preview (may be '').
 * @param {string}   [options.lang='en-US'] - BCP-47 recognition language tag.
 * @returns {{ isSupported: boolean, isListening: boolean, error: ({ code: string, message: string }|null), start: () => void, stop: () => void, toggle: () => void }}
 */
export function useSpeechToText({ onTranscript, lang = 'en-US' } = {}) {
    const [isSupported, setIsSupported] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [error, setError] = useState(null);

    const recognitionRef = useRef(null);
    const onTranscriptRef = useRef(onTranscript);
    const mountedRef = useRef(true);
    const startRef = useRef(null);
    const intentionalStopRef = useRef(false);
    const fatalErrorRef = useRef(false);
    const resumeGuardRef = useRef({ count: 0, ts: 0 });
    const lastInterimRef = useRef('');

    // Keep the latest callback without re-creating the recognition instance.
    useEffect(() => {
        onTranscriptRef.current = onTranscript;
    }, [onTranscript]);

    // Detect support on the client only — computing this during render would
    // differ between SSR (no window) and hydration, causing a mismatch warning.
    useEffect(() => {
        setIsSupported(getSpeechRecognitionCtor() !== null);
    }, []);

    // Tear down any live recognition on unmount so no handlers fire (and call
    // setState) after the component is gone.
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            const rec = recognitionRef.current;
            if (rec) {
                rec.onresult = null;
                rec.onerror = null;
                rec.onend = null;
                rec.onstart = null;
                try { rec.abort(); } catch { /* already stopped */ }
                recognitionRef.current = null;
            }
        };
    }, []);

    const stop = useCallback(() => {
        const rec = recognitionRef.current;
        if (!rec) return;
        intentionalStopRef.current = true; // user asked to stop → don't auto-resume
        try { rec.stop(); } catch { /* not started yet */ }
    }, []);

    const start = useCallback(() => {
        const Ctor = getSpeechRecognitionCtor();
        if (!Ctor) {
            setError({ code: 'unsupported', message: 'Voice input is not supported in this browser.' });
            return;
        }
        // Guard against a double-start, which throws "already started" in Chrome.
        if (recognitionRef.current) return;

        // Fresh session: clear the stop/fatal flags used by the auto-resume path.
        intentionalStopRef.current = false;
        fatalErrorRef.current = false;

        const rec = new Ctor();
        rec.continuous = true;      // keep listening across natural pauses
        rec.interimResults = true;  // stream partial words for a live preview
        rec.lang = lang;
        rec.maxAlternatives = 1;

        rec.onstart = () => {
            if (!mountedRef.current) return;
            setError(null);
            setIsListening(true);
        };

        rec.onresult = (event) => {
            // A result means recognition is healthy — clear the rapid-resume guard.
            resumeGuardRef.current.count = 0;
            if (!mountedRef.current) return;
            let interim = '';
            let final = '';
            // Only walk results from `resultIndex` onward — earlier entries are
            // already finalized and must not be re-emitted.
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                const text = result[0]?.transcript ?? '';
                if (result.isFinal) final += text;
                else interim += text;
            }
            const trimmedInterim = interim.trim();
            // Remember still-provisional words so an auto-resume boundary can
            // commit them instead of dropping what was already spoken.
            lastInterimRef.current = trimmedInterim;
            onTranscriptRef.current?.({ final: final.trim(), interim: trimmedInterim });
        };

        rec.onerror = (event) => {
            // Permission/hardware errors are fatal — never auto-resume into a loop.
            if (event.error === 'not-allowed' || event.error === 'service-not-allowed' || event.error === 'audio-capture') {
                fatalErrorRef.current = true;
            }
            if (!mountedRef.current) return;
            const mapped = mapRecognitionError(event.error);
            if (mapped) setError(mapped);
        };

        rec.onend = () => {
            recognitionRef.current = null;
            const resume = !intentionalStopRef.current && !fatalErrorRef.current && mountedRef.current;
            intentionalStopRef.current = false;
            if (resume) {
                // Chrome stops recognition after short silences (and periodically
                // on a timer). Transparently resume so long dictation doesn't cut
                // out mid-thought — a common cause of "dropped"/inaccurate text.
                const now = Date.now();
                const g = resumeGuardRef.current;
                g.count = now - g.ts < 1000 ? g.count + 1 : 0;
                g.ts = now;
                if (g.count <= 8) {
                    // Commit words that were still provisional when Chrome ended
                    // so nothing spoken is lost when the fresh session starts.
                    if (lastInterimRef.current) {
                        onTranscriptRef.current?.({ final: lastInterimRef.current, interim: '' });
                        lastInterimRef.current = '';
                    }
                    startRef.current?.();
                    return;
                }
                // Ending immediately in a tight loop (e.g. muted mic) — give up.
            }
            lastInterimRef.current = '';
            if (!mountedRef.current) return;
            setIsListening(false);
        };

        recognitionRef.current = rec;
        try {
            rec.start();
        } catch {
            recognitionRef.current = null;
            setError({ code: 'start-failed', message: 'Could not start voice input. Please try again.' });
        }
    }, [lang]);

    // Keep a ref to the latest `start` so the auto-resume in `onend` can invoke it
    // without a self-referential hook dependency.
    useEffect(() => {
        startRef.current = start;
    }, [start]);

    const toggle = useCallback(() => {
        if (recognitionRef.current) stop();
        else start();
    }, [start, stop]);

    return { isSupported, isListening, error, start, stop, toggle };
}
