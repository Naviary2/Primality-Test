# Primality testing algorithm

This is a primality testing algorithm written in javascript and geared towards being as fast as possible. It is an adaptation of https://github.com/latonv/MillerRabinPrimality optimized for speed and determinism for "small" inputs.

`isPrime.js` contains the function `primalityTest(n)` which returns a boolean value specifying whether `n` is a probable prime or not, where `n` can be either a number or a BigInt or a string. Look at the comments in the code for the detailed description of every function and the optional arguments that can be specified.

We employ the Miller-Rabin algorithm, and we utilize the Montgomery modular multiplication method for large inputs above 10³⁰ by default. For inputs below 2⁶⁴, our algorithm was written to be deterministic and always test the optimal bases (see an explanation [here](https://en.wikipedia.org/wiki/Miller%E2%80%93Rabin_primality_test#Testing_against_small_sets_of_bases)). For inputs larger than 2⁶⁴, the algorithm is probabilistic and the number of bases tested is adjusted dynamically by the method `getAdaptiveNumRounds(inputBits)`, finding a good tradeoff between speed and reliability.

---
This code was adapted by Andreas Tsevas and Naviary for a private project, but feel free to use it as part of your own project if you need a browser to calculate primes in natively written javascript.