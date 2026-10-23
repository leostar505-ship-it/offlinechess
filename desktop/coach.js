const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { fork } = require("child_process");

const HF = "https://huggingface.co/";

const LIST_URL = "https://github.com/leostar505-ship-it/offlinechess/releases/download/models-list/models.json";
const LIST_LIMIT = 65536;
const LIST_MAX_MODELS = 30;
const REMOTE_WARNING = "This model comes from the online model list and has not been tested with OfflineChess, so it may fail to load or give poor answers.";

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
    /(^|\.)hf\.co$/,
    /^github\.com$/,
    /(^|\.)githubusercontent\.com$/
];

for (const model of Object.values(MODELS)) {
    if (model.repo) model.url = HF + model.repo + "/resolve/main/" + model.name;
}

const remote = {};
const states = {};
const loadErrors = {};
let listState = { error: null, checkedAt: null, checking: false };
let cacheLoaded = false;
const thinkingSupport = { compact: true, huge: true, small: false, large: false, custom: false };

function newState() {
    return { downloading: false, received: 0, total: 0, error: null, abort: null, retrying: false, attempt: 0 };
}

for (const key of Object.keys(MODELS)) {
    states[key] = newState();
}

function has(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function isModelKey(key) {
    return has(MODELS, key) || has(remote, key);
}

function modelOf(key) {
    return MODELS[key] || remote[key];
}

function stateOf(key) {
    if (!states[key]) states[key] = newState();

    return states[key];
}

function isRemote(key) {
    return has(remote, key);
}

function modelPath(key, dir) {
    return path.join(dir, modelOf(key).name);
}

function customInfoPath(dir) {
    return path.join(dir, "custom.json");
}

function sizeOf(key, dir) {
    if (key !== "custom" && !isRemote(key)) return MODELS[key].size;

    if (isRemote(key) && !isInstalled(key, dir)) return remote[key].size;

    try {
        return fs.statSync(modelPath(key, dir)).size;
    } catch {
        return 0;
    }
}

function isInstalled(key, dir) {
    try {
        const size = fs.statSync(modelPath(key, dir)).size;

        return key === "custom" || isRemote(key) ? size > 0 : size === MODELS[key].size;
    } catch {
        return false;
    }
}

function labelOf(key, dir) {
    if (key !== "custom") return modelOf(key).label;

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

function fetchTo(url, dest, startAt, onBytes, hash, signal, onTotal, redirects = 0) {
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
                    dest, startAt, onBytes, hash, signal, onTotal, redirects + 1
                ));
            }

            if (response.statusCode === 416) {
                response.resume();
                return reject(Object.assign(new Error("Server ignored resume"), { restart: true }));
            }

            const resumed = response.statusCode === 206;

            if (response.statusCode !== 200 && !resumed) {
                response.resume();
                return reject(new Error("Download failed with HTTP " + response.statusCode));
            }

            if (!resumed && startAt > 0) {
                return reject(Object.assign(new Error("Server ignored resume"), { restart: true }));
            }

            const rangeTotal = Number(/\/(\d+)$/.exec(String(response.headers["content-range"] || ""))?.[1]);
            const total = resumed ? rangeTotal : Number(response.headers["content-length"]);

            if (total > 0) onTotal(total);

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

    const model = modelOf(key);
    const state = stateOf(key);
    const partPath = modelPath(key, dir) + ".part";
    const exact = !isRemote(key) && key !== "custom";

    let existing = 0;

    try {
        existing = fs.statSync(partPath).size;
    } catch {
    }

    if (exact && existing >= model.size) {
        fs.rmSync(partPath, { force: true });
        existing = 0;
    }

    let hash = existing > 0 ? await hashFile(partPath) : crypto.createHash("sha256");

    state.received = existing;
    state.total = exact ? model.size : 0;

    const onTotal = total => {
        state.total = total;
    };

    try {
        await fetchTo(model.url, partPath, existing, bytes => {
            state.received += bytes;
        }, hash, signal, onTotal);
    } catch (error) {
        if (!error.restart) throw error;

        fs.rmSync(partPath, { force: true });
        hash = crypto.createHash("sha256");
        state.received = 0;

        await fetchTo(model.url, partPath, 0, bytes => {
            state.received += bytes;
        }, hash, signal, onTotal);
    }

    if (model.sha256 && hash.digest("hex") !== model.sha256) {
        fs.rmSync(partPath, { force: true });
        throw new Error("Downloaded file failed its integrity check");
    }

    if (fs.statSync(partPath).size === 0) {
        fs.rmSync(partPath, { force: true });
        throw new Error("The download was empty");
    }

    fs.renameSync(partPath, modelPath(key, dir));
}

function isRetryable(error) {
    const message = String(error && error.message || "");

    if (/Blocked download host|integrity check|too many redirects/i.test(message)) return false;

    const http = /HTTP (\d+)/.exec(message);

    if (http) {
        const code = Number(http[1]);

        return code >= 500 || code === 408 || code === 429;
    }

    return true;
}

function pause(ms, signal) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);

        signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(Object.assign(new Error("Cancelled"), { cancelled: true }));
        }, { once: true });
    });
}

async function downloadWithRetry(key, dir, signal, run = runDownload, wait = pause) {
    const state = stateOf(key);
    let attempt = 0;

    for (;;) {
        try {
            await run(key, dir, signal);

            state.retrying = false;
            state.attempt = 0;
            state.error = null;

            return;
        } catch (error) {
            if (error.cancelled || signal.aborted || !isRetryable(error)) throw error;

            attempt++;

            state.retrying = true;
            state.attempt = attempt;
            state.error = error.message || "Connection lost";

            await wait(Math.min(30000, 2000 * attempt), signal);
        }
    }
}

function start(key, dir) {
    const state = stateOf(key);

    if (key === "custom" || !isModelKey(key) || state.downloading || isInstalled(key, dir)) return;

    const controller = new AbortController();

    state.downloading = true;
    state.error = null;
    state.retrying = false;
    state.attempt = 0;
    state.abort = controller;

    downloadWithRetry(key, dir, controller.signal)
        .catch(error => {
            state.error = error.cancelled || controller.signal.aborted
                ? null
                : (error.message || "Download failed");
        })
        .finally(() => {
            state.downloading = false;
            state.retrying = false;
            state.abort = null;
        });
}

function cancel(key) {
    stateOf(key).abort?.abort();
}

function remove(key, dir) {
    cancel(key);

    if (activeKey === key) stopWorker();

    fs.rmSync(modelPath(key, dir), { force: true });
    fs.rmSync(modelPath(key, dir) + ".part", { force: true });

    if (key === "custom") fs.rmSync(customInfoPath(dir), { force: true });

    loadErrors[key] = null;
    stateOf(key).received = 0;
    stateOf(key).error = null;
}

function listCachePath(dir) {
    return path.join(dir, "list-cache.json");
}

function sizeFromName(name) {
    const match = /\((\d+(?:\.\d+)?)\s*G(?:B)?\)/i.exec(name);

    return match ? Math.round(Number(match[1]) * 1024 ** 3) : 0;
}

function validHost(url) {
    try {
        const parsed = new URL(url);

        return parsed.protocol === "https:" && allowedHosts.some(pattern => pattern.test(parsed.hostname));
    } catch {
        return false;
    }
}

function parseList(text) {
    const parsed = JSON.parse(text);
    const entries = Array.isArray(parsed) ? parsed : parsed && parsed.models;

    if (!Array.isArray(entries)) throw new Error("The model list is not in the expected format");

    const result = [];

    for (const entry of entries.slice(0, LIST_MAX_MODELS)) {
        if (!entry || typeof entry.name !== "string" || typeof entry.url !== "string") continue;

        const name = entry.name.trim().slice(0, 80);

        if (!name || !validHost(entry.url)) continue;

        result.push({ name, url: entry.url });
    }

    return result;
}

function keyForUrl(url) {
    return "list-" + crypto.createHash("sha1").update(url).digest("hex").slice(0, 12);
}

function applyList(entries, dir) {
    const builtinByUrl = {};

    for (const [key, model] of Object.entries(MODELS)) {
        if (model.url) builtinByUrl[model.url] = key;
    }

    const next = {};

    for (const entry of entries) {
        const builtin = builtinByUrl[entry.url];

        if (builtin) {
            MODELS[builtin].label = entry.name;
            continue;
        }

        next[keyForUrl(entry.url)] = {
            label: entry.name,
            url: entry.url,
            name: keyForUrl(entry.url) + ".gguf",
            size: sizeFromName(entry.name),
            sha256: null,
            warning: REMOTE_WARNING,
            remote: true
        };
    }

    for (const key of Object.keys(remote)) {
        if (!next[key] && !isInstalled(key, dir) && !stateOf(key).downloading) delete remote[key];
    }

    for (const [key, model] of Object.entries(next)) {
        remote[key] = model;
        stateOf(key);
    }
}

function loadListCache(dir) {
    if (cacheLoaded) return;

    cacheLoaded = true;

    try {
        applyList(parseList(fs.readFileSync(listCachePath(dir), "utf8")), dir);
    } catch {
    }
}

function fetchText(url, redirects = 0) {
    return new Promise((resolve, reject) => {
        if (redirects > 5) return reject(new Error("Too many redirects"));

        if (!validHost(url)) return reject(new Error("Blocked list host"));

        const request = https.get(url, { headers: { "User-Agent": "OfflineChess" } }, response => {
            if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
                response.resume();

                return resolve(fetchText(new URL(response.headers.location, url).toString(), redirects + 1));
            }

            if (response.statusCode !== 200) {
                response.resume();

                return reject(new Error("The model list returned HTTP " + response.statusCode));
            }

            const chunks = [];
            let size = 0;

            response.on("data", chunk => {
                size += chunk.length;

                if (size > LIST_LIMIT) return request.destroy(new Error("The model list is too large"));

                chunks.push(chunk);
            });

            response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
            response.on("error", reject);
        });

        request.on("error", reject);
        request.setTimeout(8000, () => request.destroy(new Error("Checking for new models timed out")));
    });
}

async function refreshList(dir, fetcher = fetchText) {
    loadListCache(dir);

    listState = { ...listState, checking: true };

    try {
        const text = await fetcher(LIST_URL);
        const entries = parseList(text);

        applyList(entries, dir);

        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(listCachePath(dir), JSON.stringify({ models: entries }));

        listState = { error: null, checkedAt: Date.now(), checking: false };
    } catch (error) {
        listState = { error: error.message || "Could not check for new models", checkedAt: listState.checkedAt, checking: false };
    }
}

function getStatus(dir) {
    loadListCache(dir);

    const status = { models: {}, list: { error: listState.error, checkedAt: listState.checkedAt, url: LIST_URL } };

    for (const key of [...Object.keys(MODELS), ...Object.keys(remote)]) {
        const model = modelOf(key);
        const state = stateOf(key);
        const installed = isInstalled(key, dir);
        let partial = 0;

        if (!installed) {
            try {
                partial = fs.statSync(modelPath(key, dir) + ".part").size;
            } catch {
            }
        }

        const received = state.downloading ? state.received : partial;
        const total = state.total || model.size;

        status.models[key] = {
            label: labelOf(key, dir),
            warning: model.warning,
            custom: key === "custom",
            remote: isRemote(key),
            thinking: !!thinkingSupport[key],
            loadError: installed ? loadErrors[key] || null : null,
            sizeBytes: installed ? sizeOf(key, dir) : model.size,
            installed,
            downloading: state.downloading,
            retrying: state.downloading && state.retrying,
            attempt: state.attempt,
            progress: installed ? 1 : Math.min(1, received / Math.max(1, total)),
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

        if (message.type === "ready" && message.id === 0 && activeKey === key && (key === "custom" || isRemote(key))) {
            thinkingSupport[key] = !!message.thinking;
        }

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
        label: labelOf(key, dir),
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
            think: request.think === true,
            maxTokens: Math.max(16, Math.min(request.think === true ? 620 : 400, Number(request.maxTokens) || 160))
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
    refreshList,
    downloadWithRetry,
    parseList,
    sizeFromName,
    generate,
    stopWorker,
    isModelKey
};
