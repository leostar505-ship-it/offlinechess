import React from "react";
import { Arrow, Square } from "react-chessboard/dist/chessboard/types";

interface ArrowOverlayProps {
    arrows: Arrow[];
    size: number;
    flipped?: boolean;
}

interface Point {
    x: number;
    y: number;
}

const FILES = "abcdefgh";

const DEFAULT_COLOUR = "rgba(245, 166, 35, 0.85)";

function centre(square: Square, cell: number, flipped?: boolean): Point {
    const file = FILES.indexOf(square.charAt(0));
    const rank = parseInt(square.charAt(1)) - 1;

    return {
        x: ((flipped ? 7 - file : file) + 0.5) * cell,
        y: ((flipped ? rank : 7 - rank) + 0.5) * cell
    };
}

function isKnightJump(from: Square, to: Square) {
    const dx = Math.abs(FILES.indexOf(from.charAt(0)) - FILES.indexOf(to.charAt(0)));
    const dy = Math.abs(parseInt(from.charAt(1)) - parseInt(to.charAt(1)));

    return (dx == 1 && dy == 2) || (dx == 2 && dy == 1);
}

function buildPath(from: Square, to: Square, cell: number, flipped?: boolean) {
    const start = centre(from, cell, flipped);
    const end = centre(to, cell, flipped);

    if (!isKnightJump(from, to)) return [start, end];

    const longVertical = Math.abs(end.y - start.y) > Math.abs(end.x - start.x);

    const corner = longVertical
        ? { x: start.x, y: end.y }
        : { x: end.x, y: start.y };

    return [start, corner, end];
}

function ArrowOverlay({ arrows, size, flipped }: ArrowOverlayProps) {
    if (arrows.length == 0 || size <= 0) return null;

    const cell = size / 8;
    const width = cell * 0.2;
    const headLength = cell * 0.42;
    const headWidth = cell * 0.5;

    return <svg
        width={size}
        height={size}
        style={{
            position: "absolute",
            top: 0,
            left: 0,
            pointerEvents: "none",
            zIndex: 5
        }}
    >
        {arrows.map(([from, to, colour], index) => {
            const path = buildPath(from, to, cell, flipped);

            const tip = path[path.length - 1];
            const previous = path[path.length - 2];

            const direction = {
                x: tip.x - previous.x,
                y: tip.y - previous.y
            };

            const directionLength = Math.hypot(direction.x, direction.y) || 1;
            const unit = {
                x: direction.x / directionLength,
                y: direction.y / directionLength
            };

            const base = {
                x: tip.x - unit.x * headLength,
                y: tip.y - unit.y * headLength
            };

            const normal = { x: -unit.y, y: unit.x };

            const shaft = [path[0], ...path.slice(1, -1), base];

            const fill = colour || DEFAULT_COLOUR;

            return <g key={`${from}${to}${index}`}>
                <polyline
                    points={shaft.map(point => `${point.x},${point.y}`).join(" ")}
                    fill="none"
                    stroke={fill}
                    strokeWidth={width}
                    strokeLinejoin="miter"
                    strokeLinecap="butt"
                />

                <polygon
                    points={[
                        `${tip.x},${tip.y}`,
                        `${base.x + normal.x * headWidth / 2},${base.y + normal.y * headWidth / 2}`,
                        `${base.x - normal.x * headWidth / 2},${base.y - normal.y * headWidth / 2}`
                    ].join(" ")}
                    fill={fill}
                />
            </g>;
        })}
    </svg>;
}

export default ArrowOverlay;
