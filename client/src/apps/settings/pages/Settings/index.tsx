import React, { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useNavigate } from "react-router-dom";

import LoadingPlaceholder from "@/components/layout/LoadingPlaceholder";
import CategoryTab from "@/apps/settings/components/CategoryTab";

import * as styles from "./Settings.module.css";

import iconIconsSettings from "@assets/img/icons/settings.png";

function Settings() {
    const { t } = useTranslation(["settings", "common"]);

    const navigate = useNavigate();

    return <div className={styles.wrapper}>
        <div className={styles.titleContainer}>
            <img src={iconIconsSettings} />

            <span>{t("settings", { ns: "common" })}</span>
        </div>

        <div className={styles.settingsContainer}>
            <div className={styles.settings}>
                <Suspense fallback={<LoadingPlaceholder/>}>
                    <Outlet/>
                </Suspense>
            </div>

            <div className={styles.categories}>
                <CategoryTab
                    active={location.pathname.includes("/settings/theme")}
                    onClick={() => navigate("/settings/theme")}
                >
                    {t("boardAndPieces.title")}
                </CategoryTab>

            </div>
        </div>
    </div>;
}

export default Settings;