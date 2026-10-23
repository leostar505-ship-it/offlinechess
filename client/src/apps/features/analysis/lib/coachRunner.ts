import { StateTreeNode } from "shared/types/game/position/StateTreeNode";
import { generateCoachText, getCoachStatus, CoachModelKey, CoachCoverage } from "@/lib/coachApi";
import useCoachStore from "@analysis/stores/CoachStore";
import {
    moveSystemPrompt,
    SUMMARY_SYSTEM_PROMPT,
    buildMovePrompt,
    buildSummaryPrompt,
    selectMoveNodes,
    cleanCoachText,
    coachTextIsGrounded,
    coachTextIsSane,
    coachTextProblem
} from "./coachPrompt";

interface Job {
    key: string;
    priority: number;
    run: (signal: AbortSignal) => Promise<void>;
}

let queue: Job[] = [];
let busy = false;
let epoch = 0;
let controller: AbortController | null = null;

function pump() {
    if (busy) return;

    queue.sort((a, b) => b.priority - a.priority);

    const job = queue.shift();
    if (!job) return;

    busy = true;

    const myEpoch = epoch;
    const jobController = new AbortController();
    controller = jobController;

    job.run(jobController.signal)
        .catch(() => undefined)
        .finally(() => {
            busy = false;
            if (myEpoch == epoch) pump();
            else if (queue.length > 0) pump();
        });
}

function enqueue(job: Job) {
    if (queue.some(item => item.key == job.key)) {
        queue.forEach(item => {
            if (item.key == job.key) item.priority = Math.max(item.priority, job.priority);
        });
        return;
    }

    queue.push(job);
    pump();
}

export function cancelCoach() {
    epoch++;
    queue = [];
    controller?.abort();
}

export function resetCoach() {
    cancelCoach();
    useCoachStore.getState().reset();
}

function setPending(id: string, pending: boolean) {
    const store = useCoachStore.getState();
    const next = { ...store.pending };

    if (pending) next[id] = true;
    else delete next[id];

    store.patch({ pending: next });
}

const FAILURE_MESSAGES = {
    squares: "The coach mentioned squares or moves that are not on the board, so its answer was thrown away.",
    repeat: "The coach just repeated what is already on the board, so its answer was thrown away.",
    short: "The coach's answer was too short to be useful, so it was thrown away.",
    empty: "The model failed to answer.",
    unknown: "Unknown error."
};

function setFailure(id: string, reason?: keyof typeof FAILURE_MESSAGES) {
    const store = useCoachStore.getState();
    const next = { ...store.failures };

    if (reason) next[id] = FAILURE_MESSAGES[reason];
    else delete next[id];

    store.patch({ failures: next });
}

export function requestMoveComment(
    node: StateTreeNode,
    model: CoachModelKey,
    priority: number
) {
    const store = useCoachStore.getState();

    if (store.comments[node.id] || store.pending[node.id]) return;

    const prompt = buildMovePrompt(node);
    if (!prompt) return;

    const myEpoch = epoch;

    setPending(node.id, true);
    setFailure(node.id);

    enqueue({
        key: "move:" + node.id,
        priority,
        async run(signal) {
            try {
                if (myEpoch != epoch) return;

                const text = await generateCoachText(model, moveSystemPrompt(), prompt, 90, signal);

                if (myEpoch != epoch) return;

                const cleaned = text ? cleanCoachText(text) : "";
                const current = useCoachStore.getState();

                if (!cleaned) {
                    setFailure(node.id, "empty");
                    current.patch({ done: current.done + 1 });
                    return;
                }

                const problem = coachTextProblem(cleaned, prompt);

                if (problem) {
                    setFailure(node.id, problem);
                    current.patch({ done: current.done + 1 });
                    return;
                }

                current.patch({
                    comments: { ...current.comments, [node.id]: cleaned },
                    done: current.done + 1
                });
            } catch {
                if (myEpoch == epoch) setFailure(node.id, "unknown");
            } finally {
                if (myEpoch == epoch) setPending(node.id, false);
            }
        }
    });
}

export async function runCoachForGame(
    root: StateTreeNode,
    settings: { model: CoachModelKey; coverage: CoachCoverage }
) {
    resetCoach();

    if (settings.coverage == "current") return;

    const status = await getCoachStatus();
    if (!status?.models[settings.model].installed) return;

    const nodes = selectMoveNodes(root, settings.coverage);
    if (nodes.length == 0) return;

    const myEpoch = epoch;

    useCoachStore.getState().patch({ total: nodes.length, done: 0 });

    for (const node of nodes) requestMoveComment(node, settings.model, 0);

    const summaryKeyMoves = settings.coverage == "key"
        ? nodes
        : selectMoveNodes(root, "key");

    const summaryPrompt = buildSummaryPrompt(root, summaryKeyMoves);

    enqueue({
        key: "summary",
        priority: -1,
        async run(signal) {
            if (myEpoch != epoch) return;

            useCoachStore.getState().patch({ summaryPending: true });

            try {
                const text = await generateCoachText(
                    settings.model,
                    SUMMARY_SYSTEM_PROMPT,
                    summaryPrompt,
                    160,
                    signal
                );

                if (myEpoch != epoch) return;

                const cleaned = text ? cleanCoachText(text) : "";

                if (cleaned && coachTextIsSane(cleaned) && coachTextIsGrounded(cleaned, summaryPrompt)) useCoachStore.getState().patch({ summary: cleaned });
            } finally {
                if (myEpoch == epoch) useCoachStore.getState().patch({ summaryPending: false });
            }
        }
    });
}
