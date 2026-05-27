import { createServer } from 'node:http';
import path from 'node:path';
import type { ScheduleRequest } from '@mtweb/shared-contracts';
import { buildScheduleResponse } from './scoring.js';
import { DEFAULT_PROFILE, loadScheduleProfile, type ScheduleProfile } from './profile.js';
import { enrichRequestWithRealTelemetry, promoteToEdgeCache } from './integration.js';

const port = Number(process.env.PORT ?? 8787);
const profilePathEnv = process.env.SCHEDULE_PROFILE_PATH;
const resolvedProfilePath = profilePathEnv ? path.resolve(process.cwd(), profilePathEnv) : undefined;

let activeProfile: ScheduleProfile = DEFAULT_PROFILE;

function sendJson(response: import('node:http').ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS'
  });
  response.end(JSON.stringify(payload, null, 2));
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS'
    });
    response.end();
    return;
  }

  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, {
      ok: true,
      service: 'scheduler-service',
      profile: { sceneId: activeProfile.sceneId, defaults: activeProfile.defaults }
    });
    return;
  }

  if (request.method === 'GET' && request.url === '/profile') {
    sendJson(response, 200, activeProfile);
    return;
  }

  if (request.method === 'POST' && request.url === '/schedule') {
    let rawBody = '';

    request.on('data', (chunk) => {
      rawBody += chunk;
    });

    request.on('end', async () => {
      try {
        const parsed = JSON.parse(rawBody) as ScheduleRequest;
        await enrichRequestWithRealTelemetry(parsed);
        const result = buildScheduleResponse(parsed, activeProfile);
        promoteToEdgeCache(result.items, parsed);
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 400, {
          ok: false,
          error: 'invalid_schedule_request',
          detail: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    return;
  }

  sendJson(response, 404, { ok: false, error: 'not_found' });
});

async function bootstrap(): Promise<void> {
  activeProfile = await loadScheduleProfile(resolvedProfilePath);

  server.once('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.warn(`[scheduler-service] port ${port} is already in use; another scheduler instance is probably running.`);
      process.exit(0);
      return;
    }

    console.error('[scheduler-service] server error', error);
    process.exit(1);
  });

  server.listen(port, () => {
    const source = resolvedProfilePath ?? '<built-in default>';
    console.log(`[scheduler-service] listening on http://localhost:${port}`);
    console.log(`[scheduler-service] profile source: ${source}`);
    console.log(`[scheduler-service] biases SF=${activeProfile.defaults.SF} EE=${activeProfile.defaults.EE} FR=${activeProfile.defaults.FR}`);
  });
}

bootstrap().catch((error: unknown) => {
  console.error('[scheduler-service] fatal startup error', error);
  process.exit(1);
});
