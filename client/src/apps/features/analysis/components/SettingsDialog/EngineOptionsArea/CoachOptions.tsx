import React, { useEffect, useRef, useState } from "react";

import useSettingsStore from "@/stores/SettingsStore";
import {
    getCoachStatus,
    startCoachDownload,
    cancelCoachDownload,
    removeCoachModel,
    uploadCustomCoachModel,
    formatGigabytes,
    CoachStatus,
    CoachModelKey,
    CoachCoverage
} from "@/lib/coachApi";
import LogMessage from "@/components/common/LogMessage";
import Button from "@/components/common/Button";
import DropdownSetting from "@/components/settings/DropdownSetting";
import SwitchSetting from "@/components/settings/SwitchSetting";

import * as styles from "../SettingsDialog.module.css";

const modelOptions: { label: string; value: CoachModelKey }[] = [
    { label: "Pico (0.3 GB)", value: "pico" },
    { label: "Nano (0.4 GB)", value: "nano" },
    { label: "Tiny (0.6 GB)", value: "tiny" },
    { label: "Compact (1.8 GB)", value: "compact" },
    { label: "Standard (2.5 GB)", value: "small" },
    { label: "High quality (4 GB)", value: "large" },
    { label: "Absurd (9 GB)", value: "huge" },
    { label: "Your own model (.gguf)", value: "custom" }
];

const coverageOptions: { label: string; value: CoachCoverage }[] = [
    { label: "Key moments + summary", value: "key" },
    { label: "Every move + summary", value: "all" },
    { label: "Only the move I'm viewing", value: "current" }
];

function CoachOptions() {
    const { settings, setSettings } = useSettingsStore();
    const coach = settings.analysis.coach;

    const [status, setStatus] = useState<CoachStatus | null>(null);
    const [unavailable, setUnavailable] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<number | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const timer = useRef<ReturnType<typeof setInterval>>();

    function refresh() {
        getCoachStatus().then(next => {
            if (!next) return setUnavailable(true);

            setStatus(next);
        });
    }

    useEffect(() => {
        refresh();

        return () => clearInterval(timer.current);
    }, []);

    useEffect(() => {
        clearInterval(timer.current);

        const downloading = status && Object.values(status.models).some(model => model.downloading);

        if (downloading) timer.current = setInterval(refresh, 700);
    }, [status]);

    async function uploadFile(file: File) {
        setUploadError(null);
        setUploadProgress(0);

        const error = await uploadCustomCoachModel(file, setUploadProgress);

        setUploadProgress(null);
        setUploadError(error);
        refresh();
    }

    if (unavailable) return null;

    const model = status?.models[coach.model];

    return <>
        <div className={styles.setting}>
            <span>AI coach (optional)</span>

            <SwitchSetting
                defaultChecked={coach.enabled}
                onChange={checked => (
                    setSettings(draft => {
                        draft.analysis.coach.enabled = checked;
                        return draft;
                    })
                )}
            />
        </div>

        <LogMessage theme="info" includeIcon={false}>
            A small AI model that runs only on your computer and explains moves in plain
            language after you press Analyse. Nothing you analyse is ever sent anywhere.
        </LogMessage>

        {coach.enabled && <>
            <div className={styles.setting}>
                <span>Model size</span>

                <DropdownSetting
                    options={modelOptions}
                    defaultValue={modelOptions.find(option => option.value == coach.model)}
                    onSelect={option => {
                        if (!option) return;

                        setSettings(draft => {
                            draft.analysis.coach.model = option.value;
                            return draft;
                        });
                    }}
                    dropdownStyle={{ width: "180px" }}
                />
            </div>

            <div className={styles.setting}>
                <span>Explain</span>

                <DropdownSetting
                    options={coverageOptions}
                    defaultValue={coverageOptions.find(option => option.value == coach.coverage)}
                    onSelect={option => {
                        if (!option) return;

                        setSettings(draft => {
                            draft.analysis.coach.coverage = option.value;
                            return draft;
                        });
                    }}
                    dropdownStyle={{ width: "180px" }}
                />
            </div>

            {model?.warning
                && <LogMessage theme="warn">{model.warning}</LogMessage>
            }

            {model && !model.enoughMemory
                && <LogMessage theme="warn">
                    You may not have enough RAM to download and use this model. It needs
                    about {formatGigabytes(model.neededBytes)} free, and you have about{" "}
                    {formatGigabytes(model.usableBytes)} usable ({formatGigabytes(model.totalBytes)}{" "}
                    total, minus 4 GB for background processes). The Standard model is safer.
                </LogMessage>
            }

            {model?.custom && !model.installed && uploadProgress == null
                && <div className={styles.setting}>
                    <span>No model added yet</span>

                    <Button onClick={() => fileInput.current?.click()}>
                        Choose .gguf file
                    </Button>

                    <input
                        ref={fileInput}
                        type="file"
                        accept=".gguf"
                        style={{ display: "none" }}
                        onChange={event => {
                            const file = event.target.files?.[0];

                            event.target.value = "";

                            if (file) uploadFile(file);
                        }}
                    />
                </div>
            }

            {uploadProgress != null
                && <LogMessage theme="info">
                    Adding your model... {Math.round(uploadProgress * 100)}%
                </LogMessage>
            }

            {uploadError && <LogMessage theme="error">{uploadError}</LogMessage>}

            {model?.loadError
                && <LogMessage theme="error">
                    This model could not be loaded: {model.loadError}
                </LogMessage>
            }

            {model && !model.custom && !model.installed && !model.downloading
                && <div className={styles.setting}>
                    <span>{model.label} is not downloaded</span>

                    <Button onClick={() => startCoachDownload(coach.model).then(next => next && setStatus(next))}>
                        Download
                    </Button>
                </div>
            }

            {model?.downloading
                && <div className={styles.setting}>
                    <span>Downloading... {Math.round(model.progress * 100)}%</span>

                    <Button onClick={() => cancelCoachDownload(coach.model).then(next => next && setStatus(next))}>
                        Cancel
                    </Button>
                </div>
            }

            {model?.error
                && <LogMessage theme="error">
                    Could not download the coach: {model.error}. Check your internet connection and try again.
                </LogMessage>
            }

            {model?.installed
                && <div className={styles.setting}>
                    <span>Installed ({formatGigabytes(model.sizeBytes)})</span>

                    <Button onClick={() => removeCoachModel(coach.model).then(next => next && setStatus(next))}>
                        Remove
                    </Button>
                </div>
            }
        </>}
    </>;
}

export default CoachOptions;
