/**
 * Unit tests for the KbIndexService internals — pure math + packing.
 * Doesn't touch BookStack, OpenAI, or MySQL, so it runs unconditionally
 * in the regular vitest sweep.
 *
 * Validates:
 *   1. Round-trip encoding (Float32 → bytes → Float32) is lossless.
 *   2. Cosine similarity ranking selects the most similar vector.
 */

import { describe, it, expect } from 'vitest';

// Re-implement the helpers locally so we exercise the same pack/unpack
// logic without exposing them from the production module. The implementation
// here MUST stay in lockstep with KbIndexService.ts — if you change one,
// change the other.

function packFloat32(arr: Float32Array): Uint8Array {
  const ab = new ArrayBuffer(arr.length * 4);
  const view = new DataView(ab);
  for (let i = 0; i < arr.length; i++) view.setFloat32(i * 4, arr[i], true);
  return new Uint8Array(ab);
}

function unpackFloat32(blob: Uint8Array, dims: number): Float32Array {
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const arr = new Float32Array(dims);
  for (let i = 0; i < dims; i++) arr[i] = view.getFloat32(i * 4, true);
  return arr;
}

function dotProduct(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function l2Normalize(v: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) sumSq += v[i] * v[i];
  const mag = Math.sqrt(sumSq);
  if (mag === 0) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / mag;
  return out;
}

describe('KbIndexService internals', () => {
  it('Float32 pack/unpack is lossless', () => {
    const original = new Float32Array([0.1, -0.5, 1.0, -1.0, 1e-6, 1e6, 0]);
    const packed = packFloat32(original);
    expect(packed.length).toBe(original.length * 4);
    const unpacked = unpackFloat32(packed, original.length);
    for (let i = 0; i < original.length; i++) {
      expect(unpacked[i]).toBeCloseTo(original[i], 5);
    }
  });

  it('cosine similarity (via dot product on normalized vectors) ranks the closer vector higher', () => {
    const query = l2Normalize(new Float32Array([1, 0, 0]));
    const closer = l2Normalize(new Float32Array([0.9, 0.1, 0]));
    const farther = l2Normalize(new Float32Array([0, 1, 0]));
    const sCloser = dotProduct(query, closer);
    const sFarther = dotProduct(query, farther);
    expect(sCloser).toBeGreaterThan(sFarther);
    // Identical vectors → cosine 1.0
    expect(dotProduct(query, query)).toBeCloseTo(1.0, 6);
    // Orthogonal vectors → cosine 0
    expect(sFarther).toBeCloseTo(0, 6);
  });

  it('l2Normalize handles a zero vector without dividing by zero', () => {
    const zero = new Float32Array([0, 0, 0]);
    const out = l2Normalize(zero);
    expect(Array.from(out)).toEqual([0, 0, 0]);
  });
});
