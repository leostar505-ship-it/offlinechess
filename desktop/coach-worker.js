let model = null;
let context = null;
let LlamaChatSession = null;
let QwenChatWrapper = null;
let loading = null;
let thinkingModel = false;

const THOUGHT_TOKENS = 400;

const controllers = new Map();

function reply(message) {
    process.send(message);
}

async function load(message) {
    try {
        const llamaModule = await import("node-llama-cpp");

        LlamaChatSession = llamaModule.LlamaChatSession;
        QwenChatWrapper = llamaModule.QwenChatWrapper;

        const llama = await llamaModule.getLlama({ gpu: false, build: "never" });

        model = await llama.loadModel({ modelPath: message.modelPath });
        const template = model.fileInfo?.metadata?.tokenizer?.chat_template;

        thinkingModel = typeof template === "string"
            && template.includes("<think>")
            && template.includes("<|im_start|>");

        context = await model.createContext({
            contextSize: 2048,
            threads: message.threads
        });

        reply({ type: "ready", id: message.id, thinking: thinkingModel });
    } catch (error) {
        reply({ type: "error", id: message.id, error: String(error && error.message || error) });
    }
}

async function generate(message) {
    const controller = new AbortController();
    controllers.set(message.id, controller);

    let sequence = null;

    try {
        sequence = context.getSequence();

        const session = new LlamaChatSession({
            contextSequence: sequence,
            systemPrompt: message.system,
            chatWrapper: thinkingModel
                ? new QwenChatWrapper({ thoughts: message.think ? "auto" : "discourage" })
                : undefined
        });

        let text = "";

        await session.prompt(message.prompt, {
            maxTokens: message.maxTokens,
            budgets: thinkingModel && message.think ? { thoughtTokens: THOUGHT_TOKENS } : undefined,
            temperature: 0.25,
            topP: 0.9,
            signal: controller.signal,
            stopOnAbortSignal: true,
            onTextChunk: chunk => {
                text += chunk;
                reply({ type: "chunk", id: message.id, text: chunk });
            }
        });

        reply({ type: "done", id: message.id, text: text.trim() });
    } catch (error) {
        if (!controller.signal.aborted) {
            reply({ type: "error", id: message.id, error: String(error && error.message || error) });
        }
    } finally {
        controllers.delete(message.id);
        sequence?.dispose();
    }
}

process.on("message", message => {
    if (message.type === "load") {
        loading = load(message);
    } else if (message.type === "generate") {
        Promise.resolve(loading).then(() => generate(message));
    } else if (message.type === "abort") {
        controllers.get(message.id)?.abort();
    }
});

process.on("disconnect", () => process.exit(0));
