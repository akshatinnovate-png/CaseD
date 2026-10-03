// Python's `random.Random`, in the browser.
//
// The scorer picks the tempo, the key and every swung note from a seeded RNG,
// so "same seed, same film" only holds across the CLI and the web if both draw
// the same numbers. CPython uses MT19937 with its own derivations on top
// (genrand_res53 for random(), rejection sampling for randrange), so matching
// `Math.random()` is not an option — this implements the real thing.
//
// Verified against CPython's output in scripts/check_random.mjs.

const N = 624, M = 397, MATRIX_A = 0x9908b0df, UPPER = 0x80000000, LOWER = 0x7fffffff;

export class PyRandom {
  constructor(seed = 0) {
    this.mt = new Uint32Array(N);
    this.mti = N + 1;
    this.seed(seed);
  }

  /** init_genrand: the scalar seeding MT19937 is specified with. */
  _initGenrand(s) {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      // mt[i] = 1812433253 * (mt[i-1] ^ (mt[i-1] >> 30)) + i, mod 2^32.
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      // 32-bit multiply without losing the high bits to float precision.
      const lo = (prev & 0xffff) * 1812433253;
      const hi = (((prev >>> 16) * 1812433253) & 0xffff) << 16;
      mt[i] = (((lo + hi) >>> 0) + i) >>> 0;
    }
    this.mti = N;
  }

  /** init_by_array: what CPython actually calls, so the key matters. */
  _initByArray(key) {
    this._initGenrand(19650218);
    const mt = this.mt;
    let i = 1, j = 0, k = Math.max(N, key.length);
    for (; k; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      const lo = (prev & 0xffff) * 1664525;
      const hi = (((prev >>> 16) * 1664525) & 0xffff) << 16;
      mt[i] = ((((mt[i] ^ ((lo + hi) >>> 0)) >>> 0) + key[j]) >>> 0) + j;
      mt[i] >>>= 0;
      i++; j++;
      if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
      if (j >= key.length) j = 0;
    }
    for (k = N - 1; k; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      const lo = (prev & 0xffff) * 1566083941;
      const hi = (((prev >>> 16) * 1566083941) & 0xffff) << 16;
      mt[i] = (((mt[i] ^ ((lo + hi) >>> 0)) >>> 0) - i) >>> 0;
      i++;
      if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
    }
    mt[0] = 0x80000000;
    this.mti = N;
  }

  /**
   * CPython seeds an int by its absolute value, split into 32-bit limbs,
   * little end first — so seed(7) is init_by_array([7]), not init_genrand(7).
   */
  seed(s) {
    let n = typeof s === 'number' ? Math.abs(Math.trunc(s)) : Math.abs(Number(s) || 0);
    if (!Number.isFinite(n)) n = 0;
    const key = [];
    if (n === 0) key.push(0);
    // Number is exact to 2^53, so take limbs via division rather than shifts.
    while (n > 0) { key.push(n % 4294967296); n = Math.floor(n / 4294967296); }
    this._initByArray(key.length ? key : [0]);
  }

  /** genrand_uint32. */
  _next() {
    const mt = this.mt;
    if (this.mti >= N) {
      let kk = 0, y;
      for (; kk < N - M; kk++) {
        y = ((mt[kk] & UPPER) | (mt[kk + 1] & LOWER)) >>> 0;
        mt[kk] = (mt[kk + M] ^ (y >>> 1) ^ ((y & 1) ? MATRIX_A : 0)) >>> 0;
      }
      for (; kk < N - 1; kk++) {
        y = ((mt[kk] & UPPER) | (mt[kk + 1] & LOWER)) >>> 0;
        mt[kk] = (mt[kk + (M - N)] ^ (y >>> 1) ^ ((y & 1) ? MATRIX_A : 0)) >>> 0;
      }
      y = ((mt[N - 1] & UPPER) | (mt[0] & LOWER)) >>> 0;
      mt[N - 1] = (mt[M - 1] ^ (y >>> 1) ^ ((y & 1) ? MATRIX_A : 0)) >>> 0;
      this.mti = 0;
    }
    let y = mt[this.mti++];
    y = (y ^ (y >>> 11)) >>> 0;
    y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0;
    y = (y ^ ((y << 15) & 0xefc60000)) >>> 0;
    return (y ^ (y >>> 18)) >>> 0;
  }

  /** genrand_res53: two draws make one 53-bit double. */
  random() {
    const a = this._next() >>> 5, b = this._next() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  /** getrandbits(k), k <= 32. Enough for every range the scorer asks for. */
  getrandbits(k) {
    if (k <= 0) return 0;
    if (k <= 32) return this._next() >>> (32 - k);
    throw new RangeError('getrandbits: k > 32 not needed here');
  }

  /**
   * _randbelow: rejection sampling. CPython takes k from n.bit_length(), not
   * (n-1).bit_length() — for a power of two that is one bit more than the
   * range needs, so it draws and rejects where a tighter k would not. Getting
   * this wrong leaves the generators in step for a while and then diverges.
   */
  _randbelow(n) {
    if (n <= 0) return 0;
    const bits = 32 - Math.clz32(n);          // n.bit_length(), n > 0
    let r = this.getrandbits(bits);
    while (r >= n) r = this.getrandbits(bits);
    return r;
  }

  randrange(a, b) { return a + this._randbelow(b - a); }
  randint(a, b) { return this.randrange(a, b + 1); }
  choice(seq) { return seq[this._randbelow(seq.length)]; }
  uniform(a, b) { return a + (b - a) * this.random(); }
}

export default PyRandom;
