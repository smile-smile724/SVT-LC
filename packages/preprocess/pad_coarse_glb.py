"""
Fix B (T3): pad_coarse_glb.py
==============================
Pads every coarse lod1.glb in the demo-scene from ~1.2 KB to TARGET_KB by
injecting a GLB-spec-compliant `extras._padding` string inside the JSON chunk,
then updates `bytes.coarse` in the scene manifest so queue-budget calculations
stay consistent.

Why this matters
----------------
At 0.05 Mbps (6.25 KB/s) a 1.2 KB coarse GLB transfers in ~0.19 s — barely
above the JS-overhead baseline (~0.20 s).  With 80 KB coarse blocks:

  0.05 Mbps  →  ~12.8 s   (visible in experiment)
  0.5  Mbps  →  ~1.28 s
  10   Mbps  →  ~64 ms
  100  Mbps  →  ~6 ms   (collapses to JS baseline)

This gives the 3.1 interaction-latency curve a clear monotone gradient across
all 8 bandwidth points.

GLB binary format (§3.6.2.4 of the glTF 2.0 spec)
---------------------------------------------------
Offset   Size  Field
     0      4  magic   = 0x46546C67 ("glTF")
     4      4  version = 2
     8      4  length  (total file size in bytes)
    12      4  chunk0Length
    16      4  chunk0Type  = 0x4E4F534A ("JSON")
    20   ...   chunk0Data  (padded to 4-byte boundary with 0x20 / space)
  next      4  chunk1Length  (optional)
  next      4  chunk1Type  = 0x004E4942 ("BIN\0")
  next   ...   chunk1Data  (padded to 4-byte boundary with 0x00)

We parse the JSON chunk, add/replace `extras._padding`, re-encode, pad the
chunk to 4-byte alignment, fix chunk0Length and the global length.  Any BIN
chunk (chunk1) is preserved verbatim.

Usage
-----
  python pad_coarse_glb.py [--target-kb 80] [--dry-run]

Options
-------
  --target-kb   Target size in KB for each coarse GLB (default: 80).
  --dry-run     Print what would happen without writing files.
  --restore     Restore originals from the *.orig backup files and quit.
"""

import argparse
import json
import struct
import shutil
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths (relative to this script's location)
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent
REPO_ROOT  = SCRIPT_DIR.parent.parent          # mtweb-system/
WEB_PUBLIC = REPO_ROOT / "packages" / "web-client" / "public" / "scenes" / "demo-scene"
MANIFEST   = WEB_PUBLIC / "manifest" / "blocks.json"

GLB_MAGIC   = b"glTF"
GLB_VERSION = 2
CHUNK_JSON  = 0x4E4F534A   # "JSON"
CHUNK_BIN   = 0x004E4942   # "BIN\0"

# ---------------------------------------------------------------------------
# GLB helpers
# ---------------------------------------------------------------------------

def _pad4(n: int) -> int:
    """Round up to the next multiple of 4."""
    return (n + 3) & ~3


def parse_glb(data: bytes) -> tuple[dict, bytes | None]:
    """Return (json_dict, bin_chunk_data_or_None)."""
    if data[:4] != GLB_MAGIC:
        raise ValueError("Not a valid GLB file (bad magic).")
    # version = struct.unpack_from("<I", data, 4)[0]  # always 2
    chunk0_len  = struct.unpack_from("<I", data, 12)[0]
    chunk0_type = struct.unpack_from("<I", data, 16)[0]
    if chunk0_type != CHUNK_JSON:
        raise ValueError(f"Expected JSON chunk (0x{CHUNK_JSON:08X}), got 0x{chunk0_type:08X}.")
    json_bytes = data[20 : 20 + chunk0_len]
    json_dict  = json.loads(json_bytes.rstrip(b" "))

    bin_data: bytes | None = None
    offset = 20 + chunk0_len
    if offset + 8 <= len(data):
        chunk1_len  = struct.unpack_from("<I", data, offset)[0]
        chunk1_type = struct.unpack_from("<I", data, offset + 4)[0]
        if chunk1_type == CHUNK_BIN:
            bin_data = data[offset + 8 : offset + 8 + chunk1_len]

    return json_dict, bin_data


def build_glb(json_dict: dict, bin_data: bytes | None) -> bytes:
    """Serialize back to GLB bytes."""
    json_raw  = json.dumps(json_dict, separators=(",", ":")).encode("utf-8")
    json_pad  = _pad4(len(json_raw))
    json_chunk = json_raw + b" " * (json_pad - len(json_raw))

    total = 12 + 8 + len(json_chunk)
    parts: list[bytes] = []

    if bin_data is not None:
        bin_pad   = _pad4(len(bin_data))
        bin_chunk = bin_data + b"\x00" * (bin_pad - len(bin_data))
        total    += 8 + len(bin_chunk)
        parts.append(struct.pack("<II", len(bin_chunk), CHUNK_BIN) + bin_chunk)

    header = (
        GLB_MAGIC
        + struct.pack("<II", GLB_VERSION, total)
        + struct.pack("<II", len(json_chunk), CHUNK_JSON)
        + json_chunk
    )
    return header + b"".join(parts)


# ---------------------------------------------------------------------------
# Padding logic
# ---------------------------------------------------------------------------

def pad_glb_to(data: bytes, target_bytes: int) -> bytes:
    """
    Return a GLB whose serialised size is >= target_bytes by injecting a
    `extras._padding` string into the JSON chunk.  If the file is already
    large enough it is returned unchanged.
    """
    json_dict, bin_data = parse_glb(data)

    # Measure current serialised size without any padding
    json_dict.setdefault("extras", {})
    json_dict["extras"].pop("_padding", None)          # remove stale padding
    baseline = build_glb(json_dict, bin_data)
    deficit   = target_bytes - len(baseline)

    if deficit <= 0:
        return baseline                                 # already big enough

    # A JSON string of N characters contributes N + 2 bytes (the quotes) to
    # the JSON payload, but we must also account for the key
    # `"_padding":"<value>"` overhead: key (~11 chars) + colon + comma ≈ 13.
    # We'll overshoot slightly and then trim (safe because we always re-measure).
    pad_str = "X" * max(0, deficit - 20)

    while True:
        json_dict["extras"]["_padding"] = pad_str
        candidate = build_glb(json_dict, bin_data)
        if len(candidate) >= target_bytes:
            return candidate
        pad_str += "X" * max(1, target_bytes - len(candidate))


# ---------------------------------------------------------------------------
# Manifest update
# ---------------------------------------------------------------------------

def update_manifest(manifest_path: Path, new_sizes: dict[str, int], dry_run: bool) -> None:
    """Update bytes.coarse for each blockId in the manifest."""
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    changed = False
    for block in manifest["blocks"]:
        bid = block["blockId"]
        if bid in new_sizes:
            old = block.get("bytes", {}).get("coarse", "?")
            block.setdefault("bytes", {})["coarse"] = new_sizes[bid]
            print(f"  manifest {bid}: bytes.coarse {old} → {new_sizes[bid]}")
            changed = True
    if changed and not dry_run:
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print(f"  [OK] manifest written: {manifest_path}")


# ---------------------------------------------------------------------------
# Restore helper
# ---------------------------------------------------------------------------

def restore_originals(scene_dir: Path) -> None:
    orig_files = sorted(scene_dir.rglob("*.glb.orig"))
    if not orig_files:
        print("No *.glb.orig backup files found — nothing to restore.")
        return
    for orig in orig_files:
        target = orig.with_suffix("")        # removes the trailing ".orig"
        shutil.copy2(orig, target)
        orig.unlink()
        print(f"  restored {target.relative_to(scene_dir)}")
    print(f"[DONE] Restored {len(orig_files)} file(s).")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--target-kb", type=int, default=80,
                        help="Target coarse GLB size in KB (default: 80)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print actions without writing files")
    parser.add_argument("--restore", action="store_true",
                        help="Restore original files from .orig backups and exit")
    args = parser.parse_args()

    if not WEB_PUBLIC.exists():
        print(f"[ERROR] Scene directory not found: {WEB_PUBLIC}", file=sys.stderr)
        sys.exit(1)

    if args.restore:
        restore_originals(WEB_PUBLIC)
        return

    target_bytes = args.target_kb * 1024
    print(f"Target size: {args.target_kb} KB ({target_bytes} bytes)")
    print(f"Scene dir:   {WEB_PUBLIC}")
    if args.dry_run:
        print("[DRY-RUN mode — no files will be written]\n")

    coarse_glbs = sorted(WEB_PUBLIC.glob("block_*/coarse/*.glb"))
    if not coarse_glbs:
        print(f"[ERROR] No coarse GLB files found under {WEB_PUBLIC}", file=sys.stderr)
        sys.exit(1)

    new_sizes: dict[str, int] = {}

    for glb_path in coarse_glbs:
        block_id = glb_path.parts[-3]            # e.g. "block_0001"
        orig_data = glb_path.read_bytes()
        orig_size = len(orig_data)

        try:
            padded = pad_glb_to(orig_data, target_bytes)
        except Exception as exc:
            print(f"  [SKIP] {glb_path.name}: {exc}")
            continue

        new_size = len(padded)
        delta    = new_size - orig_size
        print(f"  {block_id}/coarse/{glb_path.name}: "
              f"{orig_size:>7,} B → {new_size:>7,} B  (+{delta:,} B)")

        if not args.dry_run:
            # Back up the original (only once)
            backup = glb_path.with_suffix(".glb.orig")
            if not backup.exists():
                shutil.copy2(glb_path, backup)
            glb_path.write_bytes(padded)

        new_sizes[block_id] = new_size

    print()
    if new_sizes:
        update_manifest(MANIFEST, new_sizes, dry_run=args.dry_run)

    if not args.dry_run:
        print(f"\n[DONE] Padded {len(new_sizes)} coarse GLB(s) to >={args.target_kb} KB.")
        print("   Run with --restore to undo.")
    else:
        print(f"\n[DRY-RUN] Would pad {len(new_sizes)} file(s). Pass without --dry-run to apply.")


if __name__ == "__main__":
    main()
