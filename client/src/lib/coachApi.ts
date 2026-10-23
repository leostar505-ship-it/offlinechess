export type CoachModelKey = string;
export type CoachCoverage = "key" | "all" | "current";

export interface CoachModelStatus {
    label: string;
    warning: string | null;
    custom: boolean;
    remote: boolean;
    loadError: string | null;
    thinking: boolean;
    sizeBytes: number;
    installed: boolean;
    downloading: boolean;
    retrying: boolean;
    attempt: number;
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
    list?: { error: string | null; checkedAt: number | null; url: string };
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

export function refreshCoachList() {
    return post("/api/coach/list/refresh");
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

export function uploadCustomCoachModel(
    file: File,
    onProgress: (progress: number) => void
): Promise<string | null> {
    return new Promise(resolve => {
        const request = new XMLHttpRequest();

        request.open("POST", "/api/coach/custom/upload?name=" + encodeURIComponent(file.name));

        request.upload.onprogress = event => {
            if (event.lengthComputable) onProgress(event.loaded / event.total);
        };

        request.onload = () => {
            if (request.status == 200) return resolve(null);

            try {
                resolve(JSON.parse(request.responseText).error || "Upload failed");
            } catch {
                resolve("Upload failed");
            }
        };

        request.onerror = () => resolve("Upload failed");
        request.send(file);
    });
}

export async function generateCoachText(
    model: CoachModelKey,
    system: string,
    prompt: string,
    maxTokens: number,
    signal?: AbortSignal,
    think?: boolean
): Promise<string | null> {
    try {
        const response = await fetch("/api/coach/generate", {
            method: "POST",
            headers: json,
            body: JSON.stringify({ model, system, prompt, maxTokens, think }),
            signal
        });

        if (!response.ok) return null;

        const body = await response.json();

        return typeof body.text == "string" ? body.text : null;
    } catch (error) {
        if (signal?.aborted) return null;

        throw error;
    }
}

export function formatGigabytes(bytes: number) {
    return (bytes / 1024 ** 3).toFixed(1) + " GB";
}
