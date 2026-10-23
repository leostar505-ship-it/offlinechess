import { Chess, Color, Move, Square, ROOK, QUEEN } from "chess.js";

import { Classification } from "@/constants/Classification";
import { PieceColour, adaptPieceColour } from "@/constants/PieceColour";
import { pieceValues } from "@/constants/utils";
import { StateTreeNode } from "@/types/game/position/StateTreeNode";
import Evaluation from "@/types/game/position/Evaluation";
import {
    getSubjectiveEvaluation,
    stringifyEvaluation,
    parseUciMove,
    getCaptureSquare
} from "@/lib/utils/chess";
import AnalysisOptions from "../types/AnalysisOptions";
import {
    ExtractedCurrentNode,
    ExtractedPreviousNode
} from "../types/ExtractedNode";
import { isPieceTrapped } from "../utils/pieceTrapped";
import {
    Finding,
    LineOutcome,
    opposite,
    colourWord,
    pieceWords,
    withArticle,
    listJoin,
    describePiece,
    cachedUnsafePieces,
    lowerFirst,
    upperFirst,
    mateLength,
    evaluateLine,
    playLine,
    materialBalance,
    getKingSquare,
    relativeRank
} from "./helpers";
import {
    MoveFacts,
    moveMerits,
    moveDrawbacks,
    forkTargets
} from "./moveFindings";

interface Context {
    node: StateTreeNode;
    previous: ExtractedPreviousNode;
    current: ExtractedCurrentNode;
    mover: Color;
    opponent: Color;
    moverColour: PieceColour;
    before: Chess;
    after: Chess;
    playedMove: Move;
    prevSubj: Evaluation;
    currSubj: Evaluation;
    parentMove?: { to: Square; captured: boolean };
    ownPreviousTo?: Square;
    playedOutcome: LineOutcome;
    bestOutcome: LineOutcome;
    playedGain: number;
}

const tierNames = ["losing", "worse", "equal", "better", "winning"];

function tierOf(evaluation: Evaluation) {
    if (evaluation.type == "mate") return evaluation.value > 0 ? 4 : 0;

    const value = evaluation.value;

    if (value >= 200) return 4;
    if (value >= 80) return 3;
    if (value > -80) return 2;
    if (value > -200) return 1;

    return 0;
}

function materialWords(points: number) {
    const rounded = Math.round(points);

    if (rounded <= 1) return "a pawn";
    if (rounded == 2) return "two pawns' worth of material";
    if (rounded == 3) return "a piece";

    if (rounded == 4) return "a piece and a pawn";
    if (rounded < 8) return "about a rook's worth of material";

    return "a queen's worth of material";
}

function sentence(text: string) {
    const trimmed = upperFirst(text.trim());

    return /[.!?]$/.test(trimmed) ? trimmed : trimmed + ".";
}

function standingPhrase(evaluation: Evaluation) {
    if (evaluation.type == "mate") {
        return evaluation.value > 0
            ? `Keeps your forced checkmate in ${mateLength(evaluation)} on the board`
            : "Delays the checkmate as long as possible";
    }

    const value = evaluation.value;

    if (value >= 500) return "Keeps you completely winning";
    if (value >= 200) return "Maintains your clear advantage";
    if (value >= 80) return "Keeps your slight edge";
    if (value > -80) return "Keeps the position balanced";
    if (value > -200) return "Holds on in a slightly worse position";
    if (value > -500) return "Gives you the best chance in a difficult position";

    return "Puts up the toughest resistance in a very difficult position";
}

function bestFromSquare(ctx: Context) {
    return ctx.previous.topMove.from;
}

function buildFacts(ctx: Context): MoveFacts {
    return {
        before: ctx.before,
        after: ctx.after,
        move: ctx.playedMove,
        mover: ctx.mover,
        opponent: ctx.opponent,
        parentMove: ctx.parentMove,
        ownPreviousTo: ctx.ownPreviousTo,
        bestMoveFrom: bestFromSquare(ctx),
        subjective: ctx.currSubj,
        lineBoard: ctx.playedOutcome.board
    };
}

function bestMoveFindings(ctx: Context): Finding[] {
    const bestBoard = new Chess(ctx.before.fen());

    let bestMove: Move;

    try {
        bestMove = bestBoard.move(ctx.previous.topMove.san);
    } catch {
        return [];
    }

    const findings = moveMerits({
        before: ctx.before,
        after: bestBoard,
        move: bestMove,
        mover: ctx.mover,
        opponent: ctx.opponent,
        parentMove: ctx.parentMove,
        ownPreviousTo: ctx.ownPreviousTo,
        subjective: ctx.prevSubj
    });

    if (ctx.prevSubj.type == "mate" && ctx.prevSubj.value > 0) {
        findings.unshift({
            text: `Starts a forced checkmate in ${mateLength(ctx.prevSubj)}`,
            weight: 97,
            family: "mate"
        });
    }

    return findings;
}

function bestMoveLine(ctx: Context, lead: string) {
    const top = bestMoveFindings(ctx).at(0);
    if (!top || top.weight < 40) return undefined;

    return `${lead} ${ctx.previous.topMove.san}, which ${lowerFirst(top.text)}.`;
}

function pickFindings(findings: Finding[], limit = 2) {
    const picked: Finding[] = [];

    for (const finding of findings) {
        if (picked.length >= limit) break;
        if (picked.length > 0 && finding.weight < 45) break;
        if (picked.some(other => other.family == finding.family)) continue;

        picked.push(finding);
    }

    return picked;
}

function collectIssues(ctx: Context): Finding[] {
    const issues: Finding[] = [];

    const {
        previous,
        current,
        mover,
        opponent,
        before,
        after,
        playedMove,
        prevSubj,
        currSubj,
        playedOutcome,
        bestOutcome,
        playedGain
    } = ctx;

    const opponentName = colourWord(opponent);
    const missedMaterial = bestOutcome.delta - playedGain;

    if (currSubj.type == "mate" && currSubj.value < 0) {
        const length = mateLength(currSubj);
        const reply = current.topLine.moves.at(0)?.san;

        const mateLine = playLine(after.fen(), current.topLine.moves, length * 2);
        const lastMove = mateLine.played.at(-1);

        const matedKing = getKingSquare(mateLine.board, mover);

        const backRank = (
            !!lastMove
            && !!matedKing
            && lastMove.san.includes("#")
            && lastMove.color == opponent
            && (lastMove.piece == ROOK || lastMove.piece == QUEEN)
            && lastMove.to[1] == matedKing[1]
            && relativeRank(matedKing, mover) == 1
        );

        const text = length == 1 && reply
            ? `${reply} would be checkmate`
            : `${opponentName} gets a forced checkmate in ${length}`
                + (reply ? `, starting with ${reply}` : "");

        issues.push({
            text: text + (backRank ? " (a back-rank mate)" : ""),
            weight: 100,
            family: "mate"
        });
    }

    if (
        prevSubj.type == "mate"
        && prevSubj.value > 0
        && !(
            currSubj.type == "mate"
            && currSubj.value > 0
            && mateLength(currSubj) <= mateLength(prevSubj) + 1
        )
    ) {
        issues.push({
            text: `You had a forced checkmate in ${mateLength(prevSubj)}, starting with ${previous.topMove.san}`,
            weight: 96,
            family: "mate"
        });
    }

    const firstReply = playedOutcome.moves.at(0);

    if (
        firstReply
        && firstReply.color == opponent
        && playedOutcome.delta <= -0.9
        && playedOutcome.lostPieces.length > 0
    ) {
        const biggest = Math.max(
            ...playedOutcome.lostPieces.map(piece => pieceValues[piece])
        );

        const immediate = (
            !!firstReply.captured
            && Math.abs(-playedOutcome.delta - pieceValues[firstReply.captured]) <= 1
        );

        issues.push({
            text: immediate && firstReply.captured
                ? `${opponentName} can win your ${pieceWords[firstReply.captured]} on ${getCaptureSquare(firstReply)} with ${firstReply.san}`
                : `${opponentName} wins ${materialWords(-playedOutcome.delta)} by force, starting with ${firstReply.san}`,
            weight: biggest >= 9 ? 92 : biggest >= 5 ? 88 : biggest >= 3 ? 86 : 70,
            family: "material"
        });
    }

    if (missedMaterial >= 0.9 || playedOutcome.delta <= -0.9) {
        const unsafeBefore = cachedUnsafePieces(before, mover);
        const unsafeAfter = cachedUnsafePieces(after, mover);

        const ignored = unsafeAfter
            .filter(piece => (
                piece.square != playedMove.from
                && unsafeBefore.some(old => (
                    old.square == piece.square && old.type == piece.type
                ))
            ))
            .sort((a, b) => pieceValues[b.type] - pieceValues[a.type]);

        if (ignored.length > 0) {
            issues.push({
                text: `Your ${describePiece(ignored[0])} was already under attack and this move doesn't deal with it`,
                weight: 76,
                family: "material"
            });
        }

        const trapped = unsafeAfter.find(piece => (
            pieceValues[piece.type] >= 3 && isPieceTrapped(after, piece)
        ));

        if (trapped) {
            issues.push({
                text: `Your ${describePiece(trapped)} gets trapped and will be hard to save`,
                weight: 80,
                family: "material"
            });
        }
    }

    const reply = playedOutcome.moves.at(0);

    if (reply && reply.color == opponent && playedOutcome.delta <= -0.9) {
        const replyBoard = new Chess(after.fen());
        const replyPlayed = playLine(after.fen(), [reply], 1).played.length > 0;

        if (replyPlayed) {
            replyBoard.move(reply.san);

            const targets = forkTargets(replyBoard, reply.to, opponent);

            if (targets.length >= 2) {
                issues.push({
                    text: `${reply.san} forks your ${listJoin(targets.map(describePiece))}`,
                    weight: 85,
                    family: "tactic"
                });
            }
        }
    }

    return issues
        .filter(issue => issue.text.length > 0)
        .sort((a, b) => b.weight - a.weight);
}

function swingSentence(ctx: Context) {
    const mover = colourWord(ctx.mover);

    if (ctx.currSubj.type == "mate" && ctx.currSubj.value < 0) {
        return `This leaves ${colourWord(ctx.opponent)} completely winning, with checkmate in ${mateLength(ctx.currSubj)}`;
    }

    if (ctx.currSubj.type == "mate" && ctx.prevSubj.type == "mate") {
        return `${mover} is still completely winning, but the checkmate takes longer`;
    }

    return `This makes the position worse for ${mover}, from ${stringifyEvaluation(ctx.prevSubj, true)} to ${stringifyEvaluation(ctx.currSubj, true)}`;
}

function explainBadMove(ctx: Context) {
    const lines: string[] = [];

    const issues = pickFindings(collectIssues(ctx), 2)
        .filter(issue => issue.weight >= 55);

    const drawbacks = moveDrawbacks(buildFacts(ctx));

    if (issues.length > 0) {
        lines.push(issues.map(issue => sentence(issue.text)).join(" "));

        const extra = drawbacks.at(0);

        if (extra && extra.weight >= 50 && issues.length < 2) {
            lines[0] += " " + sentence(extra.text);
        }
    } else if (drawbacks.length > 0 && drawbacks[0].weight >= 44) {
        const picked = pickFindings(drawbacks, 2);
        lines.push(picked.map(finding => sentence(finding.text)).join(" "));

        lines.push(sentence(swingSentence(ctx)));
    } else {
        lines.push(sentence(swingSentence(ctx)));
    }

    const bestLine = bestMoveLine(ctx, "Better was");
    if (bestLine) lines.push(bestLine);

    return lines.join("\n");
}

function explainGoodMove(ctx: Context, classification: Classification) {
    const merits = pickFindings(moveMerits(buildFacts(ctx)), 2);

    const lines: string[] = [];

    if (merits.length > 0) {
        lines.push(merits.map(finding => sentence(finding.text)).join(" "));
    } else {
        lines.push(sentence(standingPhrase(ctx.currSubj)));
    }

    if (classification == Classification.OKAY) {
        const drawback = moveDrawbacks(buildFacts(ctx)).at(0);

        if (drawback && drawback.weight >= 50) {
            lines[0] += " However, " + lowerFirst(sentence(drawback.text));
        }

        const bestLine = bestMoveLine(ctx, "A slightly stronger option was");
        if (bestLine) lines.push(bestLine);
    }

    return lines.join("\n");
}

function explainCritical(ctx: Context) {
    const lines: string[] = [];

    const merit = moveMerits(buildFacts(ctx)).at(0);

    if (merit && merit.weight >= 55) lines.push(sentence(merit.text));

    const alternative = ctx.previous.secondTopLine?.evaluation;

    const keepPhrases = [
        "you in the fight",
        "you in the game",
        "the position balanced",
        "your advantage",
        "your winning position"
    ];

    const leavePhrases = [
        "in a losing position",
        "in a worse position",
        "in only an equal position",
        "with just a small edge",
        "still winning"
    ];

    const tierNow = tierOf(ctx.currSubj);

    if (alternative) {
        const alternativeTier = tierOf(
            getSubjectiveEvaluation(alternative, ctx.moverColour)
        );

        lines.push(
            `It is the only move that keeps ${keepPhrases[tierNow]}. `
            + (alternativeTier < tierNow
                ? `Any other move leaves you ${leavePhrases[alternativeTier]}.`
                : "Any other move lets a large part of your advantage slip away.")
        );
    } else {
        lines.push(
            `It is the only move that keeps ${keepPhrases[tierNow]}.`
        );
    }

    return lines.join(" ");
}

function explainBrilliant(ctx: Context) {
    const sacrifice = cachedUnsafePieces(
        ctx.after,
        ctx.mover,
        ctx.playedMove
    ).sort((a, b) => pieceValues[b.type] - pieceValues[a.type]).at(0);

    if (!sacrifice) {
        const merit = moveMerits(buildFacts(ctx)).at(0);

        return merit
            ? sentence(merit.text)
            : sentence(standingPhrase(ctx.currSubj));
    }

    const head = `You sacrificed your ${describePiece(sacrifice)}`;

    if (ctx.currSubj.type == "mate" && ctx.currSubj.value > 0) {
        return `${head}, but taking it lets you force checkmate in ${mateLength(ctx.currSubj)}.`;
    }

    if (ctx.playedGain >= -0.5) {
        return `${head}, but you win the material back and keep the better position.`;
    }

    return `${head}, but the attack and piece activity you get are worth more than the material.`;
}

export function explainMove(
    node: StateTreeNode,
    previous: ExtractedPreviousNode,
    current: ExtractedCurrentNode,
    classification: Classification,
    options?: AnalysisOptions
): string | undefined {
    const playedMove = current.playedMove;
    const mover = playedMove.color;
    const opponent = opposite(mover);
    const moverColour = adaptPieceColour(mover);

    const before = previous.board;
    const after = current.board;

    if (classification == Classification.FORCED) {
        return before.isCheck()
            ? "It is your only legal move, and it gets you out of check."
            : "It is your only legal move.";
    }

    if (classification == Classification.THEORY) {
        return "This is a well-known move from opening theory.";
    }

    const parentState = node.parent?.state.move;

    const ownPreviousUci = options?.ownPreviousMoveUci
        ?? node.parent?.parent?.state.move?.uci;

    const playedOutcome = evaluateLine(
        after.fen(), current.topLine.moves, mover
    );

    const bestOutcome = evaluateLine(
        before.fen(), previous.topLine.moves, mover
    );

    const ctx: Context = {
        node,
        previous,
        current,
        mover,
        opponent,
        moverColour,
        before,
        after,
        playedMove,
        prevSubj: getSubjectiveEvaluation(previous.evaluation, moverColour),
        currSubj: current.subjectiveEvaluation,
        parentMove: parentState
            ? {
                to: parseUciMove(parentState.uci).to,
                captured: parentState.san.includes("x")
            }
            : undefined,
        ownPreviousTo: ownPreviousUci
            ? parseUciMove(ownPreviousUci).to
            : undefined,
        playedOutcome,
        bestOutcome,
        playedGain: (
            materialBalance(after, mover)
            - materialBalance(before, mover)
            + playedOutcome.delta
        )
    };

    switch (classification) {
        case Classification.BRILLIANT:
            return explainBrilliant(ctx);
        case Classification.CRITICAL:
            return explainCritical(ctx);
        case Classification.BEST:
        case Classification.EXCELLENT:
        case Classification.OKAY:
            return explainGoodMove(ctx, classification);
        case Classification.INACCURACY:
        case Classification.MISTAKE:
        case Classification.BLUNDER:
        case Classification.RISKY:
            return explainBadMove(ctx);
    }
}
