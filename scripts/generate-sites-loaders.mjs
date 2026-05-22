#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

function normalizeRelativeUrl(url) {
    return url.replace(/^\/+/, "").replace(/\/+$/, "");
}

function toPosixPath(value) {
    return value.split(path.sep).join("/");
}

function createLoaderHtml(title, normalizedUrl) {
    const prettyPath = normalizedUrl === "" ? "/" : `/${normalizedUrl}/`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        :root {
            color-scheme: dark;
            --bg: #0b1118;
            --panel: #121a25;
            --line: #2a394f;
            --text: #e9eff9;
            --muted: #9aa9c4;
            --accent: #5fd4ff;
        }

        * { box-sizing: border-box; }

        body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            background:
                radial-gradient(60vw 50vh at 0% 0%, #14273c 0%, transparent 60%),
                var(--bg);
            color: var(--text);
            font-family: "Lato", "Segoe UI", sans-serif;
        }

        .panel {
            width: min(780px, calc(100% - 2rem));
            border: 1px solid var(--line);
            border-radius: 14px;
            padding: 1rem 1.1rem;
            background: var(--panel);
        }

        h1 {
            margin: 0 0 0.5rem;
            font-size: 1.15rem;
        }

        p {
            margin: 0.35rem 0;
            line-height: 1.4;
            color: var(--muted);
        }

        code {
            color: var(--accent);
        }

        a {
            color: var(--accent);
        }
    </style>
</head>
<body>
    <main class="panel">
        <h1>${title}</h1>
        <p>This static loader page is served from <code>/sites${prettyPath}</code>.</p>
        <p>If project files are added under this folder, this page can be replaced by the actual app entrypoint.</p>
        <p><a href="../../index.html">Back to collection</a></p>
    </main>
</body>
</html>
`;
}

async function run() {
    const repositoryRoot = path.resolve(process.argv[2] ?? process.cwd());
    const listPath = path.join(repositoryRoot, "list.js");
    const listModule = await import(pathToFileURL(listPath).href);
    const links = listModule.links;

    if (!Array.isArray(links) || links.length === 0) {
        throw new Error("No links found in list.js");
    }

    const sitesRoot = path.join(repositoryRoot, "sites");

    for (const item of links) {
        const normalizedUrl = normalizeRelativeUrl(item.url);
        const targetDir = path.join(sitesRoot, normalizedUrl);
        const targetIndex = path.join(targetDir, "index.html");

        await fs.mkdir(targetDir, { recursive: true });

        try {
            const current = await fs.lstat(targetIndex);
            if (current.isSymbolicLink()) {
                await fs.unlink(targetIndex);
            }
        } catch {
            // Ignore missing file.
        }

        const html = createLoaderHtml(item.title, toPosixPath(normalizedUrl));
        await fs.writeFile(targetIndex, html, "utf8");
        console.log(`Wrote ${path.relative(repositoryRoot, targetIndex)}`);
    }
}

run().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
});
