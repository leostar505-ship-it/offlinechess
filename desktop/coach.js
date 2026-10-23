const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { fork } = require("child_process");

const HF = "https://huggingface.co/";

const CUSTOM_WARNING = "Your own model must be a GGUF file that works with the host this app uses (llama.cpp through node-llama-cpp). Newer or unusual model types may fail to load, bigger models need more RAM, and the comments are only as good as the model you pick.";

const MODELS = {
    compact: {
        label: "Compact (about 1.8 GB)",
        repo: "unsloth/Qwen3-1.7B-GGUF",
        name: "Qwen3-1.7B-Q8_0.gguf",
        size: 1834426944,
        sha256: "0becaa825564295d82e9af4d008bca5f8b7f5f73bf1c6a0b58f7c53ef26b47fd",
        warning: "Lower quality analysis. Use this if you are data limited or do not have enough RAM for the Standard model."
    },
    small: {
        label: "Standard (about 2.5 GB)",
        repo: "unsloth/Qwen3-4B-Instruct-2507-GGUF",
        name: "Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
        size: 2497281120,
        sha256: "3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597",
        warning: null
    },
    large: {
        label: "High quality (about 4 GB)",
        repo: "unsloth/Qwen3-4B-Instruct-2507-GGUF",
        name: "Qwen3-4B-Instruct-2507-Q8_0.gguf",
        size: 4280405600,
        sha256: "391c1e410fd9f4cf2de2b510273b56a84c19ce18f4fa3bfb3774031dac4ef068",
        warning: null
    },
    custom: {
        label: "Your own model",
        repo: null,
        name: "custom.gguf",
        size: 0,
        sha256: null,
        warning: CUSTOM_WARNING
    },
    huge: {
        label: "Absurd (about 9 GB)",
        repo: "unsloth/Qwen3-14B-GGUF",
        name: "Qwen3-14B-Q4_K_M.gguf",
        size: 9001753984,
        sha256: "5eaa0870bd81ed3b58a630a271234cfa604e43ffb3a19cd68e54a80dd9d52a66",
        warning: "Extremely slow. Even on a fast computer each comment can take several minutes, so use it with Only the move I'm viewing. It needs about 16 GB of RAM."
    }
};

const BACKGROUND_RESERVE = 4 * 1024 ** 3;
const RUNTIME_OVERHEAD = 0.75 * 1024 ** 3;

const allowedHosts = [
    /^huggingface\.co$/,
    /(^|\.)hf\.co$/
];

const states = {};
const loadErrors = {};

for (const key of Object.keys(MODELS)) {
    states[key] = { downloading: false, received: 0, error: null, abort: null };
}

function isModelKey(key) {
    return Object.prototype.hasOwnProperty.call(MODELS, key);
}

function modelPath(key, dir) {
    return path.join(dir, MODELS[key].name);
}

function customInfoPath(dir) {
    return path.join(dir, "custom.json");
}

function sizeOf(key, dir) {
    if (key !== "custom") return MODELS[key].size;

    try {
        return fs.statSync(modelPath(key, dir)).size;
    } catch {
        return 0;
    }
}

function isInstalled(key, dir) {
    try {
        const size = fs.statSync(modelPath(key, dir)).size;

        return key === "custom" ? size > 0 : size === MODELS[key].size;
    } catch {
        return false;
    }
}

function labelOf(key, dir) {
    if (key !== "custom") return MODELS[key].label;

    try {
        const info = JSON.parse(fs.readFileSync(customInfoPath(dir), "utf8"));

        return "Your own model: " + String(info.name).slice(0, 80);
    } catch {
        return MODELS[key].label;
    }
}

function memoryInfo(key, dir) {
    const total = os.totalmem();
    const usable = Math.max(0, total - BACKGROUND_RESERVE);
    const needed = sizeOf(key, dir) + RUNTIME_OVERHEAD;

    return {
        totalBytes: total,
        usableBytes: usable,
        neededBytes: needed,
        enoughMemory: usable >= needed
    };
}

function fetchTo(url, dest, startAt, onBytes, hash, signal, redirects = 0) {
    return new Promise((resolve, reject) => {
        if (redirects > 6) return reject(new Error("Too many redirects"));

        let parsed;

        try {
            parsed = new URL(url);
        } catch (error) {
            return reject(error);
        }

        if (parsed.protocol !== "https:" || !allowedHosts.some(pattern => pattern.test(parsed.hostname))) {
            return reject(new Error("Blocked download host"));
        }

        const headers = { "User-Agent": "OfflineChess" };
        if (startAt > 0) headers.Range = "bytes=" + startAt + "-";

        const request = https.get(url, { headers }, response => {
            const redirect = [301, 302, 303, 307, 308].includes(response.statusCode)
                && response.headers.location;

            if (redirect) {
                response.resume();

                return resolve(fetchTo(
                    new URL(response.headers.location, url).toString(),
                    dest, startAt, onBytes, hash, signal, redirects + 1
                ));
            }

            const resumed = response.statusCode === 206;

            if (response.statusCode !== 200 && !resumed) {
                response.resume();
                return reject(new Error("Download failed with HTTP " + response.statusCode));
            }

            if (!resumed && startAt > 0) {
                return reject(Object.assign(new Error("Server ignored resume"), { restart: true }));
            }

            const out = fs.createWriteStream(dest, { flags: resumed ? "a" : "w" });

            response.on("data", chunk => {
                hash.update(chunk);
                onBytes(chunk.length);
            });

            response.on("error", reject);
            response.on("close", () => {
                if (!response.complete) reject(new Error("Connection lost"));
            });

            out.on("error", reject);
            out.on("finish", resolve);

            response.pipe(out);
        });

        request.on("error", reject);
        request.setTimeout(30000, () => request.destroy(new Error("Connection timed out")));

        signal.addEventListener("abort", () => {
            request.destroy(Object.assign(new Error("Cancelled"), { cancelled: true }));
        }, { once: true });
    });
}

function hashFile(file) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(file);

        stream.on("data", chunk => hash.update(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolve(hash));
    });
}

async function runDownload(key, dir, signal) {
    fs.mkdirSync(dir, { recursive: true });

    const model = MODELS[key];
    const state = states[key];
    const partPath = modelPath(key, dir) + ".part";

    let existing = 0;

    try {
        existing = fs.statSync(partPath).size;
    } catch {
    }

    if (existing >= model.size) {
        fs.rmSync(partPath, { force: true });
        existing = 0;
    }

    let hash = existing > 0 ? await hashFile(partPath) : crypto.createHash("sha256");

    state.received = existing;

    try {
        await fetchTo(HF + model.repo + "/resolve/main/" + model.name, partPath, existing, bytes => {
            state.received += bytes;
        }, hash, signal);
    } catch (error) {
        if (!error.restart) throw error;

        fs.rmSync(partPath, { force: true });
        hash = crypto.createHash("sha256");
        state.received = 0;

        await fetchTo(HF + model.repo + "/resolve/main/" + model.name, partPath, 0, bytes => {
            state.received += bytes;
        }, hash, signal);
    }

    if (hash.digest("hex") !== model.sha256) {
        fs.rmSync(partPath, { force: true });
        throw new Error("Downloaded file failed its integrity check");
    }

    fs.renameSync(partPath, modelPath(key, dir));
}

function start(key, dir) {
    const state = states[key];

    if (key === "custom" || state.downloading || isInstalled(key, dir)) return;

    const controller = new AbortController();

    state.downloading = true;
    state.error = null;
    state.abort = controller;

    runDownload(key, dir, controller.signal)
        .catch(error => {
            state.error = error.cancelled || controller.signal.aborted
                ? null
                : (error.message || "Download failed");
        })
        .finally(() => {
            state.downloading = false;
            state.abort = null;
        });
}

function cancel(key) {
    states[key].abort?.abort();
}

function remove(key, dir) {
    cancel(key);

    if (activeKey === key) stopWorker();

    fs.rmSync(modelPath(key, dir), { force: true });
    fs.rmSync(modelPath(key, dir) + ".part", { force: true });

    if (key === "custom") fs.rmSync(customInfoPath(dir), { force: true });

    loadErrors[key] = null;
    states[key].received = 0;
    states[key].error = null;
}

function getStatus(dir) {
    const status = { models: {} };

    for (const key of Object.keys(MODELS)) {
        const state = states[key];
        const installed = isInstalled(key, dir);
        let partial = 0;

        if (!installed) {
            try {
                partial = fs.statSync(modelPath(key, dir) + ".part").size;
            } catch {
            }
        }

        const received = state.downloading ? state.received : partial;

        status.models[key] = {
            label: labelOf(key, dir),
            warning: MODELS[key].warning,
            custom: key === "custom",
            loadError: installed ? loadErrors[key] || null : null,
            sizeBytes: installed ? sizeOf(key, dir) : MODELS[key].size,
            installed,
            downloading: state.downloading,
            progress: installed ? 1 : Math.min(1, received / Math.max(1, MODELS[key].size)),
            error: installed ? null : state.error,
            active: installed && activeKey === key,
            ...memoryInfo(key, dir)
        };
    }

    return status;
}

let worker = null;
let activeKey = null;
let ready = null;
let nextId = 1;
const pending = new Map();
let idleTimer = null;

function resolveWorkerPath() {
    return path.join(__dirname, "coach-worker.js").replace(
        "app.asar" + path.sep,
        "app.asar.unpacked" + path.sep
    );
}

function failAll(message) {
    for (const entry of pending.values()) entry.reject(new Error(message));
    pending.clear();
}

function stopWorker() {
    clearTimeout(idleTimer);

    if (worker) {
        worker.removeAllListeners();
        worker.kill();
    }

    worker = null;
    activeKey = null;
    ready = null;

    failAll("The coach was stopped");
}

function scheduleIdleStop() {
    clearTimeout(idleTimer);

    if (pending.size > 0) return;

    idleTimer = setTimeout(stopWorker, 5 * 60 * 1000);
}

function startWorker(key, dir) {
    const child = fork(resolveWorkerPath(), [], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        execArgv: [],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        serialization: "json"
    });

    worker = child;
    activeKey = key;

    ready = new Promise((resolve, reject) => {
        pending.set(0, { resolve, reject });
    });

    child.on("message", message => {
        const entry = pending.get(message.id);
        if (!entry) return;

        if (message.type === "chunk") {
            entry.onChunk?.(message.text);
            return;
        }

        pending.delete(message.id);

        if (message.type === "error") entry.reject(new Error(message.error));
        else entry.resolve(message.text);

        scheduleIdleStop();
    });

    child.on("exit", () => {
        if (worker !== child) return;

        worker = null;
        activeKey = null;
        ready = null;

        failAll("The coach stopped unexpectedly");
    });

    child.send({
        type: "load",
        id: 0,
        modelPath: modelPath(key, dir),
        threads: Math.max(2, Math.min(8, os.cpus().length - 1))
    });

    return ready;
}

async function generate(key, dir, request, onChunk, signal) {
    if (!isModelKey(key) || !isInstalled(key, dir)) {
        throw new Error("The coach model is not installed");
    }

    if (worker && activeKey !== key) stopWorker();

    clearTimeout(idleTimer);

    try {
        if (!worker) await startWorker(key, dir);
        else await ready;

        loadErrors[key] = null;
    } catch (error) {
        loadErrors[key] = error.message || "The model could not be loaded";
        stopWorker();
        throw error;
    }

    const id = nextId++;

    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, onChunk });

        signal?.addEventListener("abort", () => {
            if (!pending.has(id)) return;

            pending.delete(id);
            worker?.send({ type: "abort", id });
            reject(Object.assign(new Error("Cancelled"), { cancelled: true }));
            scheduleIdleStop();
        }, { once: true });

        worker.send({
            type: "generate",
            id,
            system: String(request.system || ""),
            prompt: String(request.prompt || ""),
            maxTokens: Math.max(16, Math.min(400, Number(request.maxTokens) || 160))
        });
    });
}

const retiredFiles = [
    "Qwen3-0.6B-Q8_0.gguf",
    "Qwen3-0.6B-Q4_K_M.gguf",
    "Qwen3-0.6B-Q2_K.gguf"
];

function cleanupRetired(dir) {
    for (const name of retiredFiles) {
        fs.rmSync(path.join(dir, name), { force: true });
        fs.rmSync(path.join(dir, name + ".part"), { force: true });
    }
}

function uploadCustom(req, dir, fileName) {
    return new Promise((resolve, reject) => {
        fs.mkdirSync(dir, { recursive: true });

        if (activeKey === "custom") stopWorker();

        const target = modelPath("custom", dir);
        const partPath = target + ".part";
        const out = fs.createWriteStream(partPath);
        let head = Buffer.alloc(0);

        function fail(error) {
            out.destroy();
            fs.rmSync(partPath, { force: true });
            reject(error);
        }

        req.on("data", chunk => {
            if (head.length < 4) head = Buffer.concat([head, chunk]).subarray(0, 4);
        });

        req.on("error", fail);
        req.on("aborted", () => fail(new Error("Upload cancelled")));
        out.on("error", fail);

        out.on("finish", () => {
            if (head.toString("latin1") !== "GGUF") {
                return fail(new Error("That file is not a GGUF model"));
            }

            fs.renameSync(partPath, target);
            fs.writeFileSync(customInfoPath(dir), JSON.stringify({ name: fileName }));
            loadErrors.custom = null;
            resolve();
        });

        req.pipe(out);
    });
}

module.exports = {
    uploadCustom,
    cleanupRetired,
    start,
    cancel,
    remove,
    getStatus,
    generate,
    stopWorker,
    isModelKey
};
