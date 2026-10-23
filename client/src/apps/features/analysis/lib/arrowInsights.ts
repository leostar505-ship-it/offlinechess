import { Chess, Color, PieceSymbol, Square, WHITE } from "chess.js";

import { pieceValues } from "shared/constants/utils";
import { parseUciMove } from "shared/lib/utils/chess";
import Evaluation from "shared/types/game/position/Evaluation";

export interface ArrowPair {
    from: Square;
    to: Square;
}

const FILES = "abcdefgh";

function squareName(file: number, rank: number) {
    return (FILES.charAt(file) + (rank + 1)) as Square;
}

function allPieces(board: Chess) {
    const pieces: { square: Square; type: PieceSymbol; color: Color }[] = [];

    board.board().forEach((row, rowIndex) => {
        row.forEach((piece, fileIndex) => {
            if (!piece) return;

            pieces.push({
                square: squareName(fileIndex, 7 - rowIndex),
                type: piece.type,
                color: piece.color
            });
        });
    });

    return pieces;
}

function materialFor(board: Chess, colour: Color) {
    return allPieces(board)
        .filter(piece => piece.type != "k")
        .reduce((sum, piece) => (
            sum + (piece.color == colour ? 1 : -1) * pieceValues[piece.type]
        ), 0);
}

export function getThreatArrows(fen: string, uci: string): ArrowPair[] {
    try {
        const board = new Chess(fen);
        const { to } = parseUciMove(uci);

        const mover = board.get(to);
        if (!mover) return [];

        const enemy: Color = mover.color == WHITE ? "b" : "w";

        return allPieces(board)
            .filter(piece => piece.color == enemy)
            .filter(piece => board.attackers(piece.square, mover.color).includes(to))
            .filter(piece => (
                piece.type != "p"
                || board.attackers(piece.square, enemy).length == 0
            ))
            .sort((a, b) => (
                (b.type == "k" ? 100 : pieceValues[b.type])
                - (a.type == "k" ? 100 : pieceValues[a.type])
            ))
            .slice(0, 4)
            .map(piece => ({ from: to, to: piece.square }));
    } catch {
        return [];
    }
}

const MAX_ARROWS = 4;
const MAX_LINE_ARROWS = 6;

export interface ColouredArrow extends ArrowPair {
    colour: Color;
}

export interface BestResult {
    strong: boolean;
    own: ArrowPair[];
    line: ColouredArrow[];
}

export function analyseBestResult(
    fen: string,
    evaluation: Evaluation,
    moves: { uci: string }[]
): BestResult {
    const empty: BestResult = { strong: false, own: [], line: [] };

    if (moves.length == 0) return empty;

    try {
        const board = new Chess(fen);
        const mover = board.turn();
        const start = materialFor(board, mover);

        const line: ColouredArrow[] = [];
        let lowest = 0;
        let balance = 0;

        for (const lineMove of moves.slice(0, 10)) {
            const squares = parseUciMove(lineMove.uci);

            let played;

            try {
                played = board.move({
                    from: squares.from,
                    to: squares.to,
                    promotion: squares.promotion
                });
            } catch {
                break;
            }

            line.push({ from: played.from, to: played.to, colour: played.color });

            balance = materialFor(board, mover) - start;
            lowest = Math.min(lowest, balance);
        }

        const matesForMover = (
            evaluation.type == "mate"
            && Math.abs(evaluation.value) <= 6
            && (evaluation.value > 0) == (mover == WHITE)
        );

        const strong = matesForMover || (lowest <= -3 && balance - lowest >= 2);

        const own = line.filter(arrow => arrow.colour == mover);

        if (!strong) {
            return { strong, own: own.slice(0, 1), line: line.slice(0, 1) };
        }

        const pick = <T>(items: T[], limit: number) => (
            items.length <= limit
                ? items
                : [...items.slice(0, limit - 1), items[items.length - 1]]
        );

        return {
            strong,
            own: pick(own, MAX_ARROWS),
            line: pick(line, MAX_LINE_ARROWS)
        };
    } catch {
        return empty;
    }
}

export function getBestResultArrows(
    fen: string,
    evaluation: Evaluation,
    moves: { uci: string }[]
): ArrowPair[] {
    return analyseBestResult(fen, evaluation, moves).own.map(
        arrow => ({ from: arrow.from, to: arrow.to })
    );
}

export function getColouredThreats(fen: string, uci: string): ColouredArrow[] {
    try {
        const moved = new Chess(fen).get(parseUciMove(uci).to);

        if (!moved) return [];

        return getThreatArrows(fen, uci).map(
            arrow => ({ ...arrow, colour: moved.color })
        );
    } catch {
        return [];
    }
}

export function dedupeArrows(arrows: ColouredArrow[]) {
    const seen = new Set<string>();

    return arrows.filter(arrow => {
        const key = arrow.from + arrow.to;

        if (seen.has(key)) return false;

        seen.add(key);

        return true;
    });
}
