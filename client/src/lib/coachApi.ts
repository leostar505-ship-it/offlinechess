export type CoachModelKey = "tiny" | "compact" | "small" | "large" | "huge";
export type CoachCoverage = "key" | "all" | "current";

export interface CoachModelStatus {
    label: string;
    warning: string | null;
    sizeBytes: number;
    installed: boolean;
    downloading: boolean;
    progress: number;
    error: string | null;
    active: boolean;
    totalBytes: number;
    usableBytes: number;
    neededBytes: number;
    enoughMemory: boolean;
}

export interface CoachStatus {
    models: Record<CoachModelKey, CoachModelStatus>;
}

const json = { "Content-Type": "application/json" };

export async function getCoachStatus(): Promise<CoachStatus | null> {
    try {
        const response = await fetch("/api/coach/status");

        if (!response.ok) return null;

        return await response.json();
    } catch {
        return null;
    }
}

async function post(path: string): Promise<CoachStatus | null> {
    try {
        const response = await fetch(path, { method: "POST" });

        if (!response.ok) return null;

        return await response.json();
    } catch {
        return null;
    }
}

export function startCoachDownload(model: CoachModelKey) {
    return post("/api/coach/" + model + "/download");
}

export function cancelCoachDownload(model: CoachModelKey) {
    return post("/api/coach/" + model + "/cancel");
}

export function removeCoachModel(model: CoachModelKey) {
    return post("/api/coach/" + model + "/remove");
}

export async function generateCoachText(
    model: CoachModelKey,
    system: string,
    prompt: string,
    maxTokens: number,
    signal?: AbortSignal
): Promise<string | null> {
    try {
        const response = await fetch("/api/coach/generate", {
            method: "POST",
            headers: json,
            body: JSON.stringify({ model, system, prompt, maxTokens }),
            signal
        });

        if (!response.ok) return null;

        const body = await response.json();

        return typeof body.text == "string" ? body.text : null;
    } catch {
        return null;
    }
}

export function formatGigabytes(bytes: number) {
    return (bytes / 1024 ** 3).toFixed(1) + " GB";
}
