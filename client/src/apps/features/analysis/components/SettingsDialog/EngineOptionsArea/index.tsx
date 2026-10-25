import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "react-tooltip";
import { floor, clamp } from "lodash-es";

import EngineVersion from "shared/constants/EngineVersion";
import EngineArrowType from "@analysis/constants/EngineArrowType";
import useSettingsStore from "@/stores/SettingsStore";
import { downloadFullEngine, getFullEngineStatus, FullEngineStatus } from "@/lib/fullEngine";
import LogMessage from "@/components/common/LogMessage";
import DropdownSetting from "@/components/settings/DropdownSetting";
import NumberSetting from "@/components/settings/NumberSetting";
import SwitchSetting from "@/components/settings/SwitchSetting";

import CoachOptions from "./CoachOptions";

import * as styles from "../SettingsDialog.module.css";

function EngineOptionsArea() {
    const { t, i18n } = useTranslation(["analysis", "common"]);

    const { settings, setSettings } = useSettingsStore();

    const [fullStatus, setFullStatus] = useState<FullEngineStatus | null>(null);
    const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
    const [downloadFailed, setDownloadFailed] = useState(false);
    const [dropdownKey, setDropdownKey] = useState(0);

    useEffect(() => {
        getFullEngineStatus().then(setFullStatus);
    }, []);

    const engineVersionOptions = useMemo(() => [
        {
            label: fullStatus && !fullStatus.installed
                ? "Stockfish 19 (94 MB download)"
                : "Stockfish 19 (94 MB)",
            value: EngineVersion.STOCKFISH_19
        },
        {
            label: "Stockfish 19 Lite (Recommended)",
            value: EngineVersion.STOCKFISH_19_LITE
        },
        {
            label: "Stockfish 19 (Compatibility)",
            value: EngineVersion.STOCKFISH_19_ASM
        }
    ], [fullStatus]);

    async function selectEngineVersion(version: EngineVersion) {
        if (version == EngineVersion.STOCKFISH_19 && fullStatus && !fullStatus.installed) {
            setDownloadFailed(false);
            setDownloadProgress(0);

            const succeeded = await downloadFullEngine(setDownloadProgress);

            setDownloadProgress(null);

            if (!succeeded) {
                setDownloadFailed(true);
                setDropdownKey(key => key + 1);
                return;
            }

            setFullStatus({ ...fullStatus, installed: true });
        }

        setSettings(draft => {
            draft.analysis.engine.version = version;
            return draft;
        });
    }

    const engineArrowsOptions = useMemo(() => [
        {
            label: t("disabled", { ns: "common" }),
            value: EngineArrowType.DISABLED
        },
        {
            label: t("settings.engine.suggestionArrows.continuation"),
            value: EngineArrowType.TOP_CONTINUATION
        },
        {
            label: t("settings.engine.suggestionArrows.alternative"),
            value: EngineArrowType.TOP_ALTERNATIVE
        },
        {
            label: "Best Result",
            value: EngineArrowType.BEST_RESULT
        },
        {
            label: "Move Threats",
            value: EngineArrowType.MOVE_THREATS
        },
        {
            label: "All",
            value: EngineArrowType.ALL
        },
        {
            label: "Review",
            value: EngineArrowType.REVIEW
        }
    ], [i18n.language]);

    return <>
        <span className={styles.header}>
            {t("settings.engine.title")}
        </span>

        <span className={styles.setting}>
            <span>{t("enabled", { ns: "common" })}</span>

            <SwitchSetting
                defaultChecked={settings.analysis.engine.enabled}
                onChange={checked => (
                    setSettings(draft => {
                        draft.analysis.engine.enabled = checked;
                        return draft;
                    })
                )}
            />
        </span>

        <div className={styles.setting}>
            <span data-tooltip-id="settings-engine-version">
                {t("settings.engine.version")}
            </span>

            <Tooltip
                id="settings-engine-version"
                content={t("settings.engine.descriptions.version")}
                delayShow={500}
                className={styles.settingDescription}
            />

            <DropdownSetting
                key={dropdownKey}
                options={engineVersionOptions}
                defaultValue={engineVersionOptions.find(
                    option => option.value == settings.analysis.engine.version
                )}
                onSelect={option => {
                    if (!option) return;

                    selectEngineVersion(option.value);
                }}
                dropdownStyle={{ width: "180px" }}
            />
        </div>

        {downloadProgress != null
            && <LogMessage theme="info">
                Downloading Stockfish 19... {Math.round(downloadProgress * 100)}%
            </LogMessage>
        }

        {downloadFailed
            && <LogMessage theme="error">
                Could not download Stockfish 19. Check your internet connection and try again.
            </LogMessage>
        }

        <CoachOptions/>

        <div className={styles.setting}>
            <span data-tooltip-id="settings-engine-depth">
                {t("settings.engine.depth")}
            </span>

            <Tooltip
                id="settings-engine-depth"
                content={t("settings.engine.descriptions.depth")}
                delayShow={500}
                className={styles.settingDescription}
            />

            <NumberSetting
                min={10}
                max={99}
                defaultValue={settings.analysis.engine.depth}
                onChange={value => (
                    setSettings(draft => {
                        draft.analysis.engine.depth = floor(
                            clamp(value, 10, 99)
                        );
                        return draft;
                    })
                )}
                style={{ width: "180px" }}
            />
        </div>

        <LogMessage theme="info" includeIcon={false}>
            Depth 20 is recommended for mostly accurate evaluation on casual hardware. If analysis is taking too long, go down to 18.
        </LogMessage>

        {settings.analysis.engine.depth < 18
            && <LogMessage theme="warn">
                Below depth 18 the evaluation may not be accurate, so accuracies and move ratings can be off.
            </LogMessage>
        }

        {settings.analysis.engine.depth > 22
            && <LogMessage theme="warn">
                Above depth 22 you need a powerful CPU to get this level of analysis. On casual hardware it may take very long or never finish.
            </LogMessage>
        }

        <div className={styles.setting}>
            <span data-tooltip-id="settings-engine-lines">
                {t("settings.engine.lines")}
            </span>

            <Tooltip
                id="settings-engine-lines"
                content={t("settings.engine.descriptions.lines")}
                delayShow={500}
                className={styles.settingDescription}
            />

            <NumberSetting
                min={0}
                max={5}
                defaultValue={settings.analysis.engine.lines}
                onChange={value => (
                    setSettings(draft => {
                        draft.analysis.engine.lines = floor(
                            clamp(value, 1, 5)
                        );
                        return draft;
                    })
                )}
                style={{ width: "180px" }}
            />
        </div>

        {settings.analysis.engine.lines < 2
            && <LogMessage theme="warn">
                {t("settings.engine.linesWarning")}
            </LogMessage>
        }

        <div className={styles.setting}>
            <span data-tooltip-id="settings-engine-time-limit">
                {t("settings.engine.timeLimit")}
            </span>

            <Tooltip
                id="settings-engine-time-limit"
                content={t("settings.engine.descriptions.timeLimit")}
                delayShow={500}
                className={styles.settingDescription}
            />

            <div className={styles.subsetting}>
                <SwitchSetting
                    defaultChecked={settings.analysis.engine.timeLimitEnabled}
                    onChange={checked => (
                        setSettings(draft => {
                            draft.analysis.engine.timeLimitEnabled = checked;
                            return draft;
                        })
                    )}
                />

                <NumberSetting
                    min={0.01}
                    defaultValue={settings.analysis.engine.timeLimit}
                    onChange={value => (
                        setSettings(draft => {
                            draft.analysis.engine.timeLimit = floor(
                                Math.max(0.01, value), 2
                            );
                            return draft;
                        })
                    )}
                    style={{ width: "180px" }}
                />
            </div>
        </div>

        <div className={styles.setting}>
            <span data-tooltip-id="settings-engine-suggestion-arrows">
                {t("settings.engine.suggestionArrows.title")}
            </span>

            <Tooltip
                id="settings-engine-suggestion-arrows"
                delayShow={500}
                className={styles.settingDescription}
            >
                {t("settings.engine.descriptions.suggestionArrows.disabled")}
                <br/><br/>
                {t("settings.engine.descriptions.suggestionArrows.continuation")}
                <br/><br/>
                {t("settings.engine.descriptions.suggestionArrows.alternative")}
                <br/><br/>
                Best Result: when the best line is a strong attack, such as a sacrifice that leads to
                checkmate or wins material, it draws the key moves of that line. Otherwise it shows the best move.
                <br/><br/>
                Move Threats: draws orange arrows from the piece that just moved to the enemy pieces it now attacks.
                <br/><br/>
                All: shows the threats, the best alternative and the best line together. White's moves are drawn
                in white and Black's in black, including the best reply to a sacrifice.
                <br/><br/>
                Review: green is the best move you could have played, orange is what the move you played now
                attacks, and red is how the opponent can punish a mistake. Knight moves are drawn as an L.
            </Tooltip>

            <DropdownSetting
                defaultValue={engineArrowsOptions.find(option => (
                    option.value == settings.analysis.engine.suggestionArrows
                ))}
                options={engineArrowsOptions}
                onSelect={option => {
                    if (!option) return;

                    setSettings(draft => {
                        draft.analysis.engine.suggestionArrows = option.value;
                        return draft;
                    });
                }}
                dropdownStyle={{ width: "180px" }}
            />
        </div>
    </>;
}

export default EngineOptionsArea;