const choices = document.getElementById("choices");
const progress = document.getElementById("progress");
const fill = document.getElementById("fill");
const status = document.getElementById("status");
const errorBox = document.getElementById("error");

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getStatus(name) {
    const response = await fetch("/api/engine/" + name);

    if (!response.ok) throw new Error("The app could not reach its engine service");

    return response.json();
}

async function download(name, label, startPercent, endPercent) {
    const first = await getStatus(name);

    if (first.installed) return;

    await fetch("/api/engine/" + name, { method: "POST" });

    while (true) {
        const current = await getStatus(name);

        const percent = startPercent + (endPercent - startPercent) * current.progress;

        fill.style.width = percent + "%";
        status.textContent = "Downloading " + label + "... " + Math.round(current.progress * 100) + "%";

        if (current.installed) return;

        if (current.error) throw new Error(current.error);

        if (!current.downloading) throw new Error("The download stopped unexpectedly");

        await wait(400);
    }
}

async function run(wantFull) {
    errorBox.style.display = "none";
    choices.style.display = "none";
    progress.style.display = "block";
    fill.style.width = "0%";

    try {
        if (wantFull) {
            await download("lite", "Stockfish 19 Lite", 0, 5);
            await download("full", "Stockfish 19", 5, 100);
        } else {
            await download("lite", "Stockfish 19 Lite", 0, 100);
        }

        status.textContent = "Done, starting OfflineChess...";
        fill.style.width = "100%";

        await wait(500);
        location.href = "/analysis";
    } catch (error) {
        progress.style.display = "none";
        choices.style.display = "grid";
        errorBox.style.display = "block";
        errorBox.textContent = "Download failed: " + error.message + ". Check your internet connection and pick again.";
    }
}

document.getElementById("pick-lite").addEventListener("click", () => run(false));
document.getElementById("pick-full").addEventListener("click", () => run(true));
