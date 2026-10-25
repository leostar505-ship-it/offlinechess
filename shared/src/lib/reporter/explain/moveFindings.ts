import {
    Chess,
    Color,
    Move,
    Square,
    WHITE,
    PAWN,
    KNIGHT,
    BISHOP,
    ROOK,
    QUEEN,
    KING
} from "chess.js";

import { pieceValues } from "@/constants/utils";
import Evaluation from "@/types/game/position/Evaluation";
import { getCaptureSquare } from "@/lib/utils/chess";
import { BoardPiece } from "../types/BoardPiece";
import {
    Finding,
    opposite,
    pieceWords,
    colourWord,
    withArticle,
    listJoin,
    describePiece,
    fileIndex,
    rankIndex,
    squareAt,
    relativeRank,
    pieceAt,
    piecesOf,
    pawnsOnFile,
    doubledPawnCount,
    isolatedPawns,
    isPassedPawn,
    getKingSquare,
    cachedPieceSafe,
    cachedUnsafePieces,
    cachedMobility,
    castlingRights,
    materialOf
} from "./helpers";
import { themeFindings } from "./themes";

export interface MoveFacts {
    before: Chess;
    after: Chess;
    move: Move;
    mover: Color;
    opponent: Color;
    parentMove?: { to: Square; captured: boolean };
    ownPreviousTo?: Square;
    bestMoveFrom?: Square;
    subjective?: Evaluation;
    lineBoard?: Chess;
    onlyMove?: boolean;
    opponentReplies?: { uci: string; subjective: Evaluation }[];
}

const CENTER_SQUARES: Square[] = ["d4", "e4", "d5", "e5"];

const EXTENDED_CENTER = new Set<string>([
    "c3", "d3", "e3", "f3",
    "c4", "d4", "e4", "f4",
    "c5", "d5", "e5", "f5",
    "c6", "d6", "e6", "f6"
]);

const ROOK_DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRECTIONS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

export function forkTargets(
    board: Chess,
    square: Square,
    attackerColour: Color
) {
    const forker = pieceAt(board, square);
    if (!forker || forker.type == KING) return [];

    return piecesOf(board, opposite(attackerColour)).filter(target => {
        if (target.type == PAWN) return false;
        if (!board.attackers(target.square, attackerColour).includes(square))
            return false;

        if (target.type == KING) return true;
        if (pieceValues[target.type] > pieceValues[forker.type]) return true;

        return !cachedPieceSafe(board, target);
    });
}

export function findPinOrSkewer(
    board: Chess,
    square: Square,
    colour: Color
) {
    const slider = pieceAt(board, square);
    if (!slider) return undefined;

    let directions: number[][];

    if (slider.type == BISHOP) {
        directions = BISHOP_DIRECTIONS;
    } else if (slider.type == ROOK) {
        directions = ROOK_DIRECTIONS;
    } else if (slider.type == QUEEN) {
        directions = [...ROOK_DIRECTIONS, ...BISHOP_DIRECTIONS];
    } else {
        return undefined;
    }

    for (const [fileStep, rankStep] of directions) {
        const found: BoardPiece[] = [];

        let file = fileIndex(square) + fileStep;
        let rank = rankIndex(square) + rankStep;

        while (found.length < 2) {
            const nextSquare = squareAt(file, rank);
            if (!nextSquare) break;

            const piece = pieceAt(board, nextSquare);
            if (piece) found.push(piece);

            file += fileStep;
            rank += rankStep;
        }

        if (found.length < 2) continue;

        const [front, back] = found;

        if (front.color == colour || back.color == colour) continue;

        if (
            front.type != KING
            && front.type != PAWN
            && (back.type == KING || pieceValues[back.type] > pieceValues[front.type])
        ) {
            return `Pins the ${describePiece(front)} to the ${pieceWords[back.type]}`;
        }

        if (
            (front.type == KING || pieceValues[front.type] >= 5)
            && back.type != KING
            && back.type != PAWN
            && pieceValues[front.type] > pieceValues[back.type]
        ) {
            return `Skewers the ${pieceWords[front.type]} and the ${describePiece(back)}`;
        }
    }

    return undefined;
}

export function isEndgame(board: Chess) {
    const queens = (
        piecesOf(board, "w", QUEEN).length
        + piecesOf(board, "b", QUEEN).length
    );

    const minorAndMajor = (colour: Color) => materialOf(board, colour)
        - piecesOf(board, colour, PAWN).length;

    return queens == 0 || minorAndMajor("w") + minorAndMajor("b") <= 16;
}

function bishopCount(board: Chess, colour: Color) {
    return piecesOf(board, colour, BISHOP).length;
}

function roomsConnected(board: Chess, colour: Color) {
    const rooks = piecesOf(board, colour, ROOK);
    if (rooks.length < 2) return false;

    const [first, second] = rooks;
    if (rankIndex(first.square) != rankIndex(second.square)) return false;

    const low = Math.min(fileIndex(first.square), fileIndex(second.square));
    const high = Math.max(fileIndex(first.square), fileIndex(second.square));

    for (let file = low + 1; file < high; file++) {
        const between = squareAt(file, rankIndex(first.square));
        if (between && board.get(between)) return false;
    }

    return true;
}

function centerControl(board: Chess, colour: Color) {
    return CENTER_SQUARES.reduce(
        (sum, square) => sum + board.attackers(square, colour).length,
        0
    );
}

export function moveMerits(facts: MoveFacts): Finding[] {
    const { before, after, move, mover, opponent } = facts;

    const findings: Finding[] = [];
    const opening = before.moveNumber() <= 12;
    const moverNow: BoardPiece = {
        square: move.to,
        type: move.promotion || move.piece,
        color: mover
    };

    if (move.san.includes("#")) {
        findings.push({
            text: "Delivers checkmate",
            weight: 100,
            family: "mate"
        });
    }

    if (move.promotion) {
        findings.push({
            text: `Promotes the pawn to ${withArticle(pieceWords[move.promotion])}`,
            weight: move.promotion == QUEEN ? 95 : 80,
            family: "material"
        });
    }

    if (move.captured) {
        const victim: BoardPiece = {
            type: move.captured,
            square: getCaptureSquare(move),
            color: opponent
        };

        const victimWord = pieceWords[move.captured];
        const capturerWord = pieceWords[move.piece];

        if (facts.parentMove?.captured && facts.parentMove.to == move.to) {
            findings.push({
                text: `Recaptures on ${move.to}, restoring the material balance`,
                weight: 82,
                family: "material"
            });
        } else if (
            !cachedPieceSafe(before, victim)
            && (
                cachedPieceSafe(after, moverNow, move)
                || pieceValues[move.captured] >= pieceValues[move.piece]
            )
        ) {
            findings.push({
                text: `Wins a free ${victimWord}`,
                weight: move.captured == PAWN ? 70 : 88,
                family: "material"
            });
        } else if (pieceValues[move.captured] > pieceValues[move.piece]) {
            findings.push({
                text: `Wins the ${victimWord} with a less valuable ${capturerWord}`,
                weight: 80,
                family: "material"
            });
        } else if (pieceValues[move.captured] == pieceValues[move.piece]) {
            findings.push({
                text: move.piece == move.captured
                    ? `Trades ${victimWord}s`
                    : `Trades ${withArticle(capturerWord)} for ${withArticle(victimWord)}`,
                weight: 42,
                family: "trade"
            });
        } else {
            findings.push({
                text: `Captures the ${victimWord}`,
                weight: 40,
                family: "material"
            });
        }
    }

    if (move.san.includes("+") && !move.san.includes("#")) {
        const kingSquare = getKingSquare(after, opponent);

        const directCheck = kingSquare
            ? after.attackers(kingSquare, mover).includes(move.to)
            : false;

        findings.push(directCheck
            ? {
                text: `Gives check, forcing ${colourWord(opponent)} to respond`,
                weight: 45,
                family: "tactic"
            }
            : {
                text: "Discovers a check",
                weight: 72,
                family: "tactic"
            }
        );
    }

    let forked = false;

    if (move.piece != KING) {
        const targets = forkTargets(after, move.to, mover);

        const forkerSafe = (
            cachedPieceSafe(after, moverNow, move)
            || targets.some(target => target.type == KING)
        );

        if (targets.length >= 2 && forkerSafe) {
            forked = true;

            findings.push({
                text: `Forks the ${listJoin(targets.map(describePiece))}`,
                weight: 86,
                family: "tactic"
            });
        }
    }

    const pinText = findPinOrSkewer(after, move.to, mover);

    if (pinText) {
        findings.push({ text: pinText, weight: 62, family: "tactic" });
    }

    if (!forked) {
        const threatened = piecesOf(after, opponent)
            .filter(target => (
                target.type != PAWN
                && target.type != KING
                && after.attackers(target.square, mover).includes(move.to)
                && (
                    pieceValues[target.type] > pieceValues[moverNow.type]
                    || !cachedPieceSafe(after, target)
                )
            ))
            .sort((a, b) => pieceValues[b.type] - pieceValues[a.type]);

        if (threatened.length > 0) {
            findings.push({
                text: `Attacks the ${describePiece(threatened[0])}`,
                weight: 52,
                family: "threat"
            });
        }
    }

    if (!forked) {
        const weakPawn = piecesOf(after, opponent, PAWN).find(pawn => (
            after.attackers(pawn.square, mover).includes(move.to)
            && !cachedPieceSafe(after, pawn)
        ));

        if (weakPawn && move.piece != PAWN) {
            findings.push({
                text: `Attacks the undefended pawn on ${weakPawn.square}`,
                weight: 46,
                family: "threat"
            });
        }
    }

    const unsafeBefore = cachedUnsafePieces(before, mover);
    const unsafeAfter = cachedUnsafePieces(after, mover);

    const movedWasUnsafe = unsafeBefore.some(
        piece => piece.square == move.from && piece.type == move.piece
    );

    const movedStillUnsafe = unsafeAfter.some(
        piece => piece.square == move.to && piece.type == move.piece
    );

    if (movedWasUnsafe && !movedStillUnsafe) {
        findings.push({
            text: `Moves the ${pieceWords[move.piece]} out of danger`,
            weight: 60,
            family: "safety"
        });
    } else {
        const defended = unsafeBefore.find(piece => (
            piece.square != move.from
            && !unsafeAfter.some(other => other.square == piece.square)
            && after.attackers(piece.square, mover).includes(move.to)
        ));

        if (defended) {
            findings.push({
                text: `Protects the ${describePiece(defended)}`,
                weight: 58,
                family: "safety"
            });
        }
    }

    if (move.isKingsideCastle() || move.isQueensideCastle()) {
        findings.push({
            text: `Castles ${move.isKingsideCastle() ? "kingside" : "queenside"}, getting the king to safety and bringing a rook into the game`,
            weight: 78,
            family: "king"
        });
    }

    const backRank = move.color == WHITE ? "1" : "8";

    if (
        (move.piece == KNIGHT || move.piece == BISHOP)
        && move.from.endsWith(backRank)
        && !move.captured
        && opening
    ) {
        findings.push({
            text: EXTENDED_CENTER.has(move.to)
                ? `Develops the ${pieceWords[move.piece]} toward the center`
                : `Develops the ${pieceWords[move.piece]}`,
            weight: 60,
            family: "development"
        });
    }

    if (move.piece == PAWN && opening) {
        if (!move.captured && CENTER_SQUARES.includes(move.to)) {
            findings.push({
                text: "Claims space in the center",
                weight: 62,
                family: "center"
            });
        } else if (move.captured && (move.to[0] == "d" || move.to[0] == "e")) {
            findings.push({
                text: "Opens up the center",
                weight: 48,
                family: "center"
            });
        }
    }

    if (centerControl(after, mover) - centerControl(before, mover) >= 2) {
        findings.push({
            text: "Increases your control of the center",
            weight: 40,
            family: "center"
        });
    }

    if (move.piece == ROOK && !move.captured) {
        const file = fileIndex(move.to);
        const own = pawnsOnFile(after, file, mover).length;
        const enemy = pawnsOnFile(after, file, opponent).length;

        if (own == 0 && enemy == 0) {
            findings.push({
                text: "Places the rook on an open file",
                weight: 60,
                family: "activity"
            });
        } else if (own == 0) {
            findings.push({
                text: "Places the rook on a half-open file, pressuring the pawn there",
                weight: 50,
                family: "activity"
            });
        }

        if (relativeRank(move.to, mover) == 7) {
            findings.push({
                text: "Invades the seventh rank with the rook",
                weight: 55,
                family: "activity"
            });
        }
    }

    if (!roomsConnected(before, mover) && roomsConnected(after, mover)) {
        findings.push({
            text: "Connects the rooks",
            weight: 45,
            family: "development"
        });
    }

    if (move.piece == KNIGHT) {
        const rank = relativeRank(move.to, mover);

        const supported = after.attackers(move.to, mover).some(
            square => after.get(square)?.type == PAWN
        );

        const kickable = piecesOf(after, opponent, PAWN).some(pawn => (
            Math.abs(fileIndex(pawn.square) - fileIndex(move.to)) == 1
            && relativeRank(pawn.square, mover) > rank
        ));

        if (rank >= 5 && rank <= 6 && supported && !kickable) {
            findings.push({
                text: `Plants the knight on a strong outpost on ${move.to}`,
                weight: 66,
                family: "activity"
            });
        }
    }

    if (move.piece != PAWN && move.piece != KING && !move.captured) {
        const gain = (
            cachedMobility(after, move.to, mover)
            - cachedMobility(before, move.from, mover)
        );

        if (gain >= 4) {
            findings.push({
                text: `Activates the ${pieceWords[move.piece]}, giving it much more scope`,
                weight: 45,
                family: "activity"
            });
        }
    }

    if (move.piece == PAWN) {
        const pawnNow = pieceAt(after, move.to);

        if (pawnNow && isPassedPawn(after, pawnNow)) {
            const wasPassed = isPassedPawn(
                before,
                { square: move.from, type: PAWN, color: mover }
            );

            if (!wasPassed) {
                findings.push({
                    text: `Creates a passed pawn on ${move.to}`,
                    weight: 62,
                    family: "structure"
                });
            } else if (relativeRank(move.to, mover) >= 5) {
                findings.push({
                    text: "Pushes the passed pawn closer to promotion",
                    weight: 54,
                    family: "structure"
                });
            }
        }
    }

    if (
        move.piece == KING
        && !move.isKingsideCastle()
        && !move.isQueensideCastle()
        && isEndgame(after)
    ) {
        const distance = (square: Square) => Math.max(
            Math.abs(fileIndex(square) - 3.5),
            Math.abs(rankIndex(square) - 3.5)
        );

        if (distance(move.to) < distance(move.from)) {
            findings.push({
                text: "Brings the king toward the center, where it is a strong endgame piece",
                weight: 56,
                family: "endgame"
            });
        }
    }

    if (
        move.captured
        && pieceValues[move.captured] >= 3
        && pieceValues[move.captured] == pieceValues[move.piece]
        && facts.subjective?.type == "centipawn"
        && facts.subjective.value >= 150
    ) {
        findings.push({
            text: "Trades pieces while ahead, which brings you closer to a win",
            weight: 44,
            family: "trade"
        });
    }

    if (
        bishopCount(before, opponent) >= 2
        && bishopCount(after, opponent) < 2
        && bishopCount(after, mover) >= 2
    ) {
        findings.push({
            text: "Wins the bishop pair",
            weight: 48,
            family: "structure"
        });
    }

    if (
        move.captured
        && doubledPawnCount(after, opponent) > doubledPawnCount(before, opponent)
    ) {
        findings.push({
            text: `Doubles ${colourWord(opponent)}'s pawns`,
            weight: 46,
            family: "structure"
        });
    }

    findings.push(...themeFindings(facts));

    return findings.sort((a, b) => b.weight - a.weight);
}

export function moveDrawbacks(facts: MoveFacts): Finding[] {
    const { before, after, move, mover, opponent } = facts;

    const findings: Finding[] = [];
    const opening = before.moveNumber() <= 12;

    if (
        move.piece == KING
        && !move.isKingsideCastle()
        && !move.isQueensideCastle()
        && castlingRights(before.fen(), mover)
        && !castlingRights(after.fen(), mover)
    ) {
        findings.push({
            text: "Gives up the right to castle",
            weight: 66,
            family: "king"
        });
    }

    const kingSquare = getKingSquare(after, mover);

    if (
        move.piece == PAWN
        && !move.captured
        && kingSquare
        && relativeRank(kingSquare, mover) == 1
    ) {
        const kingFile = fileIndex(kingSquare);
        const pawnFile = fileIndex(move.from);

        const shelter = kingFile >= 6
            ? pawnFile >= 5
            : (kingFile <= 2 && pawnFile <= 3);

        if (
            shelter
            && Math.abs(pawnFile - kingFile) <= 1
            && relativeRank(move.from, mover) <= 3
        ) {
            findings.push({
                text: "Pushing this pawn loosens the cover around your king",
                weight: 64,
                family: "king"
            });
        }
    }

    if (
        move.piece == QUEEN
        && !move.captured
        && !move.san.includes("+")
        && before.moveNumber() <= 8
    ) {
        findings.push({
            text: "Brings the queen out early, where it can be chased around",
            weight: 56,
            family: "development"
        });
    }

    if (
        opening
        && !move.captured
        && move.piece != PAWN
        && move.piece != KING
        && facts.ownPreviousTo == move.from
        && facts.bestMoveFrom != facts.ownPreviousTo
    ) {
        findings.push({
            text: "Moves the same piece twice in the opening instead of developing another one",
            weight: 58,
            family: "development"
        });
    }

    if (
        move.piece == PAWN
        && !move.captured
        && before.moveNumber() <= 8
        && (move.from[0] == "a" || move.from[0] == "h")
    ) {
        findings.push({
            text: "An edge pawn move this early does little for your development or the center",
            weight: 52,
            family: "development"
        });
    }

    if (
        move.piece == KNIGHT
        && !move.captured
        && (move.to[0] == "a" || move.to[0] == "h")
    ) {
        findings.push({
            text: "A knight on the edge controls fewer squares",
            weight: 50,
            family: "activity"
        });
    }

    if (
        move.piece != PAWN
        && move.piece != KING
        && !move.captured
        && relativeRank(move.to, mover) <= 2
        && relativeRank(move.from, mover) > relativeRank(move.to, mover)
        && before.moveNumber() >= 4
    ) {
        findings.push({
            text: `Retreats the ${pieceWords[move.piece]}, giving up activity`,
            weight: 48,
            family: "activity"
        });
    }

    if (move.piece != PAWN && move.piece != KING && !move.captured) {
        const change = (
            cachedMobility(after, move.to, mover)
            - cachedMobility(before, move.from, mover)
        );

        if (change <= -4) {
            findings.push({
                text: `The ${pieceWords[move.piece]} ends up with less room to operate`,
                weight: 44,
                family: "activity"
            });
        }
    }

    if (doubledPawnCount(after, mover) > doubledPawnCount(before, mover)) {
        findings.push({
            text: "Leaves you with doubled pawns",
            weight: 54,
            family: "structure"
        });
    }

    if (isolatedPawns(after, mover).length > isolatedPawns(before, mover).length) {
        findings.push({
            text: "Leaves you with an isolated pawn",
            weight: 54,
            family: "structure"
        });
    }

    if (
        facts.lineBoard
        && bishopCount(before, mover) >= 2
        && bishopCount(facts.lineBoard, mover) < 2
    ) {
        findings.push({
            text: "Gives up the bishop pair",
            weight: 46,
            family: "structure"
        });
    }

    if (
        move.captured
        && pieceValues[move.captured] >= 3
        && pieceValues[move.captured] == pieceValues[move.piece]
        && facts.subjective?.type == "centipawn"
        && facts.subjective.value <= -150
    ) {
        findings.push({
            text: `Trading pieces when behind makes it easier for ${colourWord(opponent)} to convert`,
            weight: 40,
            family: "trade"
        });
    }

    return findings.sort((a, b) => b.weight - a.weight);
}
