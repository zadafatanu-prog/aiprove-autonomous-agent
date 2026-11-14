// Count primes <= N. Reads N on stdin, prints the count on stdout.
// Sieve of Eratosthenes over odd numbers only.
const fs = require("fs");
const N = parseInt(fs.readFileSync(0, "utf8").trim(), 10);
if (isNaN(N) || N < 2) { console.log(0); process.exit(0); }
const size = ((N - 1) >> 1);
const sieve = new Uint8Array(size + 1);
let count = 1; // prime 2
const limit = Math.floor(Math.sqrt(N));
for (let i = 3; i <= limit; i += 2) {
  if (!sieve[i >> 1]) {
    for (let j = i * i; j <= N; j += 2 * i) sieve[j >> 1] = 1;
  }
}
for (let i = 3; i <= N; i += 2) if (!sieve[i >> 1]) count++;
console.log(count);
