import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { Chess } from "chess.js";

import {
    StateTreeNode,
    addChildMove,
    findNodeRecursively
} from "shared/types/game/position/StateTreeNode";
import { Classification } from "shared/constants/Classification";
import { getSimpleNotation } from "shared/lib/utils/chess";
import { getTopEngineLine } from "shared/types/game/position/EngineLine";
import {
    classificationColours,
    classificationImages,
    loadingClassificationIcon,
    errorClassificationIcon,
    inalterableClassifications
} from "@analysis/constants/classifications";
import useSettingsStore from "@/stores/SettingsStore";
import useAnalysisBoardStore from "@analysis/stores/AnalysisBoardStore";
import useAnalysisProgressStore from "@analysis/stores/AnalysisProgressStore";
import LogMessage from "@/components/common/LogMessage";
import playBoardSound from "@/lib/boardSounds";
import { getCoachStatus } from "@/lib/coachApi";
import useCoachStore from "@analysis/stores/CoachStore";
import { requestMoveComment } from "@analysis/lib/coachRunner";
import {
    CoachMode,
    COACH_MODE_LABELS,
    availableCoachModes,
    coachKey
} from "@analysis/lib/coachModes";

import * as styles from "./ClassifiedMoveCard.module.css";

function getPlayedMove(currentNode: StateTreeNode) {
    if (!currentNode.parent) return;
    if (!currentNode.state.move) return;

    const previousBoard = new Chess(currentNode.parent.state.fen);

    return previousBoard.move(currentNode.state.move.san);
}

function getTopAlternativeMove(currentNode: StateTreeNode) {
    if (!currentNode.parent) return;

    const bestAlternativeUci = getTopEngineLine(
        currentNode.parent.state.engineLines
    )?.moves.at(0)?.uci;

    if (!bestAlternativeUci) return;

    const previousBoard = new Chess(currentNode.parent.state.fen);

    try {
        return previousBoard.move(bestAlternativeUci);
    } catch {
        return;
    }
}

function ClassifiedMoveCard() {
    const { t } = useTranslation(["common", "analysis"]);

    const { settings } = useSettingsStore();

    const {
        currentStateTreeNode: node,
        setCurrentStateTreeNode
    } = useAnalysisBoardStore();

    const {
        realtimeClassifyError,
        setRealtimeClassifyError
    } = useAnalysisProgressStore(
        useShallow(state => ({
            realtimeClassifyError: state.realtimeClassifyError,
            setRealtimeClassifyError: state.setRealtimeClassifyError
        }))
    );

    useEffect(() => setRealtimeClassifyError(), [node]);

    const coachSettings = settings.analysis.coach;
    const coachReplaces = ["small", "large", "huge"].includes(coachSettings.model);
    const chosenMode = useCoachStore(state => state.mode);
    const [coachReady, setCoachReady] = useState(false);
    const [coachThinking, setCoachThinking] = useState(false);

    const coachModes = availableCoachModes(coachThinking);
    const defaultMode: CoachMode = coachReplaces ? "grounded" : "stockfish";
    const activeMode = chosenMode && coachModes.includes(chosenMode) ? chosenMode : defaultMode;
    const modeKey = coachKey(node.id, activeMode);
    const aiMode = activeMode != "stockfish";

    const coachComment = useCoachStore(state => state.comments[modeKey]);
    const coachPending = useCoachStore(state => !!state.pending[modeKey]);
    const coachFailure = useCoachStore(state => state.failures[modeKey]);

    useEffect(() => {
        if (!coachSettings.enabled) {
            setCoachReady(false);
            return;
        }

        getCoachStatus().then(status => {
            setCoachReady(!!status?.models[coachSettings.model].installed);
            setCoachThinking(!!status?.models[coachSettings.model].thinking);
        });
    }, [coachSettings.enabled, coachSettings.model]);

    function cycleMode() {
        const next = coachModes[(coachModes.indexOf(activeMode) + 1) % coachModes.length];

        useCoachStore.getState().patch({ mode: next });
    }

    const coachCanComment = (
        coachReady
        && aiMode
        && !!node.parent
        && !!node.state.classification
        && !coachComment
        && !coachPending
    );

    const coachAutoAllowed = coachCanComment && !coachFailure;

    useEffect(() => {
        if (!coachAutoAllowed || coachSettings.coverage != "current") return;

        const timer = setTimeout(
            () => requestMoveComment(node, coachSettings.model, 2, activeMode),
            600
        );

        return () => clearTimeout(timer);
    }, [node, coachAutoAllowed, coachSettings.coverage, coachSettings.model, activeMode]);

    const nearestOpeningName = findNodeRecursively(
        node,
        searchNode => !!searchNode.state.opening,
        true
    )?.state.opening;

    const playedMove = getPlayedMove(node);
    const playedMoveMessage = (
        (settings.analysis.simpleNotation && playedMove
            ? getSimpleNotation(playedMove)
            : node.state.move?.san
        )
        + " "
        + t(
            "classifiedMoveCard.classifications."
            + node.state.classification,
            { ns: "analysis" }
        )
    );

    const topAlternativeMove = getTopAlternativeMove(node);

    function playTopAlternative() {
        if (!node.parent) return;
        if (!topAlternativeMove) return;

        const createdNode = addChildMove(node.parent, topAlternativeMove.san);

        setCurrentStateTreeNode(createdNode);
        playBoardSound(createdNode);
    }

    return <div className={styles.wrapper}>
        <div
            className={styles.classificationSection}
            style={nearestOpeningName
                ? { borderRadius: "10px 10px 0 0" }
                : undefined
            }
        >
            <div className={styles.classification}>
                <img src={node.state.classification
                    ? classificationImages[node.state.classification]
                    : (realtimeClassifyError
                        ? errorClassificationIcon
                        : loadingClassificationIcon
                    )
                }/>

                <span
                    className={styles.classificationName}
                    style={{
                        color: node.state.classification
                            ? classificationColours[node.state.classification]
                            : (realtimeClassifyError
                                ? classificationColours[Classification.BLUNDER]
                                : "white"
                            )
                    }}
                >
                    {node.state.classification
                        ? playedMoveMessage
                        : (realtimeClassifyError
                            ? t("error") : t("loading")
                        )
                    }
                </span>
            </div>

            {realtimeClassifyError
                && <LogMessage style={{ marginTop: "5px" }}>
                    {t(realtimeClassifyError, { ns: "analysis" })}
                </LogMessage>
            }

            {node.state.classification
                && (aiMode && coachComment
                    ? <span className={styles.explanation}>{coachComment}</span>
                    : node.state.explanation
                        && <span className={styles.explanation}>
                            {node.state.explanation}
                        </span>
                )
            }

            {coachReady
                && !!node.parent
                && !!node.state.classification
                && <span className={styles.coachMode} onClick={cycleMode}>
                    Analysis: {COACH_MODE_LABELS[activeMode]} (click to switch)
                </span>
            }

            {coachPending
                && <span className={styles.coachNote}>
                    {activeMode.startsWith("thinking") ? "The coach is thinking it through, this can take a while..." : "The coach is thinking..."}
                </span>
            }

            {coachCanComment
                && (coachSettings.coverage != "current" || !!coachFailure)
                && <span
                    className={coachFailure ? styles.coachAskFailed : styles.coachAsk}
                    onClick={() => requestMoveComment(node, coachSettings.model, 2, activeMode)}
                >
                    {coachFailure ? "Ask the coach again" : "Ask the coach about this move"}
                </span>
            }

            {coachCanComment
                && coachFailure
                && <span className={styles.coachFailure}>{coachFailure}</span>
            }

            {topAlternativeMove
                && node.state.classification
                && topAlternativeMove.san != node.state.move?.san
                && !inalterableClassifications.includes(node.state.classification)
                && <span className={styles.bestAlternativeComment}>
                    <span>
                        {t("classifiedMoveCard.alternative", { ns: "analysis" })}
                    </span>

                    <span
                        className={styles.bestAlternativeMove}
                        onClick={playTopAlternative}
                    >
                        {settings.analysis.simpleNotation
                            ? getSimpleNotation(topAlternativeMove)
                            : topAlternativeMove.san
                        }
                    </span>
                </span>
            }
        </div>

        {nearestOpeningName
            && <div className={styles.opening}>
                {nearestOpeningName}
            </div>
        }
    </div>;
}

export default ClassifiedMoveCard;