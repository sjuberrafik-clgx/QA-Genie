'use client';

import { memo } from 'react';

/**
 * AllureLogo - Allure Report multicolored "a" logo.
 *
 * The original mark is a segmented circular ring plus a separate yellow
 * descender on the lower-right. Modeling it this way matches the reference
 * more closely than an open-ring approximation.
 */
function AllureLogo({ size = 32, className = '' }) {
    const centerX = 56;
    const centerY = 48;
    const radius = 30;
    const strokeWidth = 17;

    const pointOnCircle = (angle) => {
        const radians = (angle * Math.PI) / 180;
        return {
            x: centerX + radius * Math.sin(radians),
            y: centerY - radius * Math.cos(radians),
        };
    };

    const describeArc = (startAngle, endAngle) => {
        const start = pointOnCircle(startAngle);
        const end = pointOnCircle(endAngle);
        const sweep = (endAngle - startAngle + 360) % 360;
        const largeArcFlag = sweep > 180 ? 1 : 0;
        return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
    };

    return (
        <svg
            width={size}
            height={size}
            viewBox="14 8 84 102"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
            aria-label="Allure Report logo"
            preserveAspectRatio="xMidYMid meet"
        >
            {/* Gray bottom-left segment */}
            <path
                d={describeArc(156, 216)}
                stroke="#8EA0B8"
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                fill="none"
            />

            {/* Green main segment */}
            <path
                d={describeArc(216, 18)}
                stroke="#27C85A"
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                fill="none"
            />

            {/* Red top-right cap */}
            <path
                d={describeArc(18, 52)}
                stroke="#FF4A43"
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                fill="none"
            />

            {/* Purple right-side segment */}
            <path
                d={describeArc(52, 102)}
                stroke="#7A54FF"
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                fill="none"
            />

            {/* Yellow lower-right ring segment */}
            <path
                d={describeArc(102, 156)}
                stroke="#FFC61E"
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                fill="none"
            />

            {/* Yellow descender tail */}
            <path
                d="M 82 66 C 82.7 74 82.7 81 82.7 87"
                stroke="#FFC61E"
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                fill="none"
            />
        </svg>
    );
}

export default memo(AllureLogo);
