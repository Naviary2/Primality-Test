/*
Source: https://github.com/latonv/MillerRabinPrimality
Compiled into a single executable Javascript file by Andreas Tsevas
See attached license below:

MIT License

Copyright (c) Laton Vermette (https://latonv.com)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software
and associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

// NOTE TO MYSELF, Naviary: !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// The chance for false positive probablyPrimes are "astronomically low",
// but can even be exponentially MORE reduced by modifying getAdaptiveNumRounds() to do more checks,
// (larger numbers need less tests to achieve the same accuracy)
// To prevent the extremely rare case of 2 players having different Huygen legal moves,
// use a seeded RNG, where the seed is the game ID or similar.


// Some useful BigInt constants
const ZERO = 0n
const ONE = 1n
const TWO = 2n
const FOUR = 4n
const NEG_ONE = -1n

/**
 * Calculates the inverse of `2^exp` modulo the given odd `base`.
 *
 * @param {number} exp The exponent of the power of 2 that should be inverted (_not_ the power of 2 itself!)
 * @param {bigint} base The modulus to invert with respect to
 * @returns {bigint}
 */
function invertPowerOfTwo(exp, base) {
  // Penk's rshift inversion method, but restricted to powers of 2 and odd bases (which is all we require for Miller-Rabin)
  // Just start from 1 and repeatedly halve, adding the base whenever necessary to remain even.
  let inv = ONE
  for (let i = 0; i < exp; i++) {
    if (inv & ONE) {
      inv += base
    }

    inv >>= ONE
  }

  return inv
}

/**
 * Calculates the multiplicity of 2 in the prime factorization of `n` -- i.e., how many factors of 2 `n` contains.
 * So if `n = 2^k * d` and `d` is odd, the returned value would be `k`.
 *
 * @param {bigint} n Any number
 * @returns {bigint} The multiplicity of 2 in the prime factorization of `n`
 */
function twoMultiplicity(n) {
  if (n === ZERO) return ZERO

  let m = ZERO
  while (true) {
    // Since n is not 0, it must have a leading 1 bit, so this is safe
    if (n & (ONE << m)) return m // Bail out when we reach the least significant 1 bit
    m++
  }
}

/**
 * Produces a string of random bits with the specified length.
 * Mainly useful as input to BigInt constructors that take digit strings of arbitrary length.
 *
 * @param {number} numBits How many random bits to return.
 * @returns {string} A string of `numBits` random bits.
 */
function getRandomBitString(numBits) {
  let bits = ""
  while (bits.length < numBits) {
    bits += Math.random()
      .toString(2)
      .substring(2, 50)
  }
  return bits.substring(0, numBits)
}

/**
 * Produces a Montgomery reduction context that can be used to define and operate on numbers in Montgomery form
 * for the given base.
 *
 * @param {bigint} base The modulus of the reduction context. Must be an odd number.
 * @returns {MontgomeryReductionContext}
 */
function getReductionContext(base) {
  if (!(base & ONE)) throw new Error(`base must be odd`)

  // Select the auxiliary modulus r to be the smallest power of two greater than the base modulus
  const numBits = bitLength(base)
  const littleShift = numBits
  const shift = BigInt(littleShift)
  const r = ONE << shift

  // Calculate the modular inverses of r (mod base) and base (mod r)
  const rInv = invertPowerOfTwo(littleShift, base)
  const baseInv = r - (((rInv * r - ONE) / base) % r) // From base*baseInv + r*rInv = 1  (mod r)

  return { base, shift, r, rInv, baseInv }
}

/**
 * Convert the given number into its Montgomery form, according to the given Montgomery reduction context.
 *
 * @param {bigint} n Any number
 * @param {MontgomeryReductionContext} ctx The Montgomery reduction context to reduce into
 * @returns {bigint} The Montgomery form of `n`
 */
function montgomeryReduce(n, ctx) {
  return (n << ctx.shift) % ctx.base
}

/**
 * Converts the given number _out_ of Montgomery form, according to the given Montgomery reduction context.
 *
 * @param {bigint} n A number in Montgomery form
 * @param {MontgomeryReductionContext} ctx The Montgomery reduction context to reduce out of
 * @returns {bigint} The (no longer Montgomery-reduced) number whose Montgomery form was `n`
 */
function invMontgomeryReduce(n, ctx) {
  return (n * ctx.rInv) % ctx.base
}

/**
 * Squares a number in Montgomery form.
 *
 * @param {bigint} n A number in Montgomery form
 * @param {MontgomeryReductionContext} ctx The Montgomery reduction context to square within
 * @returns {bigint} The Montgomery-reduced square of `n`
 */
function montgomerySqr(n, ctx) {
  return montgomeryMul(n, n, ctx)
}

/**
 * Multiplies two numbers in Montgomery form.
 *
 * @param {bigint} a A number in Montgomery form
 * @param {bigint} b A number in Montgomery form
 * @param {MontgomeryReductionContext} ctx The Montgomery reduction context to multiply within
 * @returns {bigint} The Montgomery-reduced product of `a` and `b`
 */
function montgomeryMul(a, b, ctx) {
  if (a === ZERO || b === ZERO) return ZERO

  const rm1 = ctx.r - ONE
  let unredProduct = a * b

  const t = (((unredProduct & rm1) * ctx.baseInv) & rm1) * ctx.base
  let product = (unredProduct - t) >> ctx.shift

  if (product >= ctx.base) {
    product -= ctx.base
  } else if (product < ZERO) {
    product += ctx.base
  }

  return product
}

/**
 * Calculates `n` to the power of `exp` in Montgomery form.
 * While `n` must be in Montgomery form, `exp` should not.
 *
 * @param {bigint} n A number in Montgomery form; the base of the exponentiation
 * @param {bigint} exp Any number (_not_ in Montgomery form)
 * @param {MontgomeryReductionContext} ctx The Montgomery reduction context to exponentiate within
 * @returns {bigint} The Montgomery-reduced result of taking `n` to exponent `exp`
 */
function montgomeryPow(n, exp, ctx) {
  // Exponentiation by squaring
  const expLen = BigInt(bitLength(exp))
  let result = montgomeryReduce(ONE, ctx)
  for (let i = ZERO, x = n; i < expLen; ++i, x = montgomerySqr(x, ctx)) {
    if (exp & (ONE << i)) {
      result = montgomeryMul(result, x, ctx)
    }
  }

  return result
}

/**
 * A record class to hold the results of primality testing.
 */
class PrimalityResult {
  /**
   * Constructs a result object from the given options
   * @param {PrimalityResultOptions} options
   */
  constructor({ n, probablePrime, witness = null, divisor = null }) {
    this.n = n
    this.probablePrime = probablePrime
    this.witness = witness
    this.divisor = divisor
  }
}

/**
 * Calculates the gcd of two positive bigints.
 *
 * @param {bigint} a The first number (must be positive)
 * @param {bigint} b The second number (must be positive)
 * @returns {bigint} gcd(a, b)
 */
function ugcd(a, b) {
  if (a === b) return a
  if (a === ZERO) return b
  if (b === ZERO) return a

  // Strip out any shared factors of two beforehand (to be re-added at the end)
  let sharedTwoFactors = ZERO
  while (!((a & ONE) | (b & ONE))) {
    sharedTwoFactors++
    a >>= ONE
    b >>= ONE
  }

  while (a !== b && b > ONE) {
    // Any remaining factors of two in either number are not important to the gcd and can be shifted away
    while (!(a & ONE)) a >>= ONE
    while (!(b & ONE)) b >>= ONE

    // Standard Euclidean algorithm, maintaining a > b and avoiding division
    if (b > a) {
      ;[a, b] = [b, a]
    } else if (a === b) {
      break
    }

    a -= b
  }

  // b is the gcd, after re-applying the shared factors of 2 removed earlier
  return b << sharedTwoFactors
}

/**
 * Ensures that all bases in the given array are valid for use in Miller-Rabin tests on the number `n = nSub + 1`.
 * A base is valid if it is an integer in the range [2, n-2].
 *
 * If `bases` is null or undefined, it is ignored and null is returned.
 * If `bases` is an array of valid bases, they will be returned as a new array, all coerced to BigInts.
 * Otherwise, a RangeError will be thrown if any of the bases are outside the valid range, or a TypeError will
 * be thrown if `bases` is neither an array nor null/undefined.
 *
 * @param {BigIntResolvable[] | null} bases The array of bases to validate
 * @param {bigint} nSub One less than the number being primality tested
 * @returns {bigint[] | null} An array of BigInts provided all bases were valid, or null if the input was null
 */
function validateBases(bases, nSub) {
  if (bases == null) {
    return null
  } else if (Array.isArray(bases)) {
    // Ensure all bases are valid BigInts within [2, n-2]
    return bases.map(b => {
      if (typeof b !== "bigint") {
        b = BigInt(b)
      }

      if (!(b >= TWO) || !(b < nSub)) {
        throw new RangeError(
          `invalid base (must be in the range [2, n-2]): ${b}`
        )
      }

      return b
    })
  } else {
    throw new TypeError(`invalid bases option (must be an array)`)
  }
}

/**
 * Runs Miller-Rabin primality tests on `n` using randomly-chosen bases, to determine with high probability whether `n` is a prime number.
 *
 * @param {BigIntResolvable} n An integer (or string representation thereof) to be tested for primality.
 * @param {PrimalityTestOptions?} options An object specifying the `numRounds` and/or `findDivisor` options.
 *   - `numRounds` is a positive integer specifying the number of random bases to test against.
 *    If none is provided, a reasonable number of rounds will be chosen automatically to balance speed and accuracy.
 *   - `bases` is an array of integers to use as the bases for Miller-Rabin testing. If this option
 *    is specified, the `numRounds` option will be ignored, and the maximum number of testing rounds will equal `bases.length` (one round
 *    for each given base). Every base provided must lie within the range [2, n-2] (inclusive) or a RangeError will be thrown.
 *    If `bases` is specified but is not an array, a TypeError will be thrown.
 *   - `findDivisor` is a boolean specifying whether to calculate and return a divisor of `n` in certain cases where this is
 *    easily possible (not guaranteed). Set this to false to avoid extra calculations if a divisor is not needed. Defaults to `true`.
 *   - `small_determinism_mode` is a boolean specifying whether the primality test should run deterministically for small bases.
 *    This is about 10% faster for when when enabled.
 * @returns {Promise<PrimalityResult>} A result object containing properties
 *   - `n` (the input value, as a BigInt),
 *   - `probablePrime` (true if all the primality tests passed, false otherwise),
 *   - `witness` (a BigInt witness for the compositeness of `n`, or null if none was found),
 *   - `divisor` (a BigInt divisor of `n`, or null if no such divisor was found)
 */
function primalityTest(
  n,
  { numRounds = undefined, bases = undefined, findDivisor = true, small_determinism_mode = false } = {}
) {
  return new Promise((resolve, reject) => {
    try {
      if (typeof n !== "bigint") {
        n = BigInt(n)
      }

      // Ensure n is positive, but keep track of whether the input was originally negative
      const sign = n < ZERO ? NEG_ONE : ONE // Just considering zero to have a positive sign, for simplicity's sake
      if (sign === NEG_ONE) {
        n = -n
      }

      // Handle some small special cases
      if (n < TWO) {
        // n = 0 or 1
        resolve(
          new PrimalityResult({
            n: sign * n,
            probablePrime: false,
            witness: null,
            divisor: null
          })
        )
        return
      } else if (n < FOUR) {
        // n = 2 or 3
        resolve(
          new PrimalityResult({
            n: sign * n,
            probablePrime: true,
            witness: null,
            divisor: null
          })
        )
        return
      } else if (!(n & ONE)) {
        // Quick short-circuit for other even n
        resolve(
          new PrimalityResult({
            n: sign * n,
            probablePrime: false,
            witness: null,
            divisor: TWO
          })
        )
        return
      } else if (small_determinism_mode && n < 341550071728321n) {
        // These numbers are found at: https://github.com/alpertron/calculators/blob/master/isprime.c 
        // And that link got it from here: https://oeis.org/A014233 
        if (n < 2047n) {
          bases = [2]
        } else if (n < 1373653n) {
          bases = [2,3]
        } else if (n < 25326001n) {
          bases = [2,3,5]
        } else if (n < 3215031751n) {
          bases = [2,3,5,7]
        } else if (n < 2152302898747n) {
          bases = [2,3,5,7,11]
        } else if (n < 3474749660383n) {
          bases = [2,3,5,7,11,13]
        } else {
          bases = [2,3,5,7,11,13,17]
        }
      }

      const nBits = bitLength(n)
      const nSub = n - ONE

      // Represent n-1 as d * 2^r, with d odd
      const r = twoMultiplicity(nSub) // Multiplicity of prime factor 2 in the prime factorization of n-1
      const d = nSub >> r // The result of factoring out all powers of 2 from n-1

      // Convert into a Montgomery reduction context for faster modular exponentiation
      const reductionContext = getReductionContext(n)
      const oneReduced = montgomeryReduce(ONE, reductionContext) // The number 1 in the reduction context
      const nSubReduced = montgomeryReduce(nSub, reductionContext) // The number n-1 in the reduction context

      // Either use the user-provided list of bases to test against, or determine how many random bases to test
      const validBases = validateBases(bases, nSub)
      if (validBases != null) {
        numRounds = validBases.length
      } else if (numRounds == null || numRounds < 1) {
        // If the number of testing rounds was not provided, pick a reasonable one based on the size of n
        // Larger n have a vanishingly small chance to be falsely labelled probable primes, so we can balance speed and accuracy accordingly
        numRounds = getAdaptiveNumRounds(nBits)
      }

      let probablePrime = true
      let witness = null
      let divisor = null
      let baseIndex = 0 // Only relevant if the user specified a list of bases to use

      outer: for (let round = 0; round < numRounds; round++) {
        let base
        if (validBases != null) {
          // Use the next user-specified base
          base = validBases[baseIndex]
          baseIndex++
        } else {
          // Select a random base to test
          do {
            base = BigInt("0b" + getRandomBitString(nBits))
          } while (!(base >= TWO) || !(base < nSub)) // The base must lie within [2, n-2]
        }

        // Check whether the chosen base has any factors in common with n (if so, we can end early)
        if (findDivisor) {
          const gcd = ugcd(n, base)
          if (gcd !== ONE) {
            probablePrime = false
            witness = base
            divisor = gcd
            break // Found a factor of n, so no need for further primality tests
          }
        }

        const baseReduced = montgomeryReduce(base, reductionContext)
        let x = montgomeryPow(baseReduced, d, reductionContext)
        if (x === oneReduced || x === nSubReduced) continue // The test passed: base^d = +/-1 (mod n)

        // Perform the actual Miller-Rabin loop
        let i, y
        for (i = ZERO; i < r; i++) {
          y = montgomerySqr(x, reductionContext)

          if (y === oneReduced) {
            probablePrime = false // The test failed: base^(d*2^i) = 1 (mod n) and thus cannot be -1 for any i
            witness = base // So this base is a witness to the guaranteed compositeness of n
            if (findDivisor) {
              divisor = ugcd(invMontgomeryReduce(x, reductionContext) - ONE, n)
              if (divisor === ONE) divisor = null
            }
            break outer
          } else if (y === nSubReduced) {
            // The test passed: base^(d*2^i) = -1 (mod n) for the current i
            // So n is a strong probable prime to this base (though n may still be composite)
            break
          }

          x = y
        }

        // No value of i satisfied base^(d*2^i) = +/-1 (mod n)
        // So this base is a witness to the guaranteed compositeness of n
        if (i === r) {
          probablePrime = false
          witness = base
          if (findDivisor) {
            divisor = ugcd(invMontgomeryReduce(x, reductionContext) - ONE, n)
            if (divisor === ONE) divisor = null
          }
          break
        }
      }

      resolve(
        new PrimalityResult({ n: sign * n, probablePrime, witness, divisor })
      )
    } catch (err) {
      reject(err)
    }
  })
}

/**
 * Calculates the length of `n` in bits.
 *
 * @param {bigint} n Any positive integer
 * @returns {number} The number of bits required to encode `n`
 */
function bitLength(n) {
  // Surprisingly, string conversion seems to be the most performant way to get the bit length of a BigInt at present...
  return n.toString(2).length
}

/**
 * Determines an appropriate number of Miller-Rabin testing rounds to perform based on the size of the
 * input number being tested. Larger numbers generally require fewer rounds to maintain a given level
 * of accuracy.
 *
 * @param {number} inputBits The number of bits in the input number.
 * @returns {number} How many rounds of testing to perform.
 */
function getAdaptiveNumRounds(inputBits) {
  if (inputBits > 1000) return 2
  else if (inputBits > 500) return 3
  else if (inputBits > 250) return 4
  else if (inputBits > 150) return 5
  else return 6
}


/*
let prime1 = 0;
let prime2 = BigInt("34260522533194312141699016768017376046579370858274371908475849");
let prime3 = BigInt("24609615439855545007865829059894825853255339682863740988001");
let largecomposite = prime2*prime3;

primalityTest(prime1).then((result) => {
  console.log(prime1 + " is prime? " + result.probablePrime);
});

primalityTest(prime2).then((result) => {
  console.log(prime2 + " is prime? " + result.probablePrime);
});

primalityTest(prime3).then((result) => {
  console.log(prime3 + " is prime? " + result.probablePrime);
});

primalityTest(largecomposite).then((result) => {
  console.log(largecomposite + " is prime? " + result.probablePrime);
});

primalityTest(BigInt("10") ** BigInt("1000") + BigInt("13")).then((result) => {
  console.log("Stupidly large number is prime? " + result.probablePrime);
});

primalityTest(BigInt("341550071728319"), {small_determinism_mode: true}).then((result) => {
  console.log("Small number is prime? " + result.probablePrime);
});

*/

/*
async function test_for_errors(){
  let erroramount = 0;
  let N_TESTS = 1000;
  for (let i = 0; i< N_TESTS; i++){
    let primality = await primalityTest(largecomposite);
    if (primality.probablePrime) erroramount++;
  }
  console.log("Number of false positives after " + N_TESTS + " tests: " + erroramount);
}
test_for_errors();
*/

async function speed_test(){
  let N_START = 10n**9n;
  let N_STEPS = 10n**5n;
  let timer = Date.now();
  for (let i = N_START; i< N_START + N_STEPS; i+= 1n){
    await primalityTest(i);
  }
  console.log(`Time ellapsed: ${(Date.now()-timer)/1000}s`);
}
speed_test();