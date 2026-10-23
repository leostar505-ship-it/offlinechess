const { app, BrowserWindow, Menu, session, shell } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");
const engineDownload = require("./engine-download");
const coach = require("./coach");

const PREFERRED_PORT = 38417;
const HOST = "127.0.0.1";

if (process.platform === "linux") {
    app.commandLine.appendSwitch("no-sandbox");
}

const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
    || (process.env.APPIMAGE && path.dirname(process.env.APPIMAGE));

if (portableDir) {
    try {
        const dataDir = path.join(portableDir, "OfflineChess-data");

        fs.mkdirSync(dataDir, { recursive: true });
        app.setPath("userData", dataDir);
    } catch {
    }
}

const appRoot = path.join(__dirname, "app");
const searchRoots = [
    path.join(appRoot, "dist"),
    path.join(appRoot, "public")
];

const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".wasm": "application/wasm",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".mp3": "audio/mpeg",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8"
};

const pages = {
    analysis: path.join(appRoot, "public", "apps", "features", "analysis.html"),
    settings: path.join(appRoot, "public", "apps", "settings.html")
};

const contentSecurityPolicy = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.chesscomfiles.com https://*.chess.com",
    "font-src 'self' data:",
    "media-src 'self' blob: data:",
    "connect-src 'self' https://api.chess.com https://lichess.org"
].join("; ");

const allowedRemoteHosts = [
    /^api\.chess\.com$/,
    /(^|\.)chesscomfiles\.com$/,
    /^images\.chesscomfiles\.com$/,
    /^lichess\.org$/
];

function readEdition() {
    try {
        return JSON.parse(
            fs.readFileSync(path.join(appRoot, "public", "edition.json"), "utf8")
        );
    } catch {
        return { edition: "full", liteEngine: true, fullEngine: true };
    }
}

const editionInfo = readEdition();

const bundledEngines = {
    lite: editionInfo.liteEngine !== false,
    full: editionInfo.fullEngine !== false
};

function userCoachDir() {
    return path.join(app.getPath("userData"), "coach");
}

function readJsonBody(req, limit = 65536) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];

        req.on("data", chunk => {
            size += chunk.length;

            if (size > limit) {
                reject(new Error("Request too large"));
                req.destroy();
                return;
            }

            chunks.push(chunk);
        });

        req.on("end", () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch {
                reject(new Error("Invalid request"));
            }
        });

        req.on("error", reject);
    });
}

async function handleCoachRequest(req, res) {
    if (!isSameOriginRequest(req)) {
        res.writeHead(403);
        return res.end();
    }

    const url = req.url.split("?")[0];

    if (url === "/api/coach/status" && req.method === "GET") {
        return sendJson(res, 200, coach.getStatus(userCoachDir()));
    }

    if (req.method !== "POST") {
        res.writeHead(405);
        return res.end();
    }

    if (url === "/api/coach/list/refresh") {
        await coach.refreshList(userCoachDir());

        return sendJson(res, 200, coach.getStatus(userCoachDir()));
    }

    const action = /^\/api\/coach\/([a-z0-9-]+)\/(download|cancel|remove)$/.exec(url);

    if (action && coach.isModelKey(action[1])) {
        if (action[2] === "download") coach.start(action[1], userCoachDir());
        else if (action[2] === "cancel") coach.cancel(action[1]);
        else coach.remove(action[1], userCoachDir());

        return sendJson(res, 200, coach.getStatus(userCoachDir()));
    }

    if (url === "/api/coach/custom/upload") {
        let fileName = "model.gguf";

        try {
            fileName = path.basename(decodeURIComponent(new URL(req.url, origin).searchParams.get("name") || fileName));
        } catch {
        }

        try {
            await coach.uploadCustom(req, userCoachDir(), fileName);

            return sendJson(res, 200, coach.getStatus(userCoachDir()));
        } catch (error) {
            return sendJson(res, 400, { error: error.message || "Upload failed" });
        }
    }

    if (url === "/api/coach/generate") {
        let body;

        try {
            body = await readJsonBody(req);
        } catch (error) {
            return sendJson(res, 400, { error: error.message });
        }

        if (!coach.isModelKey(body.model)) {
            return sendJson(res, 400, { error: "Unknown model" });
        }

        const controller = new AbortController();
        res.on("close", () => controller.abort());

        try {
            const text = await coach.generate(
                body.model,
                userCoachDir(),
                body,
                undefined,
                controller.signal
            );

            return sendJson(res, 200, { text });
        } catch (error) {
            if (controller.signal.aborted) return;

            return sendJson(res, 500, { error: error.message || "Coach failed" });
        }
    }

    res.writeHead(404);
    res.end();
}

function userEngineDir() {
    return path.join(app.getPath("userData"), "engines");
}

function sendJson(res, status, body) {
    const data = Buffer.from(JSON.stringify(body));

    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": data.length,
        "Cache-Control": "no-store"
    });

    res.end(data);
}

function isSameOriginRequest(req) {
    const host = req.headers.host;
    const requestOrigin = req.headers.origin;

    if (host !== new URL(origin).host) return false;

    return !requestOrigin || requestOrigin === origin;
}

let origin = "";
let mainWindow = null;

function safeResolve(root, urlPath) {
    const resolved = path.normalize(path.join(root, urlPath));
    if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;

    try {
        return fs.statSync(resolved).isFile() ? resolved : null;
    } catch {
        return null;
    }
}

function findFile(urlPath) {
    for (const root of searchRoots) {
        const found = safeResolve(root, urlPath);
        if (found) return found;
    }

    return null;
}

function sendFile(res, filePath, isPage) {
    const headers = {
        "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()]
            || "application/octet-stream",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff"
    };

    if (isPage) headers["Content-Security-Policy"] = contentSecurityPolicy;

    fs.readFile(filePath, (error, data) => {
        if (error) {
            res.writeHead(500);
            return res.end();
        }

        headers["Content-Length"] = data.length;
        res.writeHead(200, headers);
        res.end(data);
    });
}

function handleRequest(req, res) {
    if (req.url.startsWith("/api/coach/")) {
        handleCoachRequest(req, res);
        return;
    }

    const engineApi = /^\/api\/engine\/([a-z]+)$/.exec(req.url);

    if (engineApi && engineDownload.isEngineName(engineApi[1])) {
        const engineName = engineApi[1];

        if (!isSameOriginRequest(req)) {
            res.writeHead(403);
            return res.end();
        }

        if (req.method === "POST") {
            engineDownload.start(engineName, userEngineDir());
        } else if (req.method !== "GET") {
            res.writeHead(405);
            return res.end();
        }

        return sendJson(
            res,
            200,
            engineDownload.getStatus(engineName, userEngineDir(), bundledEngines[engineName])
        );
    }

    if (req.url === "/engine-setup") {
        return sendFile(res, path.join(__dirname, "setup", "engine-setup.html"), true);
    }

    if (req.url === "/engine-setup.js") {
        return sendFile(res, path.join(__dirname, "setup", "engine-setup.js"), false);
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405);
        return res.end();
    }

    let urlPath;

    try {
        urlPath = decodeURIComponent(new URL(req.url, origin || "http://localhost").pathname);
    } catch {
        res.writeHead(400);
        return res.end();
    }

    if (urlPath === "/" || urlPath === "") {
        res.writeHead(302, { Location: "/analysis" });
        return res.end();
    }

    if (urlPath === "/analysis" || urlPath === "/analysis/") {
        return sendFile(res, pages.analysis, true);
    }

    if (urlPath === "/settings" || urlPath.startsWith("/settings/")) {
        return sendFile(res, pages.settings, true);
    }

    const file = findFile(urlPath);

    if (file) return sendFile(res, file, false);

    if (urlPath.startsWith("/engines/") && engineDownload.isEngineFile(path.basename(urlPath))) {
        const downloaded = safeResolve(userEngineDir(), path.basename(urlPath));

        if (downloaded) return sendFile(res, downloaded, false);
    }

    if (!path.extname(urlPath)) return sendFile(res, pages.analysis, true);

    res.writeHead(404);
    res.end();
}

function listen(port) {
    return new Promise((resolve, reject) => {
        const server = http.createServer(handleRequest);

        server.once("error", reject);
        server.listen(port, HOST, () => {
            server.removeListener("error", reject);
            resolve(server);
        });
    });
}

async function startServer() {
    let server;

    try {
        server = await listen(PREFERRED_PORT);
    } catch {
        server = await listen(0);
    }

    origin = "http://" + HOST + ":" + server.address().port;

    return server;
}

function installNetworkGuard() {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        let url;

        try {
            url = new URL(details.url);
        } catch {
            return callback({ cancel: true });
        }

        if (["data:", "blob:", "devtools:", "chrome-extension:"].includes(url.protocol)) {
            return callback({ cancel: false });
        }

        if (url.origin === origin) return callback({ cancel: false });

        if (url.protocol === "https:") {
            if (url.hostname === "lichess.org") {
                return callback({ cancel: !url.pathname.startsWith("/api/games/user/") });
            }

            if (allowedRemoteHosts.some(pattern => pattern.test(url.hostname))) {
                return callback({ cancel: false });
            }
        }

        callback({ cancel: true });
    });

    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
        callback(false);
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        show: false,
        title: "OfflineChess",
        backgroundColor: "#1e1e1e",
        icon: path.join(__dirname, "build", "icon.png"),
        autoHideMenuBar: true,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: false
        }
    });

    mainWindow.once("ready-to-show", () => mainWindow.show());

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("https://")) shell.openExternal(url);

        return { action: "deny" };
    });

    mainWindow.webContents.on("will-navigate", (event, url) => {
        if (new URL(url).origin === origin) return;

        event.preventDefault();

        if (url.startsWith("https://")) shell.openExternal(url);
    });

    mainWindow.webContents.on("before-input-event", (event, input) => {
        if (input.type !== "keyDown") return;

        const contents = mainWindow.webContents;

        if (input.key === "F11") {
            mainWindow.setFullScreen(!mainWindow.isFullScreen());
            event.preventDefault();
        } else if (input.control && (input.key === "=" || input.key === "+")) {
            contents.setZoomLevel(contents.getZoomLevel() + 0.5);
            event.preventDefault();
        } else if (input.control && input.key === "-") {
            contents.setZoomLevel(contents.getZoomLevel() - 0.5);
            event.preventDefault();
        } else if (input.control && input.key === "0") {
            contents.setZoomLevel(0);
            event.preventDefault();
        } else if (
            process.env.OFFLINECHESS_DEBUG
            && (input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i"))
        ) {
            contents.toggleDevTools();
            event.preventDefault();
        }
    });

    mainWindow.on("closed", () => {
        mainWindow = null;
    });

    const needsEngineSetup = !bundledEngines.lite
        && !engineDownload.getStatus("lite", userEngineDir(), false).installed;

    mainWindow.loadURL(origin + (needsEngineSetup ? "/engine-setup" : "/analysis"));
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on("second-instance", () => {
        if (!mainWindow) return;

        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    });

    app.whenReady().then(async () => {
        Menu.setApplicationMenu(null);

        coach.cleanupRetired(userCoachDir());

        await startServer();
        installNetworkGuard();
        createWindow();

        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });

    app.on("window-all-closed", () => app.quit());
    app.on("before-quit", () => coach.stopWorker());
}
