export type CoachMode = "stockfish" | "grounded" | "self" | "thinking-grounded" | "thinking-self";

export const COACH_MODE_LABELS: Record<CoachMode, string> = {
    stockfish: "Stockfish",
    grounded: "AI grounded",
    self: "AI self-dependent",
    "thinking-grounded": "AI thinking, grounded",
    "thinking-self": "AI thinking, self-dependent"
};

export function availableCoachModes(thinking: boolean): CoachMode[] {
    return thinking
        ? ["stockfish", "grounded", "self", "thinking-grounded", "thinking-self"]
        : ["stockfish", "grounded", "self"];
}

export function isThinkingMode(mode: CoachMode) {
    return mode == "thinking-grounded" || mode == "thinking-self";
}

export function isSelfMode(mode: CoachMode) {
    return mode == "self" || mode == "thinking-self";
}

export function coachKey(nodeId: string, mode: CoachMode) {
    return nodeId + "|" + mode;
}
