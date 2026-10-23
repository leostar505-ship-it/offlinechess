import { create } from "zustand";

import { CoachMode, CoachAskKind } from "@analysis/lib/coachModes";

export interface CoachAnswerInfo {
    kind: CoachAskKind;
    question: string;
    mode: CoachMode;
}

interface CoachStore {
    comments: Record<string, string>;
    pending: Record<string, boolean>;
    failures: Record<string, string>;
    mode: CoachMode | null;
    latest: Record<string, string>;
    answerInfo: Record<string, CoachAnswerInfo>;
    summary?: string;
    summaryPending: boolean;
    total: number;
    done: number;

    reset: () => void;
    patch: (partial: Partial<Omit<CoachStore, "reset" | "patch">>) => void;
}

const useCoachStore = create<CoachStore>(set => ({
    comments: {},
    pending: {},
    failures: {},
    mode: null,
    latest: {},
    answerInfo: {},
    summaryPending: false,
    total: 0,
    done: 0,

    reset() {
        set({
            comments: {},
            pending: {},
            failures: {},
            latest: {},
            answerInfo: {},
            summary: undefined,
            summaryPending: false,
            total: 0,
            done: 0
        });
    },

    patch(partial) {
        set(partial);
    }
}));

export default useCoachStore;
