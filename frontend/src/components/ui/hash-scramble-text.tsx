import React, { useState, useEffect } from 'react';

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';

export function HashScrambleText({ text, scrambleOnHover = true }: { text: string; scrambleOnHover?: boolean }) {
    const [displayText, setDisplayText] = useState(text);
    const [isScrambling, setIsScrambling] = useState(false);

    useEffect(() => {
        if (!isScrambling) {
            setDisplayText(text);
            return;
        }

        let iterations = 0;
        const maxIterations = 15;

        const interval = setInterval(() => {
            setDisplayText((prev) =>
                prev
                    .split('')
                    .map((char, index) => {
                        if (index < iterations) {
                            return text[index];
                        }
                        return CHARS[Math.floor(Math.random() * CHARS.length)];
                    })
                    .join('')
            );

            iterations += 1;

            if (iterations >= maxIterations) {
                clearInterval(interval);
                setIsScrambling(false);
                setDisplayText(text);
            }
        }, 30);

        return () => clearInterval(interval);
    }, [isScrambling, text]);

    return (
        <span
            onMouseEnter={() => scrambleOnHover && !isScrambling && setIsScrambling(true)}
            style={{ display: 'inline-block', fontVariantNumeric: 'tabular-nums' }}
        >
            {displayText}
        </span>
    );
}