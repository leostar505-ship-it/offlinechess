const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BASE_URL = "https://github.com/leostar505-ship-it/offlinechess/releases/download/engine-data/";

const ENGINES = {
    lite: [
        {
            name: "stockfish-19-lite-single.js",
            size: 28230,
            sha256: "ccb130d7ff29408531c47d859a49f91d59d4f482d05a53eb1a3231a4f624c91a"
        },
        {
            name: "stockfish-19-lite-single.wasm",
            size: 1845971,
            sha256: "ee4f115bdb2d32cadf96cada104a05b5ec257d7ad6f57582190b49bc71f096de"
        }
    ],
    full: [
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
    ]
};

const allowedHosts = [
    /^github\.com$/,
    /(^|\.)githubusercontent\.com$/
];

const states = {};

for (const name of Object.keys(ENGINES)) {
    states[name] = { downloading: false, received: 0, error: null };
}

function totalSize(name) {
    return ENGINES[name].reduce((sum, file) => sum + file.size, 0);
}

function isInstalled(name, dir) {
    return ENGINES[name].every(file => {
        try {
            return fs.statSync(path.join(dir, file.name)).size === file.size;
        } catch {
            return false;
        }
    });
}

function isEngineName(name) {
    return Object.prototype.hasOwnProperty.call(ENGINES, name);
}

function isEngineFile(fileName) {
    return Object.values(ENGINES).some(files => files.some(file => file.name === fileName));
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

async function runDownload(name, dir) {
    fs.mkdirSync(dir, { recursive: true });

    const state = states[name];

    for (const file of ENGINES[name]) {
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

function start(name, dir) {
    const state = states[name];

    if (state.downloading || isInstalled(name, dir)) return;

    state.downloading = true;
    state.received = 0;
    state.error = null;

    runDownload(name, dir)
        .catch(error => {
            state.error = error.message || "Download failed";

            for (const file of ENGINES[name]) {
                fs.rmSync(path.join(dir, file.name + ".part"), { force: true });
            }
        })
        .finally(() => {
            state.downloading = false;
        });
}

function getStatus(name, dir, bundled) {
    const state = states[name];
    const installed = bundled || isInstalled(name, dir);

    return {
        installed,
        downloading: state.downloading,
        progress: installed ? 1 : Math.min(1, state.received / totalSize(name)),
        error: installed ? null : state.error
    };
}

module.exports = { start, getStatus, isEngineFile, isEngineName };
