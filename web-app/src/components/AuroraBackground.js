'use client';

/**
 * AuroraBackground — shared animated aurora substrate for the app.
 *
 * Mounted once in <AppShell>. Renders two fixed layers behind main content:
 *   1. `.aurora-bg` — drifting radial-gradient color blobs
 *   2. `.aurora-bg-grid` — faint masked grid for operator feel
 *
 * Both layers use CSS-only animation and respect `prefers-reduced-motion`.
 *
 * @prop {'high'|'medium'|'low'} [intensity='medium']
 *   `low`/`medium` apply the quiet variant — recommended for data-dense
 *   routes (dashboard). `high` shows the full-intensity aurora for the
 *   home/landing surfaces.
 */
export default function AuroraBackground({ intensity = 'medium' }) {
    const quiet = intensity !== 'high';

    return (
        <>
            <div
                aria-hidden="true"
                className={`aurora-bg${quiet ? ' aurora-bg-quiet' : ''}`}
            />
            <div aria-hidden="true" className="aurora-bg-grid" />
        </>
    );
}
