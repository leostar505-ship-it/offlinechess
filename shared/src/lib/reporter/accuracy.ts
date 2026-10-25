import { meanBy } from "lodash-es";

import { getNodeChain, StateTreeNode } from "@/types/game/position/StateTreeNode";
import Evaluation from "@/types/game/position/Evaluation";
import PieceColour from "@/constants/PieceColour";
import { getTopEngineLine } from "@/types/game/position/EngineLine";
import { getExpectedPoints, getExpectedPointsLoss } from "./expectedPoints";

function clamp(value: number, low: number, high: number) {
    return Math.min(high, Math.max(low, value));
}

function winPercent(node: StateTreeNode) {
    const evaluation = getTopEngineLine(node.state.engineLines)?.evaluation;
    if (!evaluation) return 50;

    return 100 * getExpectedPoints(evaluation, {
        moveColour: node.state.moveColour ?? PieceColour.WHITE
    });
}

function standardDeviation(values: number[]) {
    const mean = meanBy(values, value => value);

    return Math.sqrt(meanBy(values, value => (value - mean) ** 2));
}

function volatilityWeights(winPercents: number[]) {
    const windowSize = clamp(Math.floor(winPercents.length / 10), 2, 8);

    const windows: number[][] = [];

    const first = winPercents.slice(0, windowSize);

    for (let i = 0; i < Math.min(winPercents.length, windowSize) - 2; i++) {
        windows.push(first);
    }

    for (let i = 0; i + windowSize <= winPercents.length; i++) {
        windows.push(winPercents.slice(i, i + windowSize));
    }

    return windows.map(window => clamp(standardDeviation(window), 0.5, 12));
}

function combinedAccuracy(entries: { accuracy: number; weight: number }[]) {
    if (entries.length == 0) return NaN;

    const accuracies = entries.map(entry => clamp(entry.accuracy + 1, 1, 100));

    const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);

    const weightedMean = accuracies.reduce(
        (sum, accuracy, index) => sum + accuracy * entries[index].weight, 0
    ) / totalWeight;

    return weightedMean;
}

export function getGameAccuracy(rootNode: StateTreeNode) {
    const chain = getNodeChain(rootNode);

    const weights = volatilityWeights(chain.map(winPercent));

    const entries = chain
        .map((node, index) => ({
            node,
            accuracy: node.state.accuracy,
            weight: weights[index - 1] ?? 1
        }))
        .filter(entry => entry.accuracy != undefined) as {
        node: StateTreeNode;
        accuracy: number;
        weight: number;
    }[];

    return {
        white: combinedAccuracy(entries.filter(
            entry => entry.node.state.moveColour == PieceColour.WHITE
        )),
        black: combinedAccuracy(entries.filter(
            entry => entry.node.state.moveColour == PieceColour.BLACK
        ))
    };
}

export function getMoveAccuracy(
    previousEvaluation: Evaluation,
    currentEvaluation: Evaluation,
    moveColour: PieceColour
) {
    const pointLoss = getExpectedPointsLoss(
        previousEvaluation,
        currentEvaluation,
        moveColour
    );

    return 103.16 * Math.exp(-7 * pointLoss) - 3.17;
}