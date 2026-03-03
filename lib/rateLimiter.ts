/**
 * Простой in-memory rate limiter.
 * Не персистентный — при перезапуске сервера счётчики сбрасываются.
 * Для production с несколькими процессами лучше использовать Redis.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number; // timestamp ms
}

const store = new Map<string, RateLimitEntry>();

// Очищаем устаревшие записи каждые 5 минут, чтобы не утекала память
if (typeof setInterval !== "undefined") {
  setInterval(
    () => {
      const now = Date.now();
      for (const [key, entry] of store.entries()) {
        if (now > entry.resetAt) store.delete(key);
      }
    },
    5 * 60 * 1000,
  );
}

/**
 * Проверяет лимит. Возвращает `true` если запрос разрешён, `false` если превышен.
 * @param key      уникальный ключ (напр. ip+':login')
 * @param max      максимум запросов за окно
 * @param windowMs длина окна в миллисекундах
 */
export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= max) return false;

  entry.count++;
  return true;
}

/** Сколько секунд осталось до сброса лимита */
export function getRetryAfter(key: string): number {
  const entry = store.get(key);
  if (!entry) return 0;
  return Math.max(0, Math.ceil((entry.resetAt - Date.now()) / 1000));
}
