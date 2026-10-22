import { sum, round } from "lodash-es";

import AnalysedGame from "shared/types/game/AnalysedGame";
import EngineVersion from "shared/constants/EngineVersion";
import { StateTreeNode, getNodeChain } from "shared/types/game/position/StateTreeNode";
import Engine from "@analysis/lib/engine";

interface EvaluateMovesOptions {
    engineVersion: EngineVersion;
    maxEngineCount?: number;
    engineDepth: number;
    engineTimeLimit?: number;
    engineConfig?: (engine: Engine) => void;
    onProgress?: (progress: number) => void;
    verbose?: boolean;
}

interface EvaluationProcess {
    evaluate: () => Promise<StateTreeNode[]>;
    controller: AbortController;
}

function createGameEvaluator(
    game: AnalysedGame,
    options: EvaluateMovesOptions
): EvaluationProcess {
    const controller = new AbortController();

    const stateTreeNodes = getNodeChain(game.stateTree);

    // Each state tree node keeps a progress from 0 to 1
    const progresses: number[] = [];

    function getProgress() {
        return round(sum(progresses) / stateTreeNodes.length, 3);
    }

    async function evaluator(): Promise<StateTreeNode[]> {
        const engineCount = Math.max(1, Math.min(
            options.maxEngineCount || 1,
            stateTreeNodes.length
        ));

        let enginesResting = 0;
        let stateTreeNodeIndex = 0;

        return await new Promise((res, rej) => {
            // Bring an engine to a new FEN
            function evaluateNextPosition(engine: Engine) {
                const currentStateTreeNodeIndex = stateTreeNodeIndex;
                const currentStateTreeNode = stateTreeNodes[stateTreeNodeIndex];

                if (stateTreeNodeIndex >= stateTreeNodes.length) {
                    engine.terminate();

                    if (++enginesResting == engineCount)
                        res(stateTreeNodes);

                    return;
                }

                engine.setPosition(game.initialPosition, stateTreeNodes
                    .slice(0, stateTreeNodeIndex + 1)
                    .filter(node => node.state.move)
                    .map(node => node.state.move!.uci)
                );

                engine.evaluate({
                    depth: options.engineDepth,
                    timeLimit: options.engineTimeLimit
                        ? options.engineTimeLimit * 1000
                        : undefined,
                    onEngineLine: line => {
                        // Depth 0 is given for states with no legal moves
                        const localProgress = line.depth == 0
                            ? 1 : line.depth / options.engineDepth;
                        
                        // Progress value will already exist for cutoff node
                        progresses[currentStateTreeNodeIndex] = Math.max(
                            progresses[currentStateTreeNodeIndex] || 0,
                            localProgress
                        );

                        options.onProgress?.(getProgress());
                    }
                }).then(lines => {
                    progresses[currentStateTreeNodeIndex] = 1;

                    currentStateTreeNode.state.engineLines = [
                        ...currentStateTreeNode.state.engineLines,
                        ...lines
                    ];

                    evaluateNextPosition(engine);
                });

                stateTreeNodeIndex++;
            }

            // Start engines on first positions
            const engines: Engine[] = [];

            for (let i = 0; i < engineCount; i++) {
                const engine = new Engine(options.engineVersion);
                engines.push(engine);

                options.engineConfig?.(engine);

                if (options.verbose) {
                    engine.onMessage(console.log);
                }

                engine.onError(rej);

                evaluateNextPosition(engine);
            }

            controller.signal.addEventListener("abort", () => {
                engines.forEach(engine => engine.terminate());
                rej("abort");
            });
        });
    }

    return { evaluate: evaluator, controller };
}

export default createGameEvaluator;