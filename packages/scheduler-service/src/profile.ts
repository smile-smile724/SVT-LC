import { readFile } from 'node:fs/promises';
import type { DeliveryMode } from '@mtweb/shared-contracts';

export interface ScheduleProfile {
  sceneId?: string;
  defaults: Record<DeliveryMode, number>;
  ttlSeconds: Record<DeliveryMode, number>;
  byteBudget: number;
  latencyBudgetMs: number;
  bandwidthCeilingMbps: number;
}

export const DEFAULT_PROFILE: ScheduleProfile = {
  defaults: { SF: 0.65, EE: 0.55, FR: 0.45 },
  ttlSeconds: { SF: 300, EE: 180, FR: 120 },
  byteBudget: 50_000_000,
  latencyBudgetMs: 2000,
  bandwidthCeilingMbps: 800
};

export async function loadScheduleProfile(profilePath?: string): Promise<ScheduleProfile> {
  if (!profilePath) return DEFAULT_PROFILE;
  const raw = await readFile(profilePath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<{
    sceneId: string;
    defaults: Partial<Record<DeliveryMode, number>> & {
      sfBias?: number;
      eeBias?: number;
      frBias?: number;
    };
    ttlSeconds: Partial<Record<DeliveryMode, number>>;
    byteBudget: number;
    latencyBudgetMs: number;
    bandwidthCeilingMbps: number;
  }>;

  const legacyDefaults: Partial<Record<DeliveryMode, number>> = {};
  if (parsed.defaults) {
    if (typeof parsed.defaults.sfBias === 'number') legacyDefaults.SF = parsed.defaults.sfBias;
    if (typeof parsed.defaults.eeBias === 'number') legacyDefaults.EE = parsed.defaults.eeBias;
    if (typeof parsed.defaults.frBias === 'number') legacyDefaults.FR = parsed.defaults.frBias;
  }

  return {
    sceneId: parsed.sceneId,
    defaults: {
      ...DEFAULT_PROFILE.defaults,
      ...legacyDefaults,
      SF: parsed.defaults?.SF ?? legacyDefaults.SF ?? DEFAULT_PROFILE.defaults.SF,
      EE: parsed.defaults?.EE ?? legacyDefaults.EE ?? DEFAULT_PROFILE.defaults.EE,
      FR: parsed.defaults?.FR ?? legacyDefaults.FR ?? DEFAULT_PROFILE.defaults.FR
    },
    ttlSeconds: { ...DEFAULT_PROFILE.ttlSeconds, ...(parsed.ttlSeconds ?? {}) },
    byteBudget: parsed.byteBudget ?? DEFAULT_PROFILE.byteBudget,
    latencyBudgetMs: parsed.latencyBudgetMs ?? DEFAULT_PROFILE.latencyBudgetMs,
    bandwidthCeilingMbps: parsed.bandwidthCeilingMbps ?? DEFAULT_PROFILE.bandwidthCeilingMbps
  };
}
