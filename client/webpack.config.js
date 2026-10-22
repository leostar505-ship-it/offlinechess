const { Configuration } = require("webpack");
const { resolve } = require("path");

const nodeEnv = process.env.NODE_ENV || "production";

/**
 * @type {Configuration}
 */
module.exports = {
    entry: {
        analysis: "./src/apps/features/analysis/index.tsx",
        settings: "./src/apps/settings/index.tsx"
    },
    output: {
        filename: "[name].bundle.js",
        path: resolve("./dist")
    },
    resolve: {
        extensions: [".js", ".jsx", ".ts", ".tsx", ".json"],
        alias: {
            "@": resolve("./src"),
            "@analysis": resolve("./src/apps/features/analysis"),
            "@assets": resolve("./public")
        }
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/i,
                use: "babel-loader"
            },
            {
                test: /\.css$/i,
                use: [
                    "style-loader",
                    {
                        loader: "css-loader",
                        options: {
                            modules: true
                        }
                    }
                ]
            },
            {
                test: /\.(png|svg|gif|ttf|mp3)$/i,
                type: "asset"
            }
        ]
    },
    mode: nodeEnv
};