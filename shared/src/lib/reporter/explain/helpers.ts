import {
    Chess,
    Color,
    Move,
    Square,
    PieceSymbol,
    WHITE,
    BLACK,
    PAWN,
    KING
} from "chess.js";

import { pieceValues } from "@/constants/utils";
import { isPieceSafe } from "../utils/pieceSafety";
import { BoardPiece, getBoardPieces } from "../types/BoardPiece";
import Evaluation from "@/types/game/position/Evaluation";
import { parseUciMove } from "@/lib/utils/chess";

export interface Finding {
    text: string;
    weight: number;
    family: string;
}

export interface LineOutcome {
    delta: number;
    lostPieces: PieceSymbol[];
    wonPieces: PieceSymbol[];
    moves: Move[];
    board: Chess;
}

export const pieceWords: Record<PieceSymbol, string> = {
    p: "pawn",
    n: "knight",
    b: "bishop",
    r: "rook",
    q: "queen",
    k: "king"
};

const FILES = "abcdefgh";

export function opposite(colour: Color): Color {
    return colour == WHITE ? BLACK : WHITE;
}

export function colourWord(colour: Color) {
    return colour == WHITE ? "White" : "Black";
}

export function lowerFirst(text: string) {
    return text.charAt(0).toLowerCase() + text.slice(1);
}

export function upperFirst(text: string) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

export function withArticle(word: string) {
    return (/^[aeiou]/i.test(word) ? "an " : "a ") + word;
}

export function listJoin(items: string[]) {
    if (items.length <= 1) return items.join("");

    return items.slice(0, -1).join(", ") + " and " + items.at(-1);
}

export function describePiece(piece: { type: PieceSymbol; square: Square }) {
    return `${pieceWords[piece.type]} on ${piece.square}`;
}

export function fileIndex(square: Square) {
    return FILES.indexOf(square.charAt(0));
}

export function rankIndex(square: Square) {
    return parseInt(square.charAt(1)) - 1;
}

export function squareAt(file: number, rank: number): Square | undefined {
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return undefined;

    return (FILES.charAt(file) + (rank + 1)) as Square;
}

export function relativeRank(square: Square, colour: Color) {
    const rank = rankIndex(square);

    return colour == WHITE ? rank + 1 : 8 - rank;
}

export function pieceAt(board: Chess, square: Square): BoardPiece | undefined {
    const piece = board.get(square);
    if (!piece) return undefined;

    return { square, type: piece.type, color: piece.color };
}

export function materialOf(board: Chess, colour: Color) {
    return getBoardPieces(board)
        .filter(piece => piece.color == colour && piece.type != KING)
        .reduce((sum, piece) => sum + pieceValues[piece.type], 0);
}

export function materialBalance(board: Chess, colour: Color) {
    return materialOf(board, colour) - materialOf(board, opposite(colour));
}

export function piecesOf(
    board: Chess,
    colour: Color,
    type?: PieceSymbol
) {
    return getBoardPieces(board).filter(piece => (
        piece.color == colour && (!type || piece.type == type)
    ));
}

export function mateLength(evaluation: Evaluation) {
    return Math.abs(evaluation.value);
}

export function playLine(
    fen: string,
    line: { san: string }[],
    maxPlies: number
) {
    const board = new Chess(fen);
    const played: Move[] = [];

    for (const lineMove of line.slice(0, maxPlies)) {
        try {
            played.push(board.move(lineMove.san));
        } catch {
            break;
        }
    }

    return { board, played };
}

export function evaluateLine(
    fen: string,
    line: { san: string }[],
    mover: Color,
    maxPlies = 6
): LineOutcome {
    const board = new Chess(fen);
    const start = materialBalance(board, mover);

    const played: Move[] = [];
    const balances: number[] = [];

    for (const lineMove of line.slice(0, maxPlies)) {
        try {
            played.push(board.move(lineMove.san));
            balances.push(materialBalance(board, mover));
        } catch {
            break;
        }
    }

    let settledIndex = played.length - 1;

    for (let index = played.length - 1; index >= 0; index--) {
        if (!played[index].captured && !played[index].promotion) {
            settledIndex = index;
            break;
        }
    }

    const settledMoves = played.slice(0, settledIndex + 1);

    const settledBoard = settledIndex >= 0
        ? new Chess(played[settledIndex].after)
        : new Chess(fen);

    return {
        delta: settledIndex >= 0 ? balances[settledIndex] - start : 0,
        lostPieces: settledMoves
            .filter(move => move.color != mover && move.captured)
            .map(move => move.captured!),
        wonPieces: settledMoves
            .filter(move => move.color == mover && move.captured)
            .map(move => move.captured!),
        moves: settledMoves,
        board: settledBoard
    };
}

export function pawnsOnFile(board: Chess, file: number, colour?: Color) {
    return getBoardPieces(board).filter(piece => (
        piece.type == PAWN
        && fileIndex(piece.square) == file
        && (!colour || piece.color == colour)
    ));
}

export function doubledPawnCount(board: Chess, colour: Color) {
    let doubled = 0;

    for (let file = 0; file < 8; file++) {
        doubled += Math.max(0, pawnsOnFile(board, file, colour).length - 1);
    }

    return doubled;
}

export function isolatedPawns(board: Chess, colour: Color) {
    return piecesOf(board, colour, PAWN).filter(pawn => {
        const file = fileIndex(pawn.square);

        return (
            pawnsOnFile(board, file - 1, colour).length == 0
            && pawnsOnFile(board, file + 1, colour).length == 0
        );
    });
}

export function isPassedPawn(board: Chess, pawn: BoardPiece) {
    const file = fileIndex(pawn.square);
    const rank = relativeRank(pawn.square, pawn.color);

    return !getBoardPieces(board).some(piece => (
        piece.type == PAWN
        && piece.color != pawn.color
        && Math.abs(fileIndex(piece.square) - file) <= 1
        && relativeRank(piece.square, pawn.color) > rank
    ));
}

export function passedPawns(board: Chess, colour: Color) {
    return piecesOf(board, colour, PAWN).filter(
        pawn => isPassedPawn(board, pawn)
    );
}

export function getKingSquare(board: Chess, colour: Color) {
    return piecesOf(board, colour, KING).at(0)?.square;
}

export function pieceMobility(board: Chess, square: Square, colour: Color) {
    try {
        const parts = board.fen().split(" ");
        parts[1] = colour;
        parts[3] = "-";

        return new Chess(parts.join(" "))
            .moves({ square, verbose: true }).length;
    } catch {
        return 0;
    }
}

export function castlingRights(fen: string, colour: Color) {
    const rights = fen.split(" ")[2] || "-";

    return colour == WHITE
        ? /[KQ]/.test(rights)
        : /[kq]/.test(rights);
}

export function uciToSquares(uci: string | undefined) {
    if (!uci) return undefined;

    return parseUciMove(uci);
}

const CACHE_LIMIT = 6000;

const unsafeCache = new Map<string, BoardPiece[]>();
const safeCache = new Map<string, boolean>();
const mobilityCache = new Map<string, number>();

function remember<T>(cache: Map<string, T>, key: string, compute: () => T) {
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const value = compute();

    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(key, value);

    return value;
}

export function cachedPieceSafe(
    board: Chess,
    piece: BoardPiece,
    playedMove?: Move
) {
    return remember(
        safeCache,
        `${board.fen()}|${piece.color}${piece.type}${piece.square}|${playedMove?.san || ""}`,
        () => (
            board.attackers(piece.square, opposite(piece.color)).length == 0
            || isPieceSafe(board, piece, playedMove)
        )
    );
}

export function cachedUnsafePieces(
    board: Chess,
    colour: Color,
    playedMove?: Move
) {
    return remember(
        unsafeCache,
        `${board.fen()}|${colour}|${playedMove?.san || ""}`,
        () => {
            const capturedValue = playedMove?.captured
                ? pieceValues[playedMove.captured]
                : 0;

            return getBoardPieces(board).filter(piece => (
                piece.color == colour
                && piece.type != PAWN
                && piece.type != KING
                && pieceValues[piece.type] > capturedValue
                && !cachedPieceSafe(board, piece, playedMove)
            ));
        }
    );
}

export function cachedMobility(board: Chess, square: Square, colour: Color) {
    return remember(
        mobilityCache,
        `${board.fen()}|${square}|${colour}`,
        () => pieceMobility(board, square, colour)
    );
}
