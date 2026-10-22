import { StatusCodes } from "http-status-codes";
import { clone } from "lodash-es";

import AnalysisOptions from "shared/lib/reporter/types/AnalysisOptions";
import { getGameAnalysis } from "shared/lib/reporter/report";
import { GameAnalysis } from "shared/types/game/GameAnalysis";
import {
    StateTreeNode,
    serializeNode,
    deserializeNode
} from "shared/types/game/position/StateTreeNode";
import APIResponse from "@/types/APIResponse";

function yieldToUI() {
    return new Promise<void>(res => setTimeout(res, 0));
}

export async function analyseStateTree(
    rootNode: StateTreeNode,
    options?: AnalysisOptions
): APIResponse<{ gameAnalysis: GameAnalysis }> {
    await yieldToUI();

    try {
        const copiedTree = deserializeNode(serializeNode(rootNode), undefined);

        const gameAnalysis = getGameAnalysis(copiedTree, options);

        return {
            status: StatusCodes.OK,
            gameAnalysis: {
                ...gameAnalysis,
                stateTree: deserializeNode(
                    serializeNode(gameAnalysis.stateTree),
                    rootNode
                )
            }
        };
    } catch (error) {
        console.error(error);

        return { status: StatusCodes.INTERNAL_SERVER_ERROR };
    }
}

export async function analyseNode(
    node: StateTreeNode,
    options?: AnalysisOptions
): APIResponse<{ node: StateTreeNode }> {
    if (!node.parent)
        return { status: StatusCodes.BAD_REQUEST };

    const childlessNode = clone(node);
    childlessNode.children = [];

    const parentNode = clone(node.parent);
    parentNode.children = [childlessNode];

    const reportResult = await analyseStateTree(parentNode, options);
    const analysedNode = reportResult.gameAnalysis?.stateTree.children.at(0);

    return {
        status: reportResult.status,
        node: analysedNode
    };
}
