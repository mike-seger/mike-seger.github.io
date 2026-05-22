#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

async function loadPlaywright() {
    try {
        return await import("playwright");
    } catch (error) {
        console.error("Missing dependency: playwright");
        console.error("Install with: npm install --save-dev playwright");
        throw error;
    }
}

function normalizeRelativeUrl(url) {
    return url.replace(/^\/+/, "");
}

function previewOutputPath(repositoryRoot, url) {
    const normalized = normalizeRelativeUrl(url).replace(/\/+$/, "");
    const target = normalized === "" ? "root" : normalized;
    return path.join(repositoryRoot, "previews", target, "index.png");
}

function resolveRootUrl(baseUrl, relativeUrl) {
    const cleanBase = baseUrl.replace(/\/+$/, "");
    const cleanRelative = normalizeRelativeUrl(relativeUrl);
    return `${cleanBase}/${cleanRelative}`;
}

async function ensureParentDirectory(filePath) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function run() {
    const repositoryRoot = path.resolve(process.argv[2] ?? process.cwd());
    const baseUrl = process.argv[3] ?? "http://127.0.0.1:8080";
    const width = Number(process.argv[4] ?? 1280);
    const height = Number(process.argv[5] ?? 720);

    const listPath = path.join(repositoryRoot, "list.js");
    const listModule = await import(pathToFileURL(listPath).href);
    const links = listModule.links;

    if (!Array.isArray(links) || links.length === 0) {
        throw new Error("No links found in list.js");
    }

    const playwright = await loadPlaywright();
    const browser = await playwright.chromium.launch();
    const page = await browser.newPage({ viewport: { width, height } });

    for (const item of links) {
        const targetUrl = resolveRootUrl(baseUrl, item.url);
        const outputPath = previewOutputPath(repositoryRoot, item.url);

        await ensureParentDirectory(outputPath);

        console.log(`Capturing ${targetUrl}`);

        try {
            await page.goto(targetUrl, {
                waitUntil: "networkidle",
                timeout: 30000
            });
        } catch (error) {
            console.error(`Failed to load ${targetUrl}: ${error.message}`);
            continue;
        }

        await page.screenshot({ path: outputPath, fullPage: false });
        console.log(`Saved ${path.relative(repositoryRoot, outputPath)}`);
    }

    await browser.close();
}

run().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
});
