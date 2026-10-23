import { create } from "zustand";

interface CoachStore {
    comments: Record<string, string>;
    pending: Record<string, boolean>;
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
    summaryPending: false,
    total: 0,
    done: 0,

    reset() {
        set({
            comments: {},
            pending: {},
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
