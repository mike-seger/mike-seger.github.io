# mike-seger.github.io

https://mike-seger.github.io/

## Link List

The home page now renders entries from `list.js`.

Each entry has this shape:

```js
{ title: "Project Name", url: "project-path/" }
```

Optional override for the overlay GitHub button:

```js
{ title: "Project Name", url: "project-path/", github: "https://github.com/org/repo" }
```

On `github.io`, links resolve directly from the root URL (`<url>/`) so GitHub Pages works out of the box.

On other hosts (local dev), links are resolved adaptively:

1. Try the real site path from root (`<url>/`)
2. Fallback to `sites/<url>/` if root is not available

For this entry:

```js
{ title: "Grid Experiments", url: "grid-experiments/" }
```

the first attempted path is `grid-experiments/`, then `sites/grid-experiments/`.

## Runtime Previews

Cards now use a built-in default placeholder image immediately.

The card grid shows only project names and previews.

When a card is selected, the overlay includes:

1. Open in a tab
2. Open github
3. Close

If `github` is not provided in `list.js`, the GitHub URL is inferred as `https://github.com/mike-seger/<first-url-segment>`.

After rendering, the page attempts to capture a live thumbnail from each destination page at runtime and stores it in browser user data (`localStorage`) for reuse.

Notes:

1. This capture is best-effort and works most reliably for same-origin pages.
2. If runtime capture fails (security restrictions, storage quota, render failure), the default placeholder remains.
3. Cached thumbnails can be cleared by clearing browser site data.

## Optional Script

The portable script at `scripts/generate-previews.mjs` is still available if you want pre-generated static images for a deployment workflow.

## Sites Loader Pages

To ensure `/sites/...` URLs are always directly servable by static servers like VS Code Live Server, generate concrete loader pages (instead of symlinked `index.html` files):

```bash
node scripts/generate-sites-loaders.mjs
```

This script reads `list.js` and creates/updates `sites/<url>/index.html` for every entry.

## Real Site Symlinks

To mount real project folders into `sites/` for local development, run:

```bash
sh scripts/update-symlinks.sh
```

Default behavior:

1. Reads URLs from `list.js`.
2. Uses only the first URL segment for each mount.
3. Creates symlinks as `sites/<segment> -> <repo-root>/../<segment>`.

Nested URL examples:

1. `polaris-player-2/public/` mounts only `sites/polaris-player-2`
2. `saron-compound-public/src/main/resources/static/` mounts only `sites/saron-compound-public`

Useful options:

```bash
# Preview actions without changing files
sh scripts/update-symlinks.sh --dry-run

# Replace existing non-symlink destinations in sites/
sh scripts/update-symlinks.sh --force

# Use a different source parent root
sh scripts/update-symlinks.sh --parent ../../

# Optional jq extraction mode
sh scripts/update-symlinks.sh --use-jq
```
