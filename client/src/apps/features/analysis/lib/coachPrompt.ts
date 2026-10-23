import { StateTreeNode, getNodeChain } from "shared/types/game/position/StateTreeNode";
import { getTopEngineLine } from "shared/types/game/position/EngineLine";
import Evaluation from "shared/types/game/position/Evaluation";
import { Classification } from "shared/constants/Classification";
import { getGameAccuracy } from "shared/lib/reporter/accuracy";

const MOVE_RULES = [
    "You are a friendly chess coach. You explain in plain words why a move got its rating.",
    "Use ONLY the verified findings you are given. Never invent moves, captures or threats.",
    "Only mention moves that appear in the findings, exactly as written.",
    "Say what happened and why it matters, in one or two short sentences. Do not repeat the rating or any numbers.",
    "Refer to the sides as White and Black. No headings, no lists, no markdown, no emoji."
].join(" ");

export function moveSystemPrompt() {
    return MOVE_RULES;
}

export const SUMMARY_SYSTEM_PROMPT = [
    "You are a friendly, encouraging chess coach writing a short review of a finished game.",
    "Use ONLY the facts you are given. Never invent moves, results or evaluations.",
    "Write three short sentences: how the game went overall, the key turning point, and one thing to work on.",
    "Always name the side exactly as written next to each move. Only mention moves listed in the key moments.",
    "Refer to the sides as White and Black. No headings, no bullet points, no markdown, no emoji."
].join(" ");

const ratingNames: Record<string, string> = {
    [Classification.BRILLIANT]: "Brilliant (a very strong, hard-to-find sacrifice)",
    [Classification.CRITICAL]: "Critical (the only move that keeps the advantage)",
    [Classification.BEST]: "Best (the engine's top choice)",
    [Classification.EXCELLENT]: "Excellent (almost as good as the best move)",
    [Classification.OKAY]: "Okay (a decent move)",
    [Classification.INACCURACY]: "Inaccuracy (a slightly weaker move)",
    [Classification.MISTAKE]: "Mistake (a clearly weaker move)",
    [Classification.BLUNDER]: "Blunder (a serious error)",
    [Classification.THEORY]: "Book move (known opening theory)",
    [Classification.FORCED]: "Forced (the only legal move)",
    [Classification.RISKY]: "Risky (it gives up some advantage for complications)"
};

function sideOf(node: StateTreeNode): "White" | "Black" {
    return node.state.moveColour == "white" ? "White" : "Black";
}

function describeEvaluation(evaluation: Evaluation | undefined, side: "White" | "Black") {
    if (!evaluation) return "unknown";

    const sign = side == "White" ? 1 : -1;

    if (evaluation.type == "mate") {
        const moves = Math.abs(evaluation.value);
        const winner = evaluation.value * sign > 0 ? side : (side == "White" ? "Black" : "White");

        return moves == 0
            ? "checkmate"
            : winner + " has a forced checkmate in " + moves;
    }

    const pawns = (evaluation.value * sign) / 100;

    if (Math.abs(pawns) < 0.3) return "equal";

    const size = Math.abs(pawns) >= 3
        ? "winning"
        : (Math.abs(pawns) >= 1.2 ? "clearly better" : "slightly better");

    const holder = pawns > 0 ? side : (side == "White" ? "Black" : "White");

    return holder + " is " + size;
}

function moveLabel(node: StateTreeNode) {
    const parentFen = node.parent?.state.fen || "";
    const fullmove = parseInt(parentFen.split(" ")[5] || "1");

    return sideOf(node) == "White"
        ? fullmove + "." + node.state.move?.san
        : fullmove + "..." + node.state.move?.san;
}

function nameTheMover(text: string, side: "White" | "Black") {
    return text
        .replace(/\b[Yy]our\b/g, side + "'s")
        .replace(/\btakes you\b/g, "takes " + side)
        .replace(/\b[Yy]ou\b/g, side);
}

export function buildMovePrompt(node: StateTreeNode) {
    const parent = node.parent;

    if (!parent || !node.state.move || !node.state.classification) return null;

    const side = sideOf(node);
    const before = getTopEngineLine(parent.state.engineLines);
    const after = getTopEngineLine(node.state.engineLines);

    const best = before?.moves.at(0)?.san;
    const playedIsBest = best == node.state.move.san;

    const facts = [
        "Move played: " + moveLabel(node) + " by " + side,
        "Rating: " + ratingNames[node.state.classification],
        "Evaluation before the move: " + describeEvaluation(before?.evaluation, side),
        "Evaluation after the move: " + describeEvaluation(after?.evaluation, side)
    ];

    if (best && !playedIsBest) {
        facts.push("The engine's best move was " + best);
    }

    if (after?.moves.length) {
        facts.push("The opponent's best reply is " + after.moves[0].san);
    }

    if (node.state.explanation) {
        facts.push("Verified findings:\n" + nameTheMover(node.state.explanation, side));
    }

    return facts.join("\n")
        + "\n\nExplain to the player why this move received its rating, using only these facts.";
}

const SUMMARY_PRIORITY: Partial<Record<Classification, number>> = {
    [Classification.BLUNDER]: 5,
    [Classification.MISTAKE]: 4,
    [Classification.BRILLIANT]: 3,
    [Classification.CRITICAL]: 2,
    [Classification.INACCURACY]: 1
};

export function selectMoveNodes(
    root: StateTreeNode,
    coverage: "key" | "all" | "current"
) {
    const moves = getNodeChain(root)
        .filter(node => node.mainline && node.parent && node.state.classification);

    if (coverage == "all") {
        return moves.filter(node => (
            node.state.classification != Classification.FORCED
            && node.state.classification != Classification.THEORY
        ));
    }

    if (coverage == "current") return [];

    const ranked = moves
        .filter(node => SUMMARY_PRIORITY[node.state.classification!])
        .sort((a, b) => (
            SUMMARY_PRIORITY[b.state.classification!]! - SUMMARY_PRIORITY[a.state.classification!]!
        ))
        .slice(0, 8);

    return ranked.sort((a, b) => moves.indexOf(a) - moves.indexOf(b));
}

export function buildSummaryPrompt(root: StateTreeNode, keyMoves: StateTreeNode[]) {
    const moves = getNodeChain(root)
        .filter(node => node.mainline && node.parent && node.state.classification);

    const counts = (side: "white" | "black") => {
        const tally: Record<string, number> = {};

        for (const node of moves) {
            if (node.state.moveColour != side) continue;

            const key = node.state.classification!;
            tally[key] = (tally[key] || 0) + 1;
        }

        return ["brilliant", "critical", "best", "excellent", "okay", "inaccuracy", "mistake", "blunder"]
            .filter(key => tally[key])
            .map(key => tally[key] + " " + key)
            .join(", ") || "none";
    };

    const accuracy = getGameAccuracy(root);

    const facts = [
        "Game length: " + Math.ceil(moves.length / 2) + " moves",
        "White accuracy: " + (accuracy.white ? accuracy.white.toFixed(1) + "%" : "unknown"),
        "Black accuracy: " + (accuracy.black ? accuracy.black.toFixed(1) + "%" : "unknown"),
        "White moves rated: " + counts("white"),
        "Black moves rated: " + counts("black"),
        "Key moments:"
    ];

    for (const node of keyMoves) {
        const first = (node.state.explanation || "").split("\n")[0];

        facts.push(
            "- " + moveLabel(node) + " by " + sideOf(node) + ", rated "
            + node.state.classification + (first ? ": " + first : "")
        );
    }

    return facts.join("\n")
        + "\n\nWrite the game review for the players using only these facts.";
}

export function cleanCoachText(text: string) {
    const cleaned = text
        .replace(/<think>[\s\S]*?<\/think>/g, "")
        .replace(/[*#`_]/g, "")
        .trim();

    if (/[.!?]$/.test(cleaned)) return cleaned;

    const lastEnd = Math.max(
        cleaned.lastIndexOf(". "),
        cleaned.lastIndexOf("! "),
        cleaned.lastIndexOf("? ")
    );

    return lastEnd > 20 ? cleaned.slice(0, lastEnd + 1) : cleaned;
}

const MOVE_TOKEN = /\b(?:O-O-O|O-O|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x?[a-h][1-8]|[a-h][1-8])(?:=[QRBN])?[+#]?/g;

export function coachTextIsGrounded(text: string, prompt: string) {
    const allowed = prompt.replace(/[+#]/g, "");

    for (const token of text.match(MOVE_TOKEN) || []) {
        if (!allowed.includes(token.replace(/[+#]/g, ""))) return false;
    }

    return true;
}

export function coachTextIsSane(text: string) {
    if (text.length < 20) return false;

    const sentences = text
        .split(/(?<=[.!?])\s+|\n+/)
        .map(sentence => sentence.trim().toLowerCase())
        .filter(sentence => sentence.length > 0);

    if (new Set(sentences).size != sentences.length) return false;

    return !/evaluation (before|after)|move played|opponent's best|received its rating|verified findings|engine's best/i.test(text);
}
