import React from "react";

import useCoachStore from "@analysis/stores/CoachStore";

import * as styles from "./CoachSummaryCard.module.css";

function CoachSummaryCard() {
    const summary = useCoachStore(state => state.summary);
    const summaryPending = useCoachStore(state => state.summaryPending);
    const total = useCoachStore(state => state.total);
    const done = useCoachStore(state => state.done);

    if (!summary && !summaryPending && done >= total) return null;

    return <div className={styles.wrapper}>
        <div className={styles.title}>Coach review</div>

        <div className={styles.body}>
            {summary
                || (summaryPending
                    ? "Writing your game review..."
                    : "The coach is looking at your game (" + done + "/" + total + " moves)...")
            }
        </div>
    </div>;
}

export default CoachSummaryCard;
