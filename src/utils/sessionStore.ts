import LRUCache from "lru-cache";

const SESSION_TTL_MS = 23 * 60 * 60 * 1000;
const MAX_SESSIONS = 10_000;

export default class SessionStore {
  private readonly cache = new LRUCache<number, string>({
    max: MAX_SESSIONS,
    ttl: SESSION_TTL_MS,
  });

  get(telegramId: number): string | undefined {
    return this.cache.get(telegramId);
  }

  set(telegramId: number, token: string): void {
    this.cache.set(telegramId, token);
  }

  delete(telegramId: number): void {
    this.cache.delete(telegramId);
  }
}
