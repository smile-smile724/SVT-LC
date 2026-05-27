import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type {
  DeliveryMode,
  EdgeCacheHint,
  EdgeInvalidationEvent,
  EdgeInvalidationReason,
  LayerName
} from '@mtweb/shared-contracts';
import { CacheStore } from './cache-store.js';
import { applyHint } from './cache-policy.js';
import { buildCacheKey, buildObjectUri } from './object-layout.js';
import { InvalidationBus } from './redis-events.js';

const port = Number(process.env.PORT ?? 8789);
const store = new CacheStore();
const bus = new InvalidationBus();

bus.subscribe((event) => {
  console.log(`[edge-service] invalidation ${event.sceneId}/${event.blockId ?? '*'}/${event.layer ?? '*'} reason=${event.reason}`);
});

interface PromoteRequestBody {
  sceneId: string;
  blockId: string;
  layer: LayerName;
  version?: string;
  bytes: number;
  hint: EdgeCacheHint;
  mode: DeliveryMode;
  edgeHitRate?: number;
}

interface InvalidateRequestBody {
  sceneId: string;
  blockId?: string;
  layer?: LayerName;
  version?: string;
  reason?: EdgeInvalidationReason;
}

interface MetadataUpdateBody {
  sceneId: string;
  blockId: string;
  layer: LayerName;
  version?: string;
  ttlSeconds?: number;
  hint?: EdgeCacheHint;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload, null, 2));
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(raw) as T);
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

const server = createServer(async (request, response) => {
  try {
    const url = request.url ?? '/';

    if (request.method === 'GET' && url === '/health') {
      sendJson(response, 200, {
        ok: true,
        service: 'edge-service',
        cachedEntries: store.list().length,
        hotBlocks: store.topHotBlocks(5),
        recentInvalidations: bus.recent(5).length
      });
      return;
    }

    if (request.method === 'GET' && url === '/cache') {
      sendJson(response, 200, { entries: store.list() });
      return;
    }

    if (request.method === 'GET' && url.startsWith('/cache/')) {
      const key = decodeURIComponent(url.slice('/cache/'.length));
      const entry = store.get(key);
      if (!entry) {
        sendJson(response, 404, { ok: false, error: 'cache_miss', key });
        return;
      }
      sendJson(response, 200, { entry, objectUri: buildObjectUri(entry) });
      return;
    }

    if (request.method === 'POST' && url === '/cache/promote') {
      const body = await readJsonBody<PromoteRequestBody>(request);
      const outcome = applyHint(body.hint, body.mode, body.layer, body.edgeHitRate ?? 0);
      const entry = store.promote({
        sceneId: body.sceneId,
        blockId: body.blockId,
        layer: body.layer,
        version: body.version,
        bytes: body.bytes,
        hint: body.hint,
        ttlSeconds: outcome.ttlSeconds
      });
      sendJson(response, 200, { entry, outcome });
      return;
    }

    if (request.method === 'POST' && url === '/cache/invalidate') {
      const body = await readJsonBody<InvalidateRequestBody>(request);
      const removed = store.invalidate({
        sceneId: body.sceneId,
        blockId: body.blockId,
        layer: body.layer
      });
      const event: EdgeInvalidationEvent = {
        sceneId: body.sceneId,
        blockId: body.blockId ?? '*',
        layer: body.layer,
        version: body.version,
        reason: body.reason ?? 'manual',
        emittedAt: new Date().toISOString()
      };
      bus.publish(event);
      sendJson(response, 200, { removedKeys: removed, event });
      return;
    }

    if (request.method === 'POST' && url === '/metadata/update') {
      const body = await readJsonBody<MetadataUpdateBody>(request);
      const key = buildCacheKey({
        sceneId: body.sceneId,
        blockId: body.blockId,
        layer: body.layer,
        version: body.version
      });
      const existing = store.get(key);
      if (!existing) {
        sendJson(response, 404, { ok: false, error: 'cache_miss', key });
        return;
      }
      const updated = store.promote({
        sceneId: existing.sceneId,
        blockId: existing.blockId,
        layer: existing.layer,
        version: existing.version,
        bytes: existing.bytes,
        hint: body.hint ?? existing.hint,
        ttlSeconds: body.ttlSeconds ?? existing.ttlSeconds
      });
      sendJson(response, 200, { entry: updated });
      return;
    }

    if (request.method === 'GET' && url === '/hot-blocks') {
      sendJson(response, 200, { hotBlocks: store.topHotBlocks(10) });
      return;
    }

    if (request.method === 'GET' && url === '/invalidations/recent') {
      sendJson(response, 200, { events: bus.recent(20) });
      return;
    }

    sendJson(response, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    sendJson(response, 400, {
      ok: false,
      error: 'bad_request',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

server.listen(port, () => {
  console.log(`[edge-service] listening on http://localhost:${port}`);
});
