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
import { getSimpleNotation, stringifyEvaluation } from "shared/lib/utils/chess";
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
import { requestMoveComment, requestCoachAnswer } from "@analysis/lib/coachRunner";
import {
    CoachMode,
    COACH_MODE_LABELS,
    availableCoachModes,
    coachKey,
    CoachAskKind
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
    const [askOpen, setAskOpen] = useState(false);
    const [question, setQuestion] = useState("");

    const coachModes = availableCoachModes(coachThinking);
    const defaultMode: CoachMode = coachReplaces ? "grounded" : "stockfish";
    const activeMode = chosenMode && coachModes.includes(chosenMode) ? chosenMode : defaultMode;
    const modeKey = coachKey(node.id, activeMode);
    const aiMode = activeMode != "stockfish";

    const coachComment = useCoachStore(state => state.comments[modeKey]);
    const coachPending = useCoachStore(state => !!state.pending[modeKey]);
    const coachFailure = useCoachStore(state => state.failures[modeKey]);
    const latestKey = useCoachStore(state => state.latest[node.id]);
    const latestInfo = useCoachStore(state => (latestKey ? state.answerInfo[latestKey] : undefined));
    const latestText = useCoachStore(state => (latestKey ? state.comments[latestKey] : undefined));
    const latestPending = useCoachStore(state => !!latestKey && !!state.pending[latestKey]);
    const latestFailure = useCoachStore(state => (latestKey ? state.failures[latestKey] : undefined));

    useEffect(() => setAskOpen(false), [node]);

    function askCoach(kind: CoachAskKind, text = "") {
        requestCoachAnswer(node, coachSettings.model, kind, text, activeMode);
    }

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

    const shownEvaluation = getTopEngineLine(node.state.engineLines)?.evaluation;
    const whiteAhead = !!shownEvaluation && shownEvaluation.value >= 0;

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

                {shownEvaluation
                    && node.state.classification
                    && <span
                        className={styles.evalPill}
                        style={whiteAhead
                            ? { backgroundColor: "#f1f1f1", color: "#2b2b2b" }
                            : { backgroundColor: "#454545", color: "white" }
                        }
                    >
                        {stringifyEvaluation(shownEvaluation, shownEvaluation.value != 0)}
                    </span>
                }
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

            {coachReady
                && !!node.parent
                && !!node.state.classification
                && <span className={styles.coachAsk} onClick={() => setAskOpen(open => !open)}>
                    {askOpen ? "Close the coach panel" : "Ask the coach about this move"}
                </span>
            }

            {coachReady
                && askOpen
                && <div className={styles.askPanel}>
                    <div className={styles.askButtons}>
                        <span className={styles.askChoice} onClick={() => askCoach("explain")}>
                            Explain
                        </span>

                        <span className={styles.askChoice} onClick={() => askCoach("why")}>
                            Why this rating
                        </span>
                    </div>

                    <form
                        className={styles.askForm}
                        onSubmit={event => {
                            event.preventDefault();
                            askCoach("ask", question);
                            setQuestion("");
                        }}
                    >
                        <input
                            className={styles.askInput}
                            value={question}
                            maxLength={200}
                            placeholder="Or ask your own question about this move"
                            onChange={event => setQuestion(event.target.value)}
                        />

                        <button className={styles.askSend} type="submit" disabled={!question.trim()}>
                            Ask
                        </button>
                    </form>
                </div>
            }

            {latestInfo
                && <div className={styles.answerBlock}>
                    <span className={styles.coachMode}>
                        {latestInfo.kind == "explain" && "Coach: how the position stands"}
                        {latestInfo.kind == "why" && "Coach: why this rating"}
                        {latestInfo.kind == "ask" && "You asked: " + latestInfo.question}
                    </span>

                    {latestPending
                        && <span className={styles.coachNote}>
                            {latestInfo.mode.startsWith("thinking")
                                ? "The coach is thinking it through, this can take a while..."
                                : "The coach is thinking..."}
                        </span>
                    }

                    {latestText && <span className={styles.explanation}>{latestText}</span>}

                    {latestFailure
                        && <>
                            <span className={styles.coachFailure}>{latestFailure}</span>

                            <span
                                className={styles.coachAskFailed}
                                onClick={() => askCoach(latestInfo.kind, latestInfo.question)}
                            >
                                Try again
                            </span>
                        </>
                    }
                </div>
            }

            {coachReady
                && aiMode
                && !!node.parent
                && !!node.state.classification
                && <span className={styles.coachWarning}>
                    The model selected is an AI and might make mistakes.
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
                    {coachFailure ? "Try again" : "Get a short coach comment"}
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