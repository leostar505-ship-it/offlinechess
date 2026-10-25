import React from "react";
import {
    ResponsiveContainer,
    XAxis,
    YAxis,
    AreaChart,
    Area,
    Tooltip,
    ReferenceLine,
    ReferenceDot
} from "recharts";

import { StateTreeNode } from "shared/types/game/position/StateTreeNode";
import Evaluation from "shared/types/game/position/Evaluation";
import { defaultEvaluation } from "shared/constants/utils";
import PieceColour from "shared/constants/PieceColour";
import { Classification } from "shared/constants/Classification";
import { getExpectedPoints } from "shared/lib/reporter/expectedPoints";
import { getTopEngineLine } from "shared/types/game/position/EngineLine";
import { classificationColours } from "@analysis/constants/classifications";

import EvaluationGraphPoint from "./Point";
import TooltipRenderer from "./TooltipRenderer";
import EvaluationGraphProps from "./EvaluationGraphProps";
import * as styles from "./EvaluationGraph.module.css";

const highlightedClassifications: Classification[] = [
    Classification.BRILLIANT,
    Classification.CRITICAL,
    Classification.INACCURACY,
    Classification.MISTAKE,
    Classification.BLUNDER
];

function getGraphY(node: StateTreeNode, evaluation: Evaluation) {
    if (evaluation.type == "mate" && evaluation.value == 0) {
        if (node.state.moveColour == undefined) return 0.5;
    }

    return getExpectedPoints(evaluation, {
        moveColour: node.state.moveColour ?? PieceColour.WHITE
    });
}

function EvaluationGraph({
    className,
    style,
    nodes,
    selectedIndex,
    onPointClick
}: EvaluationGraphProps) {
    const dataPoints = nodes.map((node, index) => {
        const evaluation = getTopEngineLine(node.state.engineLines)?.evaluation
            || defaultEvaluation;

        return {
            nodeId: node.id,
            state: node.state,
            evaluation: evaluation,
            x: index,
            y: getGraphY(node, evaluation)
        } as EvaluationGraphPoint;
    });

    const highlightedPoints = dataPoints.filter(point => (
        point.state.classification
        && highlightedClassifications.includes(
            point.state.classification
        )
    ));

    const selectedPoint = dataPoints[selectedIndex];

    const selectedPointColour = selectedPoint?.state.classification
        ? classificationColours[selectedPoint.state.classification]
        : "gray";

    return <div className={styles.wrapper}>
        <ResponsiveContainer
            width={style?.width || "100%"}
            height={style?.height || 100}
        >
            <AreaChart
                className={`${styles.chart} ${className}`}
                margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                data={dataPoints}
                onClick={event => {
                    const payload = event.activePayload?.at(0)?.payload;
                    if (!payload) return;

                    onPointClick?.(payload as EvaluationGraphPoint);
                }}
            >
                <XAxis hide dataKey="x"/>
                <YAxis hide domain={[0, 1]}/>

                <Area
                    dataKey="y"
                    type="monotone"
                    fill="#fff"
                    fillOpacity={1}
                    strokeWidth={0}
                    isAnimationActive={false}
                />

                <ReferenceLine
                    y={0.5}
                    stroke="gray"
                    strokeOpacity={0.5}
                    strokeWidth={2}
                />

                {selectedPoint && <>
                    <ReferenceLine
                        x={selectedPoint.x}
                        stroke={selectedPointColour}
                        strokeWidth={2}
                    />

                    <ReferenceDot
                        x={selectedPoint.x}
                        y={selectedPoint.y}
                        r={4}
                        fill={selectedPointColour}
                        strokeWidth={0}
                    />
                </>}

                {highlightedPoints.map(point => <ReferenceDot
                    key={point.nodeId}
                    x={point.x}
                    y={point.y}
                    r={4.5}
                    fill={classificationColours[point.state.classification!]}
                    strokeWidth={0}
                />)}

                <Tooltip content={({ label }) => {
                    const point = typeof label == "number"
                        && dataPoints[label];

                    return point
                        ? <TooltipRenderer dataPoint={point} />
                        : null;
                }}/>
            </AreaChart>
        </ResponsiveContainer>
    </div>;
}

export default EvaluationGraph;