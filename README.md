# mtweb-system

`mtweb-system` is the primary workspace for implementing the Semantic-MT-Web3D paper ideas.

## Workspace Layout

- `packages/shared-contracts`: shared schemas and TypeScript contracts.
- `packages/preprocess`: scene partitioning and offline asset pipeline.
- `packages/web-client`: browser runtime built on three.js.
- `packages/scheduler-service`: latency-aware scheduling service.
- `packages/semantic-service`: Python service for semantic prototype extraction.
- `packages/edge-service`: notes and placeholders for edge cache integration.
- `scenes/raw`: source scenes.
- `scenes/processed`: generated block assets.
- `scenes/manifests`: scene-level manifests.

## First Start

```bash
cd /path/to/mtweb-system
npm install
```

### Run the web client

```bash
npm run dev:web
```

### Run the scheduler service

```bash
npm run dev:scheduler
```

### Run the preprocess package

```bash
npm run dev:preprocess -- --config ./scenes/manifests/dev-config.json
```

## Semantic Service

The semantic service is a separate Python application:

```bash
cd /path/to/mtweb-system/packages/semantic-service
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn app.main:app --reload --port 8090
```

## Current Scope

This scaffold is intentionally MVP-oriented:

- Route A first: `glTF + custom blocks.json`.
- Browser-side `S-PLQ` queue scaffold is included.
- Scheduler scoring and `/schedule` endpoint scaffold are included.
- Semantic extraction is stubbed behind adapters so model integration can happen incrementally.
