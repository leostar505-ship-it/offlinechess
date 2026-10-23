import React, { useEffect, useRef, useState } from "react";

import useSettingsStore from "@/stores/SettingsStore";
import {
    getCoachStatus,
    startCoachDownload,
    formatGigabytes,
    CoachStatus
} from "@/lib/coachApi";
import LogMessage from "@/components/common/LogMessage";
import Button from "@/components/common/Button";

import * as styles from "./CoachOffer.module.css";

const DISMISSED_KEY = "offlinechess_coach_offer_dismissed";

function wasDismissed() {
    try {
        return localStorage.getItem(DISMISSED_KEY) == "1";
    } catch {
        return false;
    }
}

function CoachOffer() {
    const { setSettings } = useSettingsStore();

    const [status, setStatus] = useState<CoachStatus | null>(null);
    const [dismissed, setDismissed] = useState(wasDismissed());
    const timer = useRef<ReturnType<typeof setInterval>>();

    function refresh() {
        getCoachStatus().then(next => next && setStatus(next));
    }

    useEffect(() => {
        if (dismissed) return;

        refresh();

        timer.current = setInterval(refresh, 1000);

        return () => clearInterval(timer.current);
    }, [dismissed]);

    if (dismissed || !status) return null;

    const small = status.models.small;
    const anyInstalled = Object.values(status.models).some(model => model.installed);

    if (anyInstalled) return null;

    function dismiss() {
        try {
            localStorage.setItem(DISMISSED_KEY, "1");
        } catch {
        }

        setDismissed(true);
    }

    async function download() {
        setSettings(draft => {
            draft.analysis.coach.enabled = true;
            draft.analysis.coach.model = "small";
            return draft;
        });

        const next = await startCoachDownload("small");

        if (next) setStatus(next);
    }

    return <div className={styles.wrapper}>
        <div className={styles.title}>Get the AI coach? (optional)</div>

        <div className={styles.body}>
            Download a small AI that runs only on your computer and explains your moves
            in plain language after you press Analyse. It is a {formatGigabytes(small.sizeBytes)}{" "}
            download. You can also change this later in Settings, under the Stockfish version.
        </div>

        {!small.enoughMemory
            && <LogMessage theme="warn">
                You may not have enough RAM to download and use this model (about{" "}
                {formatGigabytes(small.usableBytes)} usable of {formatGigabytes(small.totalBytes)}{" "}
                total, after leaving 4 GB for background processes).
            </LogMessage>
        }

        {small.downloading
            ? <div className={styles.body}>Downloading... {Math.round(small.progress * 100)}%</div>
            : <div className={styles.buttons}>
                <Button onClick={download}>Download</Button>
                <Button onClick={dismiss}>Not now</Button>
            </div>
        }

        {small.error && <LogMessage theme="error">Download failed: {small.error}</LogMessage>}
    </div>;
}

export default CoachOffer;
