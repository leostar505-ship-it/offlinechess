const path = require("path");
const { spawnSync } = require("child_process");
const { build, Platform, Arch } = require("electron-builder");

const desktopRoot = path.resolve(__dirname, "..");
const packageJson = require(path.join(desktopRoot, "package.json"));
const version = packageJson.version;

async function main() {
    for (const edition of ["full", "lite", "skeleton"]) {
        const label = edition.charAt(0).toUpperCase() + edition.slice(1);

        const prepared = spawnSync(
            process.execPath,
            [path.join(__dirname, "prepare.js"), edition],
            { stdio: "inherit", cwd: desktopRoot }
        );

        if (prepared.status !== 0) process.exit(prepared.status || 1);

        const config = JSON.parse(JSON.stringify(packageJson.build));

        config.directories.output = "release/" + edition;
        config.nsis.artifactName = "OfflineChess-Setup-" + label + "-" + version + ".exe";
        config.portable.artifactName = "OfflineChess-Portable-" + label + "-" + version + ".exe";

        await build({
            projectDir: desktopRoot,
            targets: Platform.WINDOWS.createTarget(["nsis", "portable"], Arch.x64),
            config,
            publish: "never"
        });
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
