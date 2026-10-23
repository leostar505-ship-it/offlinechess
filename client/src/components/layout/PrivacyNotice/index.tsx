import React, { useState } from "react";

import Dialog from "@/components/common/Dialog";
import Button from "@/components/common/Button";

import * as styles from "./PrivacyNotice.module.css";

const HIDDEN_KEY = "offlinechess_privacy_notice_hidden";
const SHOWN_KEY = "offlinechess_privacy_notice_shown";

function read(storage: () => Storage, key: string) {
    try {
        return storage().getItem(key) == "1";
    } catch {
        return false;
    }
}

function write(storage: () => Storage, key: string) {
    try {
        storage().setItem(key, "1");
    } catch {
    }
}

function PrivacyNotice() {
    const [open, setOpen] = useState(
        !read(() => localStorage, HIDDEN_KEY)
        && !read(() => sessionStorage, SHOWN_KEY)
    );
    const [never, setNever] = useState(false);

    if (!open) return null;

    function close() {
        write(() => sessionStorage, SHOWN_KEY);

        if (never) write(() => localStorage, HIDDEN_KEY);

        setOpen(false);
    }

    return <Dialog className={styles.dialog} onClose={close}>
        <h2 className={styles.title}>Your privacy</h2>

        <p className={styles.body}>
            All AI models and replies exist solely on your local device, no information is
            shared to the internet unless you use the chess.com/lichess search feature, which
            connects to the internet to pull selected games based off of your choosing.
        </p>

        <p className={styles.body}>
            Opening the AI coach model list also connects to GitHub (github.com/leostar505-ship-it/offlinechess)
            to check whether the list of available models has changed, and downloading a model connects to
            the site hosting it, such as Hugging Face. Nothing about your games is sent.
        </p>

        <label className={styles.remember}>
            <input
                type="checkbox"
                checked={never}
                onChange={event => setNever(event.target.checked)}
            />

            Don't show this again
        </label>

        <Button onClick={close}>Close</Button>
    </Dialog>;
}

export default PrivacyNotice;
