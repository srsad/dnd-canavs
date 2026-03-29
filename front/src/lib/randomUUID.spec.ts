import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from './randomUUID';

/** RFC 4122 version 4 + variant bits in the two reserved positions. */
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('randomUUID', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('возвращает строку длины 36 в формате UUID v4', () => {
    const id = randomUUID();
    expect(id).toHaveLength(36);
    expect(id).toMatch(UUID_V4);
  });

  it('даёт разные значения при повторных вызовах', () => {
    const set = new Set(Array.from({ length: 200 }, () => randomUUID()));
    expect(set.size).toBe(200);
  });

  it('при отсутствии randomUUID строит v4 через getRandomValues', () => {
    vi.stubGlobal('crypto', {
      getRandomValues(arr: Uint8Array) {
        arr.fill(0xff);
        return arr;
      },
    });

    expect(randomUUID()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });

  it('при полном отсутствии crypto использует запасной путь (Math.random)', () => {
    vi.stubGlobal('crypto', undefined as unknown as Crypto);
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const id = randomUUID();
    expect(id).toMatch(UUID_V4);
    expect(id).toBe('00000000-0000-4000-8000-000000000000');
  });
});
