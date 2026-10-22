const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BASE_URL = "https://github.com/leostar505-ship-it/offlinechess/releases/download/engine-data/";

const FILES = [
    {
        name: "stockfish-19-single.js",
        size: 28130,
        sha256: "8071dee87312f74805a859de933e1a1ef465579ab1a51fbd597388cdce9d444d"
    },
    {
        name: "stockfish-19-single.wasm",
        size: 99169054,
        sha256: "991bede2f253ebb08ff01fcc48270f4b9c8e66b12d5bd5f8d6f52eb3e3b3a740"
    }
];

const allowedHosts = [
    /^github\.com$/,
    /(^|\.)githubusercontent\.com$/
];

const totalSize = FILES.reduce((sum, file) => sum + file.size, 0);

const state = {
    downloading: false,
    received: 0,
    error: null
};

function isInstalled(dir) {
    return FILES.every(file => {
        try {
            return fs.statSync(path.join(dir, file.name)).size === file.size;
        } catch {
            return false;
        }
    });
}

function isEngineFile(name) {
    return FILES.some(file => file.name === name);
}

function fetchTo(url, dest, onBytes, redirects = 0) {
    return new Promise((resolve, reject) => {
        if (redirects > 5) return reject(new Error("Too many redirects"));

        let parsed;

        try {
            parsed = new URL(url);
        } catch (error) {
            return reject(error);
        }

        if (parsed.protocol !== "https:" || !allowedHosts.some(pattern => pattern.test(parsed.hostname))) {
            return reject(new Error("Blocked download host"));
        }

        const request = https.get(url, { headers: { "User-Agent": "OfflineChess" } }, response => {
            const redirect = [301, 302, 303, 307, 308].includes(response.statusCode)
                && response.headers.location;

            if (redirect) {
                response.resume();
                return resolve(fetchTo(new URL(response.headers.location, url).toString(), dest, onBytes, redirects + 1));
            }

            if (response.statusCode !== 200) {
                response.resume();
                return reject(new Error("Download failed with HTTP " + response.statusCode));
            }

            const hash = crypto.createHash("sha256");
            const out = fs.createWriteStream(dest);

            response.on("data", chunk => {
                hash.update(chunk);
                onBytes(chunk.length);
            });

            response.on("error", reject);
            response.on("close", () => {
                if (!response.complete) reject(new Error("Connection lost"));
            });

            out.on("error", reject);
            out.on("finish", () => resolve(hash.digest("hex")));

            response.pipe(out);
        });

        request.on("error", reject);
        request.setTimeout(30000, () => request.destroy(new Error("Connection timed out")));
    });
}

async function runDownload(dir) {
    fs.mkdirSync(dir, { recursive: true });

    for (const file of FILES) {
        const finalPath = path.join(dir, file.name);
        const partPath = finalPath + ".part";

        const digest = await fetchTo(BASE_URL + file.name, partPath, bytes => {
            state.received += bytes;
        });

        if (digest !== file.sha256) {
            fs.rmSync(partPath, { force: true });
            throw new Error("Downloaded file failed its integrity check");
        }

        fs.renameSync(partPath, finalPath);
    }
}

function start(dir) {
    if (state.downloading || isInstalled(dir)) return;

    state.downloading = true;
    state.received = 0;
    state.error = null;

    runDownload(dir)
        .catch(error => {
            state.error = error.message || "Download failed";

            for (const file of FILES) {
                fs.rmSync(path.join(dir, file.name + ".part"), { force: true });
            }
        })
        .finally(() => {
            state.downloading = false;
        });
}

function getStatus(dir, bundled) {
    const installed = bundled || isInstalled(dir);

    return {
        installed,
        downloading: state.downloading,
        progress: installed ? 1 : Math.min(1, state.received / totalSize),
        error: installed ? null : state.error
    };
}

module.exports = { start, getStatus, isEngineFile };
