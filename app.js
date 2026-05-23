import { links } from "./list.js";

const isGithubPagesHost = window.location.hostname.endsWith("github.io");
const pathResolutionCache = new Map();
const pageMetadataCache = new Map();
const previewCachePrefix = "collection-preview-v5:";
const defaultPreviewDataUrl = (() => {
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
            <defs>
                <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="#18263a" />
                    <stop offset="100%" stop-color="#0f1724" />
                </linearGradient>
            </defs>
            <rect width="640" height="360" fill="url(#g)" />
            <rect x="24" y="24" width="592" height="312" rx="16" fill="none" stroke="#31455f" stroke-width="2"/>
            <text x="50%" y="48%" dominant-baseline="middle" text-anchor="middle" fill="#b2c1d8" font-family="Segoe UI, Arial, sans-serif" font-size="26">Preview Pending</text>
            <text x="50%" y="60%" dominant-baseline="middle" text-anchor="middle" fill="#7f90ac" font-family="Segoe UI, Arial, sans-serif" font-size="16">Loading live thumbnail...</text>
        </svg>
    `;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
})();

const linksGrid = document.getElementById("linksGrid");
const overlay = document.getElementById("overlay");
const overlayFrame = document.getElementById("overlayFrame");
const overlayTitle = document.getElementById("overlayTitle");
const overlayControls = document.getElementById("overlayControls");
const overlayDragHandle = document.getElementById("overlayDragHandle");
const openInTabButton = document.getElementById("openInTab");
const openGithubButton = document.getElementById("openGithub");
const closeOverlayButton = document.getElementById("closeOverlay");
let selectedPath = "";
let selectedGithubUrl = "";
let selectedCard = null;
let dragState = null;
let overlayHistoryActive = false;

function syncOverlayHistoryState(state) {
    try {
        window.history.replaceState(state, "", window.location.href);
    } catch {
        // Ignore history write failures.
    }
}

function normalizeRelativeUrl(url) {
    return url.replace(/^\/+/, "");
}

async function resolveLinkPath(url) {
    const normalized = normalizeRelativeUrl(url);

    if (pathResolutionCache.has(normalized)) {
        return pathResolutionCache.get(normalized);
    }

    if (isGithubPagesHost) {
        pathResolutionCache.set(normalized, normalized);
        return normalized;
    }

    const localPath = `sites/${normalized}`;
    pathResolutionCache.set(normalized, localPath);
    return localPath;
}

function firstUrlSegment(url) {
    const normalized = normalizeRelativeUrl(url).replace(/\/+$/, "");
    const segments = normalized.split("/").filter(Boolean);
    return segments[0] || "";
}

function resolveGithubUrl(item) {
    if (typeof item.github === "string" && item.github.trim() !== "") {
        return item.github.trim();
    }

    const repoName = firstUrlSegment(item.url);
    if (!repoName) {
        return "";
    }

    return `https://github.com/mike-seger/${repoName}`;
}

function previewStorageKey(url) {
    const normalized = normalizeRelativeUrl(url).replace(/\/+$/, "");
    return `${previewCachePrefix}${normalized || "root"}`;
}

function readCachedPreview(url) {
    try {
        return localStorage.getItem(previewStorageKey(url));
    } catch {
        return null;
    }
}

async function canLoadImage(url) {
    await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("image load failed"));
        img.src = url;
    });
}

function writeCachedPreview(url, dataUrl) {
    try {
        localStorage.setItem(previewStorageKey(url), dataUrl);
    } catch {
        // Ignore quota/storage restrictions and keep default preview.
    }
}

function clearCachedPreview(url) {
    try {
        localStorage.removeItem(previewStorageKey(url));
    } catch {
        // Ignore storage failures.
    }
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    const words = String(text || "").trim().split(/\s+/).filter(Boolean);
    let line = "";
    let lines = 0;

    for (let i = 0; i < words.length; i += 1) {
        const testLine = line ? `${line} ${words[i]}` : words[i];
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && line) {
            ctx.fillText(line, x, y + (lines * lineHeight));
            lines += 1;
            line = words[i];
            if (lines >= maxLines - 1) {
                break;
            }
        } else {
            line = testLine;
        }
    }

    if (lines < maxLines && line) {
        ctx.fillText(line, x, y + (lines * lineHeight));
    }
}

function buildPreviewImage() {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 270;
    const ctx = canvas.getContext("2d");

    if (!ctx) {
        return null;
    }

    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "#15324b");
    gradient.addColorStop(1, "#0f1825");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#dce8fb";
    ctx.font = "700 28px Lato, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Preview", canvas.width / 2, canvas.height / 2);

    return canvas.toDataURL("image/jpeg", 0.82);
}

async function getPageMetadata(targetUrl) {
    if (pageMetadataCache.has(targetUrl)) {
        return pageMetadataCache.get(targetUrl);
    }

    const pending = (async () => {
        const response = await fetch(targetUrl, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`metadata fetch failed: ${response.status}`);
        }

        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const baseUrl = new URL(targetUrl, window.location.href);
        const iconNode = doc.querySelector('link[rel~="icon" i], link[rel="shortcut icon" i], link[rel="apple-touch-icon" i]');
        const ogImageNode = doc.querySelector('meta[property="og:image" i]');
        const twitterImageNode = doc.querySelector('meta[name="twitter:image" i]');
        const rawIconHref = iconNode?.getAttribute("href") || "";
        const rawOgImageHref = ogImageNode?.getAttribute("content") || "";
        const rawTwitterImageHref = twitterImageNode?.getAttribute("content") || "";
        let faviconHref = "";
        let previewImageHref = "";

        const rawPreviewImageHref = rawOgImageHref.trim() || rawTwitterImageHref.trim();
        if (rawPreviewImageHref !== "") {
            previewImageHref = new URL(rawPreviewImageHref, baseUrl).href;
        }

        if (rawIconHref.trim() !== "") {
            faviconHref = new URL(rawIconHref, baseUrl).href;
        } else {
            faviconHref = new URL("/favicon.ico", baseUrl).href;
        }

        return {
            faviconHref,
            previewImageHref
        };
    })();

    pageMetadataCache.set(targetUrl, pending);
    return pending;
}

async function generatePreviewFromPageMetadata(item, targetUrl) {
    const metadata = await getPageMetadata(targetUrl);

    if (metadata.previewImageHref) {
        try {
            await canLoadImage(metadata.previewImageHref);
            return metadata.previewImageHref;
        } catch {
            // Fall back to generated Preview card.
        }
    }

    const dataUrl = buildPreviewImage(item, targetUrl);

    if (!dataUrl) {
        throw new Error("preview canvas unavailable");
    }

    return dataUrl;
}

async function hydrateFavicon(item, iconElement) {
    try {
        const targetUrl = await resolveLinkPath(item.url);
        const metadata = await getPageMetadata(targetUrl);
        if (!metadata.faviconHref) {
            return;
        }

        iconElement.src = metadata.faviconHref;
        iconElement.classList.add("visible");
    } catch {
        // Ignore favicon lookup failures.
    }
}

async function hydratePreview(item, imageElement) {
    const targetUrl = await resolveLinkPath(item.url);
    const metadata = await getPageMetadata(targetUrl);

    if (metadata.previewImageHref) {
        clearCachedPreview(item.url);
        imageElement.src = metadata.previewImageHref;
        return;
    }

    const cachedPreview = readCachedPreview(item.url);
    if (cachedPreview) {
        imageElement.src = cachedPreview;
        return;
    }

    const queue = window.requestIdleCallback
        ? (callback) => window.requestIdleCallback(callback, { timeout: 2000 })
        : (callback) => window.setTimeout(callback, 0);

    queue(() => {
        ensurePreviewCaptured(item, imageElement);
    });
}

function hydrateLivePreview(item, mediaShell, iframeElement, fallbackImageElement) {
    hydratePreview(item, fallbackImageElement);

    const revealTimeout = window.setTimeout(() => {
        mediaShell.classList.remove("live-ready");
    }, 8000);

    iframeElement.addEventListener("load", () => {
        window.clearTimeout(revealTimeout);
        mediaShell.classList.add("live-ready");
    }, { once: true });

    resolveLinkPath(item.url)
        .then((targetUrl) => {
            iframeElement.src = targetUrl;
        })
        .catch(() => {
            window.clearTimeout(revealTimeout);
            mediaShell.classList.remove("live-ready");
        });
}

async function ensurePreviewCaptured(item, imageElement) {
    const targetUrl = await resolveLinkPath(item.url);
    const metadata = await getPageMetadata(targetUrl);

    if (metadata.previewImageHref) {
        clearCachedPreview(item.url);
        imageElement.src = metadata.previewImageHref;
        return;
    }

    const cachedPreview = readCachedPreview(item.url);
    if (cachedPreview) {
        imageElement.src = cachedPreview;
        return;
    }

    try {
        const dataUrl = await generatePreviewFromPageMetadata(item, targetUrl);
        imageElement.src = dataUrl;
        writeCachedPreview(item.url, dataUrl);
    } catch {
        // Keep default placeholder when runtime capture is not available.
    }
}

function closeOverlay({ fromHistory = false } = {}) {
    if (selectedCard) {
        selectedCard.scrollIntoView({
            block: "nearest",
            inline: "nearest",
            behavior: "smooth"
        });
        selectedCard.focus({ preventScroll: true });
    }

    overlayHistoryActive = false;
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden", "true");
    overlayFrame.src = "about:blank";
    selectedPath = "";
    selectedGithubUrl = "";
    if (selectedCard) {
        selectedCard.classList.remove("selected");
        selectedCard = null;
    }
    openInTabButton.disabled = true;
    openGithubButton.disabled = true;

    if (!fromHistory) {
        syncOverlayHistoryState({ overlayOpen: false });
    }
}

async function openOverlay(item, imageElement, cardElement) {
    if (selectedCard) {
        selectedCard.classList.remove("selected");
    }

    if (cardElement) {
        cardElement.classList.add("selected");
        selectedCard = cardElement;
    }

    const path = await resolveLinkPath(item.url);
    const githubUrl = resolveGithubUrl(item);
    overlayTitle.textContent = item.title;
    if (!overlayHistoryActive) {
        window.history.pushState({ overlayOpen: true }, "", window.location.href);
        overlayHistoryActive = true;
    }
    overlayFrame.src = path;
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    selectedPath = path;
    selectedGithubUrl = githubUrl;
    openInTabButton.disabled = false;
    openGithubButton.disabled = !githubUrl;

    if (imageElement) {
        ensurePreviewCaptured(item, imageElement);
    }
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function positionOverlayControls(left, top) {
    const rect = overlayControls.getBoundingClientRect();
    const maxLeft = Math.max(window.innerWidth - rect.width - 8, 8);
    const maxTop = Math.max(window.innerHeight - rect.height - 8, 8);
    const clampedLeft = clamp(left, 8, maxLeft);
    const clampedTop = clamp(top, 8, maxTop);

    overlayControls.style.left = `${clampedLeft}px`;
    overlayControls.style.top = `${clampedTop}px`;
    overlayControls.style.right = "auto";
    overlayControls.style.transform = "none";
}

function startDragging(event) {
    if (event.button !== 0) {
        return;
    }

    event.preventDefault();
    const rect = overlayControls.getBoundingClientRect();
    dragState = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top
    };
    overlayControls.classList.add("dragging");
    overlayDragHandle.setPointerCapture(event.pointerId);
}

function onDragMove(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
    }

    positionOverlayControls(event.clientX - dragState.offsetX, event.clientY - dragState.offsetY);
}

function stopDragging(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
    }

    dragState = null;
    overlayControls.classList.remove("dragging");
    try {
        overlayDragHandle.releasePointerCapture(event.pointerId);
    } catch {
        // Ignore if capture is already released.
    }
}

function applyResponsiveGridLayout(itemCount) {
    if (!itemCount || itemCount < 1) {
        return;
    }

    const minTileWidth = 192;
    const mediaAspectRatio = 9 / 16;
    const computed = window.getComputedStyle(linksGrid);
    const columnGap = Number.parseFloat(computed.columnGap || computed.gap || "0") || 0;
    const rowGap = Number.parseFloat(computed.rowGap || computed.gap || "0") || 0;
    const paddingX = (Number.parseFloat(computed.paddingLeft) || 0) + (Number.parseFloat(computed.paddingRight) || 0);
    const paddingY = (Number.parseFloat(computed.paddingTop) || 0) + (Number.parseFloat(computed.paddingBottom) || 0);
    const availableWidth = Math.max(0, linksGrid.clientWidth - paddingX);
    const availableHeight = Math.max(0, linksGrid.clientHeight - paddingY);
    const sampleFooter = linksGrid.querySelector(".card-footer");
    const footerHeight = sampleFooter ? sampleFooter.getBoundingClientRect().height : 54;

    if (availableWidth <= 0 || availableHeight <= 0) {
        return;
    }

    let bestLayout = null;

    for (let cols = 1; cols <= itemCount; cols += 1) {
        const rows = Math.ceil(itemCount / cols);
        const tileWidth = (availableWidth - (columnGap * (cols - 1))) / cols;
        const tileHeight = (tileWidth * mediaAspectRatio) + footerHeight;
        const totalHeight = (rows * tileHeight) + (rowGap * (rows - 1));

        if (tileWidth < minTileWidth || !Number.isFinite(tileWidth) || totalHeight > availableHeight) {
            continue;
        }

        if (!bestLayout || tileWidth > bestLayout.tileWidth) {
            bestLayout = { cols, tileWidth };
        }
    }

    if (!bestLayout) {
        const maxColsAtMinWidth = Math.max(1, Math.floor((availableWidth + columnGap) / (minTileWidth + columnGap)));
        const cols = Math.min(itemCount, maxColsAtMinWidth);
        const tileWidth = (availableWidth - (columnGap * (cols - 1))) / cols;
        bestLayout = { cols, tileWidth: Math.max(minTileWidth, tileWidth) };
    }

    const tileHeight = (bestLayout.tileWidth * mediaAspectRatio) + footerHeight;
    linksGrid.style.gridTemplateColumns = `repeat(${bestLayout.cols}, minmax(0, 1fr))`;
    linksGrid.style.gridAutoRows = `${tileHeight}px`;
}

let responsiveLayoutRaf = 0;

function scheduleResponsiveGridLayout(itemCount) {
    if (responsiveLayoutRaf) {
        window.cancelAnimationFrame(responsiveLayoutRaf);
    }

    responsiveLayoutRaf = window.requestAnimationFrame(() => {
        responsiveLayoutRaf = 0;
        applyResponsiveGridLayout(itemCount);
    });
}

function renderCards() {
    if (!Array.isArray(links) || links.length === 0) {
        linksGrid.innerHTML = '<p class="empty">No links found. Edit list.js to add entries.</p>';
        return;
    }

    const fragment = document.createDocumentFragment();

    links.forEach((item) => {
        const card = document.createElement("article");
        card.className = "card";
        card.tabIndex = 0;

        const mediaShell = document.createElement("div");
        mediaShell.className = "card-media-shell";

        const image = document.createElement("img");
        image.className = "card-media";
        image.src = defaultPreviewDataUrl;
        image.alt = `${item.title} preview`;
        image.loading = "lazy";
        mediaShell.appendChild(image);

        if (item.live) {
            const liveFrame = document.createElement("iframe");
            liveFrame.className = "card-live-media";
            liveFrame.title = `${item.title} live preview`;
            liveFrame.loading = "lazy";
            liveFrame.tabIndex = -1;
            liveFrame.setAttribute("aria-hidden", "true");

            const liveShield = document.createElement("div");
            liveShield.className = "card-live-shield";
            liveShield.setAttribute("aria-hidden", "true");

            mediaShell.append(liveFrame, liveShield);
            hydrateLivePreview(item, mediaShell, liveFrame, image);
        } else {
            hydratePreview(item, image);
        }

        const footer = document.createElement("footer");
        footer.className = "card-footer";

        const footerTitleRow = document.createElement("div");
        footerTitleRow.className = "card-footer-title-row";

        const favicon = document.createElement("img");
        favicon.className = "card-favicon";
        favicon.alt = "";
        favicon.setAttribute("aria-hidden", "true");
        favicon.addEventListener("error", () => {
            favicon.classList.remove("visible");
        });

        const footerTitle = document.createElement("h2");
        footerTitle.className = "card-footer-title";
        footerTitle.textContent = item.title;

        footerTitleRow.append(favicon, footerTitle);
        footer.append(footerTitleRow);
        card.append(mediaShell, footer);

        card.addEventListener("click", () => openOverlay(item, image, card));
        card.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openOverlay(item, image, card);
            }
        });

        fragment.appendChild(card);
        hydrateFavicon(item, favicon);
    });

    linksGrid.replaceChildren(fragment);
    scheduleResponsiveGridLayout(links.length);
}

closeOverlayButton.addEventListener("click", closeOverlay);

window.addEventListener("popstate", () => {
    if (overlay.classList.contains("open")) {
        closeOverlay({ fromHistory: true });
    } else {
        overlayHistoryActive = false;
    }
});

overlayFrame.addEventListener("load", () => {
    try {
        const frameWindow = overlayFrame.contentWindow;
        if (!frameWindow) {
            return;
        }

        if (!frameWindow.history.state?.overlayPreviewRoot) {
            frameWindow.history.pushState({ overlayPreviewRoot: true }, "", frameWindow.location.href);
        }

        frameWindow.onpopstate = () => {
            if (overlay.classList.contains("open")) {
                closeOverlay({ fromHistory: true });
            }
        };
    } catch {
        // Ignore cross-origin preview restrictions.
    }
});

openInTabButton.addEventListener("click", () => {
    if (selectedPath) {
        window.open(selectedPath, "_blank", "noopener,noreferrer");
    }
});

openGithubButton.addEventListener("click", () => {
    if (selectedGithubUrl) {
        window.open(selectedGithubUrl, "_blank", "noopener,noreferrer");
    }
});

overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
        closeOverlay();
    }
});

window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeOverlay();
    }
});

overlayDragHandle.addEventListener("pointerdown", startDragging);
overlayDragHandle.addEventListener("pointermove", onDragMove);
overlayDragHandle.addEventListener("pointerup", stopDragging);
overlayDragHandle.addEventListener("pointercancel", stopDragging);

window.addEventListener("pointermove", onDragMove);
window.addEventListener("pointerup", stopDragging);
window.addEventListener("resize", () => {
    if (overlay.classList.contains("open") && overlayControls.style.left) {
        const rect = overlayControls.getBoundingClientRect();
        positionOverlayControls(rect.left, rect.top);
    }

    scheduleResponsiveGridLayout(links.length);
});

closeOverlay();

renderCards();
