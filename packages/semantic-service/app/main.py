from fastapi import FastAPI

from app.config import (
    CLIP_MODEL, DEVICE, GDINO_CHECKPOINT, SAM2_CHECKPOINT, USE_REAL_MODELS,
)
from app.schemas import SemanticExtractionRequest
from app.services import extract_semantics, get_pipeline

app = FastAPI(title="mtweb-semantic-service", version="0.1.0")


@app.on_event("startup")
def _startup() -> None:
    mode = "REAL" if USE_REAL_MODELS else "STUB"
    print(f"[semantic-service] mode={mode} device={DEVICE}")
    if USE_REAL_MODELS:
        print(f"  GroundingDINO checkpoint : {GDINO_CHECKPOINT}")
        print(f"  SAM 2 checkpoint         : {SAM2_CHECKPOINT}")
        print(f"  CLIP model               : {CLIP_MODEL}")
    # Warm up the pipeline so the first request isn't slow
    get_pipeline()
    print("[semantic-service] pipeline ready")


@app.get("/health")
def health() -> dict:
    from app.config import GDINO_CHECKPOINT, SAM2_CHECKPOINT
    return {
        "ok": True,
        "service": "semantic-service",
        "mode": "real" if USE_REAL_MODELS else "stub",
        "device": DEVICE,
        "gdino_checkpoint": str(GDINO_CHECKPOINT) if USE_REAL_MODELS else None,
        "sam2_checkpoint": str(SAM2_CHECKPOINT) if USE_REAL_MODELS else None,
        "clip_model": CLIP_MODEL if USE_REAL_MODELS else None,
    }


@app.post("/semantics/extract")
def extract(request: SemanticExtractionRequest):
    return extract_semantics(request)
