#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
LIST_FILE="$REPO_ROOT/list.js"
SITES_DIR="$REPO_ROOT/sites"

SOURCE_PARENT="../"
DRY_RUN=0
FORCE=0
USE_JQ=0

print_usage() {
    cat <<'EOF'
Usage: sh scripts/update-symlinks.sh [options]

Creates root-level symlinks in sites/ from list.js URLs.
Nested URL paths use only the first path segment.

Options:
  --parent <path>  Source parent directory (relative to repo root or absolute). Default: ../
  --dry-run        Print actions only.
  --force          Replace existing non-symlink destinations in sites/.
  --use-jq         Use jq-based extraction (optional). jq-free parser is the default.
  -h, --help       Show this help message.
EOF
}

log_info() {
    printf '%s\n' "$*"
}

log_warn() {
    printf 'WARN: %s\n' "$*" >&2
}

run_cmd() {
    if [ "$DRY_RUN" -eq 1 ]; then
        printf 'DRY-RUN: %s\n' "$*"
        return 0
    fi

    "$@"
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --parent)
            if [ "$#" -lt 2 ]; then
                log_warn "Missing value for --parent"
                exit 1
            fi
            SOURCE_PARENT="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=1
            shift
            ;;
        --force)
            FORCE=1
            shift
            ;;
        --use-jq)
            USE_JQ=1
            shift
            ;;
        -h|--help)
            print_usage
            exit 0
            ;;
        *)
            log_warn "Unknown option: $1"
            print_usage
            exit 1
            ;;
    esac
done

if [ ! -f "$LIST_FILE" ]; then
    log_warn "Missing list file: $LIST_FILE"
    exit 1
fi

if [ "$DRY_RUN" -eq 0 ]; then
    mkdir -p "$SITES_DIR"
else
    log_info "DRY-RUN: mkdir -p $SITES_DIR"
fi

if [ "${SOURCE_PARENT#/}" != "$SOURCE_PARENT" ]; then
    SOURCE_PARENT_ABS="$SOURCE_PARENT"
else
    SOURCE_PARENT_ABS=$(CDPATH= cd -- "$REPO_ROOT/$SOURCE_PARENT" 2>/dev/null && pwd) || {
        log_warn "Cannot resolve source parent: $SOURCE_PARENT"
        exit 1
    }
fi

extract_segments_without_jq() {
    sed -nE 's/.*url:[[:space:]]*"([^"]+)".*/\1/p' "$LIST_FILE" | awk '
        {
            url = $0
            gsub(/^\/+|\/+$/, "", url)
            if (url == "") {
                next
            }

            split(url, parts, "/")
            segment = parts[1]
            if (segment != "" && !seen[segment]++) {
                print segment
            }
        }
    '
}

extract_segments_with_jq() {
    sed -nE 's/.*url:[[:space:]]*"([^"]+)".*/\1/p' "$LIST_FILE" | jq -R -s '
        split("\n")
        | map(select(length > 0)
            | gsub("^/+"; "")
            | gsub("/+$"; "")
            | split("/")[0])
        | map(select(length > 0))
        | unique
        | .[]
    '
}

if [ "$USE_JQ" -eq 1 ]; then
    if ! command -v jq >/dev/null 2>&1; then
        log_warn "--use-jq was set but jq is not installed"
        exit 1
    fi

    SEGMENTS=$(extract_segments_with_jq)
else
    SEGMENTS=$(extract_segments_without_jq)
fi

if [ -z "$SEGMENTS" ]; then
    log_warn "No URL segments found in $LIST_FILE"
    exit 1
fi

created=0
updated=0
unchanged=0
missing=0
skipped=0

segments_file=$(mktemp)
trap 'rm -f "$segments_file"' EXIT HUP INT TERM
printf '%s\n' "$SEGMENTS" > "$segments_file"

while IFS= read -r segment; do
    [ -n "$segment" ] || continue

    src="$SOURCE_PARENT_ABS/$segment"
    dest="$SITES_DIR/$segment"

    if [ ! -d "$src" ]; then
        log_warn "Missing source directory: $src"
        missing=$((missing + 1))
        continue
    fi

    if [ -L "$dest" ]; then
        current_target=$(readlink "$dest" || true)
        if [ "$current_target" = "$src" ]; then
            log_info "UNCHANGED $dest -> $src"
            unchanged=$((unchanged + 1))
            continue
        fi

        run_cmd ln -sfn "$src" "$dest"
        log_info "UPDATED   $dest -> $src"
        updated=$((updated + 1))
        continue
    fi

    if [ -e "$dest" ]; then
        if [ "$FORCE" -eq 1 ]; then
            run_cmd rm -rf "$dest"
            run_cmd ln -s "$src" "$dest"
            log_info "REPLACED  $dest -> $src"
            updated=$((updated + 1))
        else
            log_warn "Destination exists and is not a symlink: $dest (use --force to replace)"
            skipped=$((skipped + 1))
        fi

        continue
    fi

    run_cmd ln -s "$src" "$dest"
    log_info "CREATED   $dest -> $src"
    created=$((created + 1))
done < "$segments_file"

log_info "Summary: created=$created updated=$updated unchanged=$unchanged missing=$missing skipped=$skipped"
