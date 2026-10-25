import { Chess, Color, Move, Square, KING, PAWN } from "chess.js";

import { pieceValues } from "@/constants/utils";
import Evaluation from "@/types/game/position/Evaluation";
import { parseUciMove } from "@/lib/utils/chess";
import {
    Finding,
    colourWord,
    listJoin,
    describePiece,
    fileIndex,
    rankIndex,
    squareAt,
    getKingSquare,
    piecesOf,
    passedPawns
} from "./helpers";

export type HighlightKind = "danger" | "defended" | "promotion";

export interface ThemeHighlight {
    square: Square;
    kind: HighlightKind;
}

export interface Theme {
    id: string;
    label: string;
    text: string;
    weight: number;
    family: string;
    square?: Square;
    highlights: ThemeHighlight[];
}

export interface ThemeFacts {
    before: Chess;
    after: Chess;
    move: Move;
    mover: Color;
    opponent: Color;
    onlyMove?: boolean;
    opponentReplies?: { uci: string; subjective: Evaluation }[];
}

function distance(a: Square, b: Square) {
    return Math.max(
        Math.abs(fileIndex(a) - fileIndex(b)),
        Math.abs(rankIndex(a) - rankIndex(b))
    );
}

function pawnEnding(board: Chess) {
    return ![...piecesOf(board, "w"), ...piecesOf(board, "b")]
        .some(piece => piece.type != PAWN && piece.type != KING);
}

function winningFor(evaluation: Evaluation) {
    return evaluation.type == "mate"
        ? evaluation.value > 0
        : evaluation.value >= 250;
}

function defendedTheme(facts: ThemeFacts): Theme | undefined {
    const { before, after, move, mover, opponent } = facts;

    const defended = piecesOf(after, mover)
        .filter(piece => piece.type != KING && piece.square != move.to)
        .filter(piece => (
            before.get(piece.square)?.type == piece.type
            && before.get(piece.square)?.color == mover
        ))
        .filter(piece => {
            const attackers = after.attackers(piece.square, opponent);
            if (attackers.length == 0) return false;

            const defendersNow = after.attackers(piece.square, mover).length;
            const defendersBefore = before.attackers(piece.square, mover).length;

            return defendersNow > defendersBefore;
        })
        .sort((a, b) => pieceValues[b.type] - pieceValues[a.type])
        .slice(0, 3);

    if (defended.length == 0) return undefined;

    return {
        id: "defends",
        label: defended.length > 1 ? "Defends Pieces" : "Defends a Piece",
        text: `Defends the ${listJoin(defended.map(describePiece))}`,
        weight: 52,
        family: "safety",
        square: defended[0].square,
        highlights: defended.map(piece => ({
            square: piece.square,
            kind: "defended" as const
        }))
    };
}

function oppositionTheme(facts: ThemeFacts): Theme | undefined {
    const { after, move, mover, opponent } = facts;

    if (move.piece != KING || !pawnEnding(after)) return undefined;
    if (after.turn() != opponent || after.isCheck()) return undefined;

    const own = getKingSquare(after, mover);
    const enemy = getKingSquare(after, opponent);

    if (!own || !enemy) return undefined;

    const sameFile = fileIndex(own) == fileIndex(enemy);
    const sameRank = rankIndex(own) == rankIndex(enemy);

    if (!sameFile && !sameRank) return undefined;
    if (distance(own, enemy) != 2) return undefined;

    const between = squareAt(
        (fileIndex(own) + fileIndex(enemy)) / 2,
        (rankIndex(own) + rankIndex(enemy)) / 2
    );

    if (!between) return undefined;

    return {
        id: "opposition",
        label: "Opposition",
        text: `Takes the opposition and keeps the ${colourWord(opponent)} king back`,
        weight: 66,
        family: "endgame",
        square: move.to,
        highlights: [{ square: between, kind: "danger" }]
    };
}

function promotionTheme(facts: ThemeFacts): Theme | undefined {
    const { after, move, mover, opponent } = facts;

    if (move.piece != KING || !pawnEnding(after)) return undefined;

    const kingNow = move.to;
    const kingBefore = move.from;

    const promotionSquare = (file: number, colour: Color) => (
        squareAt(file, colour == "w" ? 7 : 0)
    );

    const own = passedPawns(after, mover)
        .map(pawn => promotionSquare(fileIndex(pawn.square), mover))
        .filter((square): square is Square => !!square)
        .find(square => (
            distance(kingNow, square) <= 1 && distance(kingBefore, square) > 1
        ));

    if (own) {
        return {
            id: "promotion-control",
            label: "Controls Promotion Square",
            text: `Takes control of the promotion square on ${own}`,
            weight: 64,
            family: "endgame",
            square: kingNow,
            highlights: [{ square: own, kind: "promotion" }]
        };
    }

    const enemy = passedPawns(after, opponent)
        .map(pawn => promotionSquare(fileIndex(pawn.square), opponent))
        .filter((square): square is Square => !!square)
        .find(square => (
            distance(kingNow, square) <= 1 && distance(kingBefore, square) > 1
        ));

    if (enemy) {
        return {
            id: "promotion-block",
            label: "Blocks Promotion",
            text: `Stands in front of ${colourWord(opponent)}'s passed pawn and makes promotion on ${enemy} harder`,
            weight: 62,
            family: "endgame",
            square: kingNow,
            highlights: [{ square: enemy, kind: "promotion" }]
        };
    }

    return undefined;
}

function zugzwangTheme(facts: ThemeFacts): Theme | undefined {
    const { after, move, opponent, opponentReplies } = facts;

    if (!opponentReplies || opponentReplies.length == 0) return undefined;
    if (!pawnEnding(after)) return undefined;
    if (after.turn() != opponent || after.isCheck()) return undefined;

    const legal = after.moves({ verbose: true });

    if (legal.length == 0 || legal.length > opponentReplies.length) {
        return undefined;
    }

    const covered = legal.every(reply => opponentReplies.some(candidate => {
        const squares = parseUciMove(candidate.uci);

        return (
            squares.from == reply.from
            && squares.to == reply.to
            && winningFor(candidate.subjective)
        );
    }));

    if (!covered) return undefined;

    return {
        id: "zugzwang",
        label: "Zugzwang",
        text: `Puts ${colourWord(opponent)} in zugzwang, where every move makes their position worse`,
        weight: 74,
        family: "endgame",
        square: move.to,
        highlights: []
    };
}

function onlyMoveTheme(facts: ThemeFacts): Theme | undefined {
    if (!facts.onlyMove) return undefined;

    return {
        id: "only-move",
        label: "Only Good Move",
        text: "Finds the only good move in the position",
        weight: 58,
        family: "accuracy",
        square: facts.move.to,
        highlights: []
    };
}

export function detectThemes(facts: ThemeFacts): Theme[] {
    const themes: Theme[] = [];

    try {
        for (const detector of [
            defendedTheme,
            oppositionTheme,
            promotionTheme,
            zugzwangTheme,
            onlyMoveTheme
        ]) {
            const theme = detector(facts);
            if (theme) themes.push(theme);
        }
    } catch {
        return [];
    }

    return themes.sort((a, b) => b.weight - a.weight);
}

export function themeFindings(facts: ThemeFacts): Finding[] {
    return detectThemes(facts).map(theme => ({
        text: theme.text,
        weight: theme.weight,
        family: theme.family
    }));
}
