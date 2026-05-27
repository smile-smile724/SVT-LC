import { EventEmitter } from 'node:events';
import type { EdgeInvalidationEvent } from '@mtweb/shared-contracts';

const CHANNEL = 'mtweb:edge:invalidation';

export class InvalidationBus {
  private readonly emitter = new EventEmitter();
  private readonly history: EdgeInvalidationEvent[] = [];
  private readonly maxHistory = 100;

  publish(event: EdgeInvalidationEvent): void {
    this.history.push(event);
    if (this.history.length > this.maxHistory) this.history.shift();
    this.emitter.emit(CHANNEL, event);
  }

  subscribe(listener: (event: EdgeInvalidationEvent) => void): () => void {
    this.emitter.on(CHANNEL, listener);
    return () => this.emitter.off(CHANNEL, listener);
  }

  recent(limit = 20): EdgeInvalidationEvent[] {
    return this.history.slice(-limit);
  }
}
