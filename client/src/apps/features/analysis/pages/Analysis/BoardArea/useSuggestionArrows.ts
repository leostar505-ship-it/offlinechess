import { useMemo } from "react";
import { Arrow } from "react-chessboard/dist/chessboard/types";

import { Classification } from "shared/constants/Classification";
import { parseUciMove } from "shared/lib/utils/chess";
import { getTopEngineLine } from "shared/types/game/position/EngineLine";
import { classificationColours } from "@analysis/constants/classifications";
import EngineArrowType from "@analysis/constants/EngineArrowType";
import useSettingsStore from "@/stores/SettingsStore";
import useAnalysisBoardStore from "@analysis/stores/AnalysisBoardStore";
import {
    getThreatArrows,
    getBestResultArrows,
    analyseBestResult,
    getColouredThreats,
    dedupeArrows
} from "@analysis/lib/arrowInsights";
import useRealtimeEngineStore from "@analysis/stores/RealtimeEngineStore";

const arrowColour = classificationColours[Classification.BEST];
const threatColour = "#f5a623cc";

const sideColours = {
    w: "rgba(255, 255, 255, 0.92)",
    b: "rgba(15, 15, 15, 0.85)"
};

const MAX_ALL_ARROWS = 9;

const reviewColours = {
    best: "rgba(152, 188, 73, 0.88)",
    threat: "rgba(245, 166, 35, 0.88)",
    punish: "rgba(235, 87, 66, 0.9)"
};

const punishedClassifications = [
    Classification.INACCURACY,
    Classification.MISTAKE,
    Classification.BLUNDER,
    Classification.RISKY
];

function useSuggestionArrows(): Arrow[] {
    const settings = useSettingsStore(state => state.settings.analysis);

    const node = useAnalysisBoardStore(state => state.currentStateTreeNode);

    const { displayedEngineLines } = useRealtimeEngineStore();

    return useMemo(() => {
        const arrowsType = settings.engine.suggestionArrows;

        if (arrowsType == EngineArrowType.TOP_CONTINUATION) {
            const uciMove = displayedEngineLines.at(0)?.moves.at(0)?.uci;
            if (!uciMove) return [];

            const topMove = parseUciMove(uciMove);

            return [[topMove.from, topMove.to, arrowColour]];
        }

        if (arrowsType == EngineArrowType.TOP_ALTERNATIVE) {
            if (!node.parent) return [];

            const previousTopUci = getTopEngineLine(
                node.parent.state.engineLines
            )?.moves.at(0)?.uci;
            if (!previousTopUci) return [];

            const previousTopMove = parseUciMove(previousTopUci);

            return [[previousTopMove.from, previousTopMove.to, arrowColour]];
        }

        if (arrowsType == EngineArrowType.BEST_RESULT) {
            const topLine = displayedEngineLines.at(0);
            if (!topLine) return [];

            return getBestResultArrows(
                node.state.fen,
                topLine.evaluation,
                topLine.moves
            ).map(arrow => [arrow.from, arrow.to, arrowColour]);
        }

        if (arrowsType == EngineArrowType.MOVE_THREATS) {
            const uci = node.state.move?.uci;
            if (!uci) return [];

            return getThreatArrows(node.state.fen, uci).map(
                arrow => [arrow.from, arrow.to, threatColour]
            );
        }

        if (arrowsType == EngineArrowType.ALL) {
            const collected = [];

            const moveUci = node.state.move?.uci;

            if (moveUci) {
                collected.push(...getColouredThreats(node.state.fen, moveUci));
            }

            const previousTop = node.parent
                ? getTopEngineLine(node.parent.state.engineLines)?.moves.at(0)?.uci
                : undefined;

            if (node.parent && previousTop) {
                const squares = parseUciMove(previousTop);

                collected.push({
                    from: squares.from,
                    to: squares.to,
                    colour: node.parent.state.fen.split(" ")[1] == "b" ? "b" as const : "w" as const
                });
            }

            const topLine = displayedEngineLines.at(0);

            if (topLine) {
                collected.push(...analyseBestResult(
                    node.state.fen,
                    topLine.evaluation,
                    topLine.moves
                ).line);
            }

            return dedupeArrows(collected)
                .slice(0, MAX_ALL_ARROWS)
                .map(arrow => [arrow.from, arrow.to, sideColours[arrow.colour]]);
        }

        if (arrowsType == EngineArrowType.REVIEW) {
            const collected: Arrow[] = [];

            const moveUci = node.state.move?.uci;

            if (moveUci) {
                getThreatArrows(node.state.fen, moveUci).forEach(arrow => {
                    collected.push([arrow.from, arrow.to, reviewColours.threat]);
                });
            }

            const previousTop = node.parent
                ? getTopEngineLine(node.parent.state.engineLines)?.moves.at(0)?.uci
                : undefined;

            if (previousTop && previousTop != moveUci) {
                const squares = parseUciMove(previousTop);

                collected.push([squares.from, squares.to, reviewColours.best]);
            }

            const classification = node.state.classification;

            if (classification && punishedClassifications.includes(classification)) {
                const replyUci = (
                    getTopEngineLine(node.state.engineLines)?.moves.at(0)?.uci
                    ?? displayedEngineLines.at(0)?.moves.at(0)?.uci
                );

                if (replyUci) {
                    const squares = parseUciMove(replyUci);

                    collected.push([squares.from, squares.to, reviewColours.punish]);
                }
            }

            const seen = new Set<string>();

            return collected.filter(([from, to]) => {
                const key = from + to;
                if (seen.has(key)) return false;

                seen.add(key);

                return true;
            });
        }

        return [];
    }, [
        node.id,
        node.state.fen,
        node.state.classification,
        displayedEngineLines,
        settings.engine.suggestionArrows
    ]);
}

export default useSuggestionArrows;