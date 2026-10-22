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

console.log("app files staged in " + target);
