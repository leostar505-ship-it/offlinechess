import React, { useEffect, useRef, useState } from "react";

import useSettingsStore from "@/stores/SettingsStore";
import {
    getCoachStatus,
    refreshCoachList,
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

const builtinOptions: { label: string; value: CoachModelKey }[] = [
    { label: "Compact (1.8G)", value: "compact" },
    { label: "Standard (2.5G)", value: "small" },
    { label: "High quality (4G)", value: "large" },
    { label: "Absurd (9G)", value: "huge" }
];

const customOption = { label: "Your own model (.gguf)", value: "custom" };

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
    const [checking, setChecking] = useState(false);
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

    function checkForModels() {
        setChecking(true);

        refreshCoachList().then(next => {
            if (next) setStatus(next);

            setChecking(false);
        });
    }

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

    const modelOptions = [
        ...builtinOptions.map(option => ({
            ...option,
            label: status?.models[option.value]?.label || option.label
        })),
        ...Object.entries(status?.models || {})
            .filter(([, entry]) => entry.remote)
            .map(([key, entry]) => ({ label: entry.label, value: key })),
        customOption
    ];

    const selectedOption = modelOptions.find(option => option.value == coach.model);

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
                    key={selectedOption ? "selected" : "missing"}
                    options={modelOptions}
                    defaultValue={selectedOption}
                    onOpen={checkForModels}
                    onSelect={option => {
                        if (!option) return;

                        setSettings(draft => {
                            draft.analysis.coach.model = option.value;
                            return draft;
                        });
                    }}
                    dropdownStyle={{ width: "220px" }}
                    menuStyle={{ width: "260px" }}
                />
            </div>

            {checking
                && <LogMessage theme="info" includeIcon={false}>Checking for new models...</LogMessage>
            }

            {!checking && status?.list?.error
                && <LogMessage theme="warn">
                    Could not check for new models ({status.list.error}). Showing the models seen last time.
                </LogMessage>
            }

            {!model && coach.model != "custom"
                && <LogMessage theme="warn">
                    The selected model is no longer in the model list. Pick another one.
                </LogMessage>
            }

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

            {model?.retrying
                && <LogMessage theme="info" includeIcon={false}>
                    Connection lost, reconnecting automatically (attempt {model.attempt}). The download
                    carries on from where it stopped.
                </LogMessage>
            }

            {model?.downloading
                && <div className={styles.setting}>
                    <span>Downloading... {Math.round(model.progress * 100)}%</span>

                    <Button onClick={() => cancelCoachDownload(coach.model).then(next => next && setStatus(next))}>
                        Cancel
                    </Button>
                </div>
            }

            {model?.error && !model.retrying
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
