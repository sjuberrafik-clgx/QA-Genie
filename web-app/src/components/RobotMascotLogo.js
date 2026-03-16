'use client';

import { useId } from 'react';

/**
 * RobotMascotLogo — Simplified brand mascot inspired by the provided robot concept.
 * Built as an SVG so it stays crisp at sidebar, loading, and icon scales.
 */
export default function RobotMascotLogo({
    size = 64,
    className = '',
    emphasis = 'default',
    mood = 'signature',
    animated = true,
    interactive = false,
}) {
    const svgId = useId().replace(/:/g, '');
    const isGlossy = mood === 'glossy';
    const isMinimal = mood === 'minimal';
    const shellStroke = emphasis === 'hero' ? '#151826' : '#1d2433';
    const shellGlow = isMinimal
        ? 'rgba(107, 114, 128, 0.12)'
        : emphasis === 'hero'
            ? 'rgba(149, 76, 255, 0.32)'
            : 'rgba(31, 158, 171, 0.24)';
    const auraStart = isMinimal ? '#D7F4F6' : isGlossy ? '#36D7E5' : '#20C7D5';
    const auraMid = isMinimal ? '#A7C8F6' : isGlossy ? '#8B3DFF' : '#7C3AED';
    const auraEnd = isMinimal ? '#C9B8FF' : isGlossy ? '#D06CFF' : '#B45CFF';
    const bodyEnd = isMinimal ? '#7B8CDF' : isGlossy ? '#8B3DFF' : '#7C3AED';
    const pupilFill = isMinimal ? '#2563EB' : '#22D3EE';
    const auraOverlay = isMinimal
        ? 'radial-gradient(circle, rgba(124, 58, 237, 0.12) 0%, rgba(31, 158, 171, 0.1) 44%, transparent 76%)'
        : 'radial-gradient(circle, rgba(151, 71, 255, 0.24) 0%, rgba(31, 158, 171, 0.2) 45%, transparent 78%)';
    const motionStyle = {
        width: size,
        height: size,
        '--mascot-float-distance': `${Math.min(isMinimal ? 4 : 7, Math.max(isMinimal ? 1.8 : 2.8, size * (isMinimal ? 0.04 : 0.055))).toFixed(2)}px`,
        '--mascot-head-tilt': `${Math.min(isMinimal ? 1.6 : 2.2, Math.max(1.2, size * 0.018)).toFixed(2)}deg`,
        '--mascot-head-shift': `${Math.min(2.2, Math.max(0.7, size * 0.012)).toFixed(2)}px`,
        '--mascot-body-shift': `${Math.min(2.4, Math.max(0.8, size * 0.014)).toFixed(2)}px`,
        '--mascot-face-travel': `${Math.min(1.8, Math.max(0.55, size * 0.01)).toFixed(2)}px`,
        '--mascot-idle-duration': isMinimal ? '7.2s' : '6.4s',
        '--mascot-subtle-duration': isMinimal ? '8s' : '7s',
        '--mascot-head-duration': isMinimal ? '6.8s' : '5.8s',
        '--mascot-body-duration': isMinimal ? '7.4s' : '6.2s',
        '--mascot-face-duration': isMinimal ? '8.4s' : '7.1s',
        '--mascot-blink-duration': isMinimal ? '7.2s' : '6.1s',
        '--mascot-aura-scale': isMinimal ? '1.04' : '1.07',
    };

    return (
        <div
            className={`relative inline-flex shrink-0 items-center justify-center overflow-visible ${interactive ? 'mascot-interactive' : ''} ${animated ? (isMinimal ? 'mascot-idle-subtle' : 'mascot-idle') : ''} ${className}`.trim()}
            style={motionStyle}
            aria-hidden="true"
        >
            <span
                className="mascot-aura pointer-events-none absolute inset-[12%] rounded-[28%] blur-xl"
                style={{
                    background: auraOverlay,
                    filter: isMinimal ? 'blur(10px)' : 'blur(14px)',
                    '--mascot-aura-base-opacity': isMinimal ? 0.72 : 0.88,
                    '--mascot-aura-peak-opacity': isMinimal ? 0.9 : 1,
                }}
            />

            <svg
                width={size}
                height={size}
                viewBox="0 0 96 96"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="drop-shadow-[0_12px_30px_rgba(15,23,42,0.22)]"
            >
                <defs>
                    <linearGradient id={`${svgId}-robotAura`} x1="12" y1="10" x2="84" y2="86" gradientUnits="userSpaceOnUse">
                        <stop stopColor={auraStart} />
                        <stop offset="0.48" stopColor={auraMid} />
                        <stop offset="1" stopColor={auraEnd} />
                    </linearGradient>
                    <linearGradient id={`${svgId}-robotShell`} x1="26" y1="22" x2="77" y2="73" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#11151F" />
                        <stop offset="1" stopColor="#262F42" />
                    </linearGradient>
                    <linearGradient id={`${svgId}-robotScreen`} x1="27" y1="22" x2="68" y2="66" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#05070F" />
                        <stop offset="1" stopColor="#101728" />
                    </linearGradient>
                    <linearGradient id={`${svgId}-robotBody`} x1="34" y1="55" x2="62" y2="90" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#171B26" />
                        <stop offset="0.62" stopColor="#222838" />
                        <stop offset="1" stopColor={bodyEnd} />
                    </linearGradient>
                    <filter id={`${svgId}-robotGlow`} x="0" y="0" width="96" height="96" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
                        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor={shellGlow} />
                    </filter>
                    <radialGradient id={`${svgId}-cornea`} cx="0.35" cy="0.28" r="0.62" gradientUnits="objectBoundingBox">
                        <stop offset="0" stopColor="white" stopOpacity="0.32" />
                        <stop offset="0.45" stopColor="white" stopOpacity="0.1" />
                        <stop offset="1" stopColor="white" stopOpacity="0" />
                    </radialGradient>
                    <radialGradient id={`${svgId}-irisGrad`} cx="0.45" cy="0.38" r="0.55" gradientUnits="objectBoundingBox">
                        <stop offset="0" stopColor="#67E8F9" />
                        <stop offset="0.55" stopColor={pupilFill} />
                        <stop offset="1" stopColor="#1E3A5F" />
                    </radialGradient>
                    <radialGradient id={`${svgId}-irisShine`} cx="0.3" cy="0.25" r="0.45" gradientUnits="objectBoundingBox">
                        <stop offset="0" stopColor="white" stopOpacity="0.38" />
                        <stop offset="1" stopColor="white" stopOpacity="0" />
                    </radialGradient>
                    <clipPath id={`${svgId}-eyeLeftClip`}>
                        <ellipse cx="46.5" cy="31" rx="7" ry="6" />
                    </clipPath>
                    <clipPath id={`${svgId}-eyeRightClip`}>
                        <ellipse cx="62.5" cy="31" rx="7" ry="6" />
                    </clipPath>
                </defs>

                <g filter={`url(#${svgId}-robotGlow)`}>
                    <g className={animated ? 'mascot-body' : ''}>
                        <path d="M44 56C44 51.582 47.582 48 52 48H57C61.418 48 65 51.582 65 56V64C65 65.657 63.657 67 62 67H47C45.343 67 44 65.657 44 64V56Z" fill={`url(#${svgId}-robotBody)`} />
                        <path d="M39 60C34.582 60 31 63.582 31 68V74C31 75.657 32.343 77 34 77H37.5C39.157 77 40.5 75.657 40.5 74V61.5C40.5 60.672 39.828 60 39 60Z" fill={`url(#${svgId}-robotBody)`} />
                        <path d="M69 60C73.418 60 77 63.582 77 68V74C77 75.657 75.657 77 74 77H70.5C68.843 77 67.5 75.657 67.5 74V61.5C67.5 60.672 68.172 60 69 60Z" fill={`url(#${svgId}-robotBody)`} />
                    </g>

                    <g className={animated ? 'mascot-head' : ''}>
                        <path d="M25 27C25 18.716 31.716 12 40 12H62C70.284 12 77 18.716 77 27V44C77 52.284 70.284 59 62 59H40C31.716 59 25 52.284 25 44V27Z" fill={`url(#${svgId}-robotAura)`} opacity={isMinimal ? '0.84' : '0.95'} />
                        <path d="M28.5 28.5C28.5 21.596 34.096 16 41 16H61C67.904 16 73.5 21.596 73.5 28.5V42.5C73.5 49.404 67.904 55 61 55H41C34.096 55 28.5 49.404 28.5 42.5V28.5Z" fill={`url(#${svgId}-robotShell)`} stroke={shellStroke} strokeWidth={isMinimal ? '3.2' : '4'} />
                        <path d="M31.5 29.5C31.5 24.253 35.753 20 41 20H60.5C65.747 20 70 24.253 70 29.5V41.5C70 46.747 65.747 51 60.5 51H41C35.753 51 31.5 46.747 31.5 41.5V29.5Z" fill={`url(#${svgId}-robotScreen)`} />
                        {!isMinimal && (
                            <path d="M35 21.2C39.8 18.6 46.5 17 54.8 17C61.9 17 67.2 18 70.5 19.6" stroke="rgba(255,255,255,0.22)" strokeWidth="2" strokeLinecap="round" />
                        )}

                        <g className={animated ? 'mascot-face' : ''}>
                            <g className={animated ? 'mascot-eye mascot-eye-left' : ''}>
                                <g clipPath={`url(#${svgId}-eyeLeftClip)`}>
                                    <ellipse cx="46.5" cy="31" rx="7" ry="6" fill="#F0F6FF" />
                                    <circle cx="46.5" cy="31" r="4.8" fill={`url(#${svgId}-irisGrad)`} />
                                    <circle cx="46.5" cy="31" r="4.8" fill={`url(#${svgId}-irisShine)`} />
                                    <circle className={animated ? 'mascot-pupil' : ''} cx="46.5" cy="31" r="2.1" fill="#0A1628" />
                                    <ellipse className={animated ? 'mascot-cornea' : ''} cx="45.8" cy="29.5" rx="5.8" ry="4.2" fill={`url(#${svgId}-cornea)`} />
                                    <circle className={animated ? 'mascot-glint' : ''} cx="44.2" cy="28.8" r="1.5" fill="white" opacity="0.92" />
                                    <circle cx="48.4" cy="32.8" r="0.7" fill="white" opacity="0.45" />
                                    <ellipse className={animated ? 'mascot-eyelid mascot-eyelid-top' : ''} cx="46.5" cy="19" rx="7.4" ry="6" fill="#101728" />
                                    <ellipse className={animated ? 'mascot-eyelid mascot-eyelid-bottom' : ''} cx="46.5" cy="43" rx="7.4" ry="6" fill="#101728" />
                                </g>
                            </g>

                            <g className={animated ? 'mascot-eye mascot-eye-right' : ''}>
                                <g clipPath={`url(#${svgId}-eyeRightClip)`}>
                                    <ellipse cx="62.5" cy="31" rx="7" ry="6" fill="#F0F6FF" />
                                    <circle cx="62.5" cy="31" r="4.8" fill={`url(#${svgId}-irisGrad)`} />
                                    <circle cx="62.5" cy="31" r="4.8" fill={`url(#${svgId}-irisShine)`} />
                                    <circle className={animated ? 'mascot-pupil' : ''} cx="62.5" cy="31" r="2.1" fill="#0A1628" />
                                    <ellipse className={animated ? 'mascot-cornea' : ''} cx="61.8" cy="29.5" rx="5.8" ry="4.2" fill={`url(#${svgId}-cornea)`} />
                                    <circle className={animated ? 'mascot-glint' : ''} cx="60.2" cy="28.8" r="1.5" fill="white" opacity="0.92" />
                                    <circle cx="64.4" cy="32.8" r="0.7" fill="white" opacity="0.45" />
                                    <ellipse className={animated ? 'mascot-eyelid mascot-eyelid-top' : ''} cx="62.5" cy="19" rx="7.4" ry="6" fill="#101728" />
                                    <ellipse className={animated ? 'mascot-eyelid mascot-eyelid-bottom' : ''} cx="62.5" cy="43" rx="7.4" ry="6" fill="#101728" />
                                </g>
                            </g>

                            {/* Smile — tech-style segmented arc with glow */}
                            <path d="M44 42 L47.5 44.5 L54.5 44.5 L58 42" stroke={pupilFill} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.85" />
                            <path d="M44 42 L47.5 44.5 L54.5 44.5 L58 42" stroke={pupilFill} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.15" />
                        </g>

                        <path d="M34 14.5C34 11.462 36.462 9 39.5 9C42.538 9 45 11.462 45 14.5V16H34V14.5Z" fill="#F1F5F9" opacity="0.92" />
                        <path d="M61 14.5C61 11.462 63.462 9 66.5 9C69.538 9 72 11.462 72 14.5V16H61V14.5Z" fill="#F1F5F9" opacity="0.92" />

                        {!isMinimal && <circle cx="76" cy="35" r="5.8" fill="#1A2030" stroke="#2E384F" strokeWidth="2.4" />}
                        {!isMinimal && <path d="M73.4 35H78.6" stroke="#F8FAFC" strokeWidth="1.8" strokeLinecap="round" />}
                        {!isMinimal && <path d="M76 32.4V37.6" stroke="#F8FAFC" strokeWidth="1.8" strokeLinecap="round" />}

                        {isGlossy && (
                            <path d="M34.5 23.5C38.4 20.6 44.2 18.9 51.8 18.9C58.6 18.9 64.1 19.7 68.4 21.4" stroke="rgba(255,255,255,0.28)" strokeWidth="2.4" strokeLinecap="round" />
                        )}
                    </g>
                </g>
            </svg>
        </div>
    );
}