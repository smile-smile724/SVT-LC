import type { DeliveryMode, EdgeCacheHint, LayerName } from '@mtweb/shared-contracts';

const MODE_BASE_TTL: Record<DeliveryMode, number> = { SF: 300, EE: 180, FR: 120 };

const LAYER_TTL_MULTIPLIER: Record<LayerName, number> = {
  sem: 2.0,
  coarse: 1.0,
  residual: 0.6
};

export function resolveTtl(mode: DeliveryMode, layer: LayerName, hitRate: number): number {
  const base = MODE_BASE_TTL[mode] * LAYER_TTL_MULTIPLIER[layer];
  const hitBonus = 1 + Math.max(0, Math.min(1, hitRate));
  return Math.round(base * hitBonus);
}

export interface PolicyOutcome {
  shouldStore: boolean;
  shouldEvict: boolean;
  ttlSeconds: number;
}

export function applyHint(
  hint: EdgeCacheHint,
  mode: DeliveryMode,
  layer: LayerName,
  hitRate: number
): PolicyOutcome {
  const ttl = resolveTtl(mode, layer, hitRate);
  switch (hint) {
    case 'promote':
      return { shouldStore: true, shouldEvict: false, ttlSeconds: ttl };
    case 'retain':
      return { shouldStore: true, shouldEvict: false, ttlSeconds: Math.round(ttl * 0.75) };
    case 'allow-evict':
      return { shouldStore: false, shouldEvict: true, ttlSeconds: Math.round(ttl * 0.5) };
  }
}
