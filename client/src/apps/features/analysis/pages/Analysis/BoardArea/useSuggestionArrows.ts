import { useMemo } from "react";
import { Arrow } from "react-chessboard/dist/chessboard/types";

import { Classification } from "shared/constants/Classification";
import { parseUciMove } from "shared/lib/utils/chess";
import { getTopEngineLine } from "shared/types/game/position/EngineLine";
import { classificationColours } from "@analysis/constants/classifications";
import EngineArrowType from "@analysis/constants/EngineArrowType";
import useSettingsStore from "@/stores/SettingsStore";
import useAnalysisBoardStore from "@analysis/stores/AnalysisBoardStore";
import { getThreatArrows, getBestResultArrows } from "@analysis/lib/arrowInsights";
import useRealtimeEngineStore from "@analysis/stores/RealtimeEngineStore";

const arrowColour = classificationColours[Classification.BEST];
const threatColour = "#f5a623cc";

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

        return [];
    }, [
        node.state.fen,
        displayedEngineLines,
        settings.engine.suggestionArrows
    ]);
}

export default useSuggestionArrows;