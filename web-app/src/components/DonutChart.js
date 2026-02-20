'use client';

import { memo } from 'react';

/**
 * DonutChart — Pure SVG donut chart showing test pass rate.
 * Segments: passed (green), broken (orange), failed (red), skipped (amber).
 * Center text: pass rate percentage.
 */
function DonutChart({
    passed = 0,
    failed = 0,
    broken = 0,
    skipped = 0,
    size = 120,
    strokeWidth = 10,
    className = '',
}) {
    const total = passed + failed + broken + skipped;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const center = size / 2;

    // Segment data in draw order
    const segments = [
        { value: passed, color: '#10b981' },   // accent-500 green
        { value: broken, color: '#f97316' },    // orange-500
        { value: failed, color: '#ef4444' },    // red-500
        { value: skipped, color: '#f59e0b' },   // amber-500
    ].filter(s => s.value > 0);

    // Calculate dash offsets
    let cumulativeOffset = 0;
    const arcs = segments.map(seg => {
        const proportion = total > 0 ? seg.value / total : 0;
        const dashLength = proportion * circumference;
        const gap = circumference - dashLength;
        const offset = -cumulativeOffset;
        cumulativeOffset += dashLength;
        return { ...seg, dashLength, gap, offset };
    });

    // Determine pass-rate color
    const rateColor = passRate >= 90
        ? 'text-accent-500'
        : passRate >= 70
            ? 'text-amber-500'
            : 'text-red-500';

    return (
        <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="transform -rotate-90">
                {/* Background track */}
                <circle
                    cx={center}
                    cy={center}
                    r={radius}
                    fill="none"
                    strokeWidth={strokeWidth}
                    className="rpt-donut-track"
                />
                {/* Segment arcs */}
                {arcs.map((arc, i) => (
                    <circle
                        key={i}
                        cx={center}
                        cy={center}
                        r={radius}
                        fill="none"
                        stroke={arc.color}
                        strokeWidth={strokeWidth}
                        strokeDasharray={`${arc.dashLength} ${arc.gap}`}
                        strokeDashoffset={arc.offset}
                        strokeLinecap="butt"
                        className="transition-all duration-700 ease-out"
                    />
                ))}
            </svg>
            {/* Center label */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`font-bold rpt-donut-value ${rateColor} ${size >= 100 ? 'text-2xl' : size >= 60 ? 'text-lg' : 'text-sm'}`}>
                    {passRate}%
                </span>
                {size >= 80 && (
                    <span className="text-[9px] rpt-text-muted font-medium uppercase tracking-wider mt-0.5">
                        pass rate
                    </span>
                )}
            </div>
        </div>
    );
}

export default memo(DonutChart);
