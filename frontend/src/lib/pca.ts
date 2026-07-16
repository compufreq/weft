/**
 * Minimal PCA for the vector map: project high-dimensional vectors onto
 * their top-2 principal components. Pure, dependency-free, O(iters · n · d).
 */

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function normalize(v: number[]): number[] {
  const n = Math.sqrt(dot(v, v));
  return n === 0 ? v : v.map((x) => x / n);
}

/**
 * Leading eigenvector of the (implicit) covariance matrix of `centered`
 * via power iteration. `seedIndex` de-correlates the two component seeds.
 */
function leadingComponent(
  centered: number[][],
  ortho: number[] | null,
  seedIndex: number,
): number[] {
  const dim = centered[0].length;
  // Deterministic varied seed (Math.random is unnecessary here).
  let v = normalize(
    Array.from({ length: dim }, (_, i) => Math.sin(seedIndex + i + 1)),
  );
  for (let iter = 0; iter < 60; iter++) {
    const next = new Array<number>(dim).fill(0);
    for (const row of centered) {
      const w = dot(row, v);
      for (let i = 0; i < dim; i++) next[i] += w * row[i];
    }
    // Gram-Schmidt against the first component keeps PC2 orthogonal.
    if (ortho) {
      const proj = dot(next, ortho);
      for (let i = 0; i < dim; i++) next[i] -= proj * ortho[i];
    }
    v = normalize(next);
  }
  return v;
}

/**
 * Project vectors onto their top-2 principal components.
 * Returns one `[x, y]` per input vector (input order preserved).
 * Fewer than 3 vectors (or dim < 2) get trivial coordinates.
 */
export function project2d(vectors: number[][]): [number, number][] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  if (vectors.length < 3 || dim < 2) {
    return vectors.map((_, i) => [i, 0]);
  }

  const mean = new Array<number>(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) mean[i] += v[i] / vectors.length;
  const centered = vectors.map((v) => v.map((x, i) => x - mean[i]));

  const pc1 = leadingComponent(centered, null, 1);
  const pc2 = leadingComponent(centered, pc1, 2);

  return centered.map((v) => [dot(v, pc1), dot(v, pc2)]);
}
