import { useMemo } from "react";
import { Square } from "react-chessboard/dist/chessboard/types";

import EngineArrowType from "@analysis/constants/EngineArrowType";
import useSettingsStore from "@/stores/SettingsStore";
import useAnalysisBoardStore from "@analysis/stores/AnalysisBoardStore";
import { getThreatArrows } from "@analysis/lib/arrowInsights";
import { BoardOverlays } from "@analysis/components/Board/overlays";

function useBoardOverlays(): BoardOverlays | undefined {
    const settings = useSettingsStore(state => state.settings.analysis);

    const node = useAnalysisBoardStore(state => state.currentStateTreeNode);
    const flipped = useAnalysisBoardStore(state => state.boardFlipped);

    const enabled = settings.engine.suggestionArrows == EngineArrowType.REVIEW;

    return useMemo(() => {
        if (!enabled) return undefined;

        const highlights: BoardOverlays["highlights"] = {};

        const uci = node.state.move?.uci;

        if (uci) {
            getThreatArrows(node.state.fen, uci).forEach(arrow => {
                highlights[arrow.to as Square] = "danger";
            });
        }

        const themes = node.state.themes || [];

        for (const theme of themes) {
            for (const highlight of theme.highlights) {
                highlights[highlight.square as Square] = highlight.kind;
            }
        }

        const tagged = themes.find(theme => !!theme.square);

        return {
            highlights,
            tag: tagged?.square
                ? { square: tagged.square as Square, label: tagged.label }
                : undefined,
            flipped
        };
    }, [enabled, node.id, node.state.fen, node.state.themes, flipped]);
}

export default useBoardOverlays;
