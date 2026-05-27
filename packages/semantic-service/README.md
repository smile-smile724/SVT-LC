# semantic-service

This package is the Python-side semantic pipeline scaffold.

## Current State

- FastAPI service skeleton
- `/health` endpoint
- `/semantics/extract` endpoint with placeholder output

## Planned Integration

1. Render 4-8 canonical block views during preprocess.
2. Run GroundingDINO on each view for candidate detections.
3. Use SAM 2 to refine detections into masks and saliency regions.
4. Use CLIP to rerank labels and produce `semantic_score`.
5. Serialize results into `sem.json`.
