"""Model weight paths and runtime settings, resolved from environment variables.

Set USE_REAL_MODELS=1 to switch from stub clients to real GroundingDINO/SAM2/CLIP.
All paths default to the local references/ checkpoints so the service works
out-of-the-box without any extra configuration.
"""

import os
from pathlib import Path

# Project root: e:/s/Desktop/MTweb
_REPO_ROOT = Path(__file__).resolve().parents[4]
_SEMANTIC_REF = _REPO_ROOT / "references" / "open_source_projects" / "semantic"
_SAM2_CKPT_DIR = _SEMANTIC_REF / "sam2" / "checkpoints"
_GDINO_DIR = _SEMANTIC_REF / "GroundingDINO"

# ── GroundingDINO ──────────────────────────────────────────────────────────────
GDINO_CONFIG = Path(
    os.environ.get(
        "GDINO_CONFIG",
        str(_GDINO_DIR / "groundingdino" / "config" / "GroundingDINO_SwinT_OGC.py"),
    )
)
GDINO_CHECKPOINT = Path(
    os.environ.get(
        "GDINO_CHECKPOINT",
        str(_GDINO_DIR / "groundingdino_swint_ogc.pth"),
    )
)
GDINO_BOX_THRESHOLD: float = float(os.environ.get("GDINO_BOX_THRESHOLD", "0.35"))
GDINO_TEXT_THRESHOLD: float = float(os.environ.get("GDINO_TEXT_THRESHOLD", "0.25"))

# ── SAM 2 ──────────────────────────────────────────────────────────────────────
# Default: large model for best quality; set SAM2_CHECKPOINT to tiny for speed.
SAM2_CHECKPOINT = Path(
    os.environ.get(
        "SAM2_CHECKPOINT",
        str(_SAM2_CKPT_DIR / "sam2.1_hiera_large.pt"),
    )
)
# SAM 2 config name must match the checkpoint variant (tiny/small/base_plus/large).
SAM2_CONFIG = os.environ.get("SAM2_CONFIG", "configs/sam2.1/sam2.1_hiera_l")

# ── CLIP ───────────────────────────────────────────────────────────────────────
CLIP_MODEL = os.environ.get("CLIP_MODEL", "ViT-B/32")
# Hugging Face cache dir for CLIP weights (~/.cache/clip by default).
CLIP_CACHE_DIR: str | None = os.environ.get("CLIP_CACHE_DIR", None)

# ── Runtime ────────────────────────────────────────────────────────────────────
USE_REAL_MODELS: bool = os.environ.get("USE_REAL_MODELS", "0") == "1"
DEVICE: str = os.environ.get("DEVICE", "cuda")
