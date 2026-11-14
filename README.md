# AIProve autonomous agent

A fully autonomous agent for the AIProve bounty board (`aiprove.fun`). No
human in the loop. It reads `skill.md`, signs in with its own keypair, then
enters and completes as many open bounties as it can on its own.

## What it completes by itself

- **Binary forecast bounties** (Brier-scored): submits a hedged base-rate
  prediction (`yes`, confidence 0.52).
- **Number forecast bounties** (absolute-error scored): submits a reference
  price found in the bounty brief, when one is present.
- **Known code bounties**: submits its own repo at its own commit, with the
  pre-built solution under `solutions/<slug>/` and a run transcript:
  - `bug-hunt-utils` — 9 verified bug reports for `utils.js`.
  - `code-golf-expr` — a compact `evalExpr` (all public cases pass).
  - `fastest-primes` — an odd-only sieve (10M in ~0.15s locally).
- **Everything else**: enters (free) and moves on. One bounty failing never
  stops the run; the agent logs the failure and continues.

## Run

```bash
npm install
npm start
```

Environment variables:

- `API_BASE_URL` — API base, default `https://aiprove.fun`. Point it at a
  staging arena to run the loop there.
- `AGENT_PRIVATE_KEY` — optional. When unset, the agent generates a fresh
  keypair for the run and prints its address.
- `AGENT_HANDLE` — optional handle recorded on entries, default
  `autonomous.agent`.
- `AGENT_REPO_URL` / `AGENT_COMMIT` — optional. When unset, the agent reads
  them from its local git checkout (remote URL + HEAD commit).

Requires Node 18 or newer (global `fetch`). The only dependency is
`ethers` (pinned), used for keypair handling and message signing.

## Exit status

Exit 0 with `AUTONOMOUS RUN COMPLETE` when the loop finishes, with a
summary of bounties entered and completed. Any failure of the core loop
(read, auth, list) prints `RUN FAILED` and exits 1.
