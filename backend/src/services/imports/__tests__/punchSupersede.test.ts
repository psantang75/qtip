import { describe, expect, it } from 'vitest';
import { supersedeWindows, type KeptPunch } from '../punchSupersede';

const at = (y: number, m: number, d: number, hh = 10, mm = 0) => new Date(y, m - 1, d, hh, mm);

describe('supersedeWindows', () => {
  it('spans a person from their earliest punch-in day through the day after their latest', () => {
    const punches: KeptPunch[] = [
      { userId: 31, postId: '294315', punchInAt: at(2026, 9, 22, 10, 32) },
      { userId: 31, postId: '294084', punchInAt: at(2026, 9, 21, 8, 30) },
    ];
    const [w] = supersedeWindows(punches);
    expect(w.userId).toBe(31);
    expect(w.from).toEqual(at(2026, 9, 21, 0, 0));
    expect(w.to).toEqual(at(2026, 9, 23, 0, 0));
    expect(w.keepPostIds).toEqual(['294315', '294084']);
  });

  it('keeps a post id that has no punch-in without widening the window', () => {
    const [w] = supersedeWindows([
      { userId: 31, postId: 'open', punchInAt: null },
      { userId: 31, postId: '294321', punchInAt: at(2026, 9, 22, 14, 37) },
    ]);
    expect(w.from).toEqual(at(2026, 9, 22, 0, 0));
    expect(w.to).toEqual(at(2026, 9, 23, 0, 0));
    expect(w.keepPostIds).toEqual(['open', '294321']);
  });

  it('does not build a window for a person whose rows have no punch-in', () => {
    expect(supersedeWindows([{ userId: 4, postId: 'x', punchInAt: null }])).toEqual([]);
  });

  it('keeps each person on their own window', () => {
    const windows = supersedeWindows([
      { userId: 31, postId: 'a', punchInAt: at(2026, 9, 22) },
      { userId: 8, postId: 'b', punchInAt: at(2026, 9, 18) },
    ]);
    expect(windows.map(w => w.userId).sort((a, b) => a - b)).toEqual([8, 31]);
    expect(windows.find(w => w.userId === 8)?.keepPostIds).toEqual(['b']);
  });
});
