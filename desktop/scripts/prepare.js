const fs = require("fs");
const path = require("path");

const desktopRoot = path.resolve(__dirname, "..");
const clientRoot = path.resolve(desktopRoot, "..", "client");
const target = path.join(desktopRoot, "app");

const bundleDir = path.join(clientRoot, "dist");
const publicDir = path.join(clientRoot, "public");

if (!fs.existsSync(path.join(bundleDir, "analysis.bundle.js"))) {
    console.error("client/dist is missing, run the client build first (npm run build at the repo root)");
    process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

fs.cpSync(bundleDir, path.join(target, "dist"), { recursive: true });
fs.cpSync(publicDir, path.join(target, "public"), { recursive: true });

const engineTarget = path.join(target, "public", "engines");

fs.rmSync(engineTarget, { recursive: true, force: true });
fs.mkdirSync(engineTarget, { recursive: true });

function findStockfishBin() {
    const candidates = [
        path.join(desktopRoot, "node_modules", "stockfish", "bin"),
        path.join(desktopRoot, "..", "node_modules", "stockfish", "bin")
    ];

    return candidates.find(candidate => fs.existsSync(candidate));
}

const stockfishBin = findStockfishBin();

if (!stockfishBin) {
    console.error("the stockfish npm package is missing, run npm install first");
    process.exit(1);
}

const engineFiles = [
    "stockfish-19-lite-single.js",
    "stockfish-19-lite-single.wasm",
    "stockfish-19-single.js",
    "stockfish-19-single.wasm",
    "stockfish-19-asm.js"
];

for (const file of engineFiles) {
    fs.copyFileSync(path.join(stockfishBin, file), path.join(engineTarget, file));
}

console.log("app files staged in " + target);
