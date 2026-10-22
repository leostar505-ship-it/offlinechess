interface FullEngineStatus {
    installed: boolean;
    downloading: boolean;
    progress: number;
    error: string | null;
}

const assumedInstalled: FullEngineStatus = {
    installed: true,
    downloading: false,
    progress: 1,
    error: null
};

async function getFullEngineStatus(): Promise<FullEngineStatus> {
    try {
        const response = await fetch("/api/engine/full");

        if (!response.ok) return assumedInstalled;

        return await response.json();
    } catch {
        return assumedInstalled;
    }
}

async function downloadFullEngine(
    onProgress: (progress: number) => void
): Promise<boolean> {
    try {
        const started = await fetch("/api/engine/full", { method: "POST" });

        if (!started.ok) return false;

        while (true) {
            const status = await getFullEngineStatus();

            onProgress(status.progress);

            if (status.installed) return true;
            if (status.error || !status.downloading) return false;

            await new Promise(resolve => setTimeout(resolve, 500));
        }
    } catch {
        return false;
    }
}

export type { FullEngineStatus };
export { getFullEngineStatus, downloadFullEngine };
