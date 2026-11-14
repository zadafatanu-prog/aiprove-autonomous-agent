// Fully autonomous agent for AIProve (aiprove.fun).
// No human in the loop. It reads skill.md, signs in with its own keypair,
// then enters and completes as many open bounties as it can on its own.
//
// What it can complete by itself:
//   - Binary forecast bounties: submits a hedged base-rate prediction.
//   - Number forecast bounties: submits a reference price found in the brief.
//   - Known code bounties (bug-hunt-utils, code-golf-expr, fastest-primes):
//     submits its own repo at its own commit, with the pre-built solution
//     under solutions/<slug>/ and a run transcript.
//   - Everything else: enters (free) and moves on.
//
// Run:  npm install && npm start
// Env:  API_BASE_URL (default https://aiprove.fun)
//       AGENT_PRIVATE_KEY (optional; a fresh keypair is generated if unset)
//       AGENT_HANDLE (default "autonomous.agent")
//       AGENT_REPO_URL / AGENT_COMMIT (optional; else read from local git)
//
// Requires Node 18+ (global fetch) and the pinned ethers dependency.

import { Wallet } from "ethers";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const API = (process.env.API_BASE_URL || "https://aiprove.fun").replace(/\/$/, "");
const HANDLE = process.env.AGENT_HANDLE || "autonomous.agent";

// Code bounties this agent ships pre-built solutions for (slug -> solution dir).
const CODE_SOLUTIONS = {
  "bug-hunt-utils": "solutions/bug-hunt-utils",
  "code-golf-expr": "solutions/code-golf-expr",
  "fastest-primes": "solutions/fastest-primes",
};

function log(step, msg) {
  console.log(`[${new Date().toISOString()}] ${step} ${msg}`);
}

async function getJson(url, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

async function postJson(url, body, token) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`POST ${url} -> HTTP ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function localGit(key) {
  try {
    return execSync(`git ${key}`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function repoIdentity() {
  const repoUrl =
    process.env.AGENT_REPO_URL || localGit("config --get remote.origin.url");
  const commit = process.env.AGENT_COMMIT || localGit("rev-parse HEAD");
  if (!repoUrl || !commit) return null;
  return { repoUrl: repoUrl.replace(/\.git$/, ""), commit };
}

function transcriptFor(slug, address, extra) {
  return [
    `Autonomous agent run by ${HANDLE} (${address}) at ${new Date().toISOString()}.`,
    `Bounty: ${slug}.`,
    `The agent read skill.md, authenticated with its own keypair, listed open`,
    `bounties, entered this bounty, and submitted its pre-built solution from`,
    `solutions/${slug}/ in its own repo, with no human in the loop.`,
    extra || "",
  ].join("\n");
}

async function tryComplete(bounty, token, address) {
  const brief = (bounty.brief || "").toLowerCase();
  const metric = (bounty.metric || "").toLowerCase();
  const slug = bounty.slug;

  // 1. Binary forecast: hedged base-rate prediction.
  if (bounty.cat === "forecast" && metric.includes("brier")) {
    const pred = await postJson(
      `${API}/api/bounties/${slug}/submit`,
      { prediction: { answer: "yes", confidence: 0.52 }, handle: HANDLE },
      token
    );
    return `submitted binary forecast yes/0.52 (${pred.id || "ok"})`;
  }

  // 2. Number forecast: use a reference price from the brief when present.
  if (bounty.cat === "forecast" && metric.includes("absolute error")) {
    const m = bounty.brief && bounty.brief.match(/\$([\d,]+(?:\.\d+)?)/);
    if (!m) return "skipped: number forecast, no reference price in brief";
    const price = parseFloat(m[1].replace(/,/g, ""));
    const pred = await postJson(
      `${API}/api/bounties/${slug}/submit`,
      { prediction: { answer: price, confidence: 0.5 }, handle: HANDLE },
      token
    );
    return `submitted number forecast ${price} (${pred.id || "ok"})`;
  }

  // 3. Known code bounty with a shipped solution: submit own repo @ commit.
  if (CODE_SOLUTIONS[slug] && existsSync(CODE_SOLUTIONS[slug])) {
    const id = repoIdentity();
    if (!id) return "skipped: code solution ready but repo URL/commit unknown";
    const sub = await postJson(
      `${API}/api/bounties/${slug}/submit`,
      {
        repoUrl: id.repoUrl,
        commit: id.commit,
        transcript: transcriptFor(slug, address, `Solution dir: ${CODE_SOLUTIONS[slug]}`),
        handle: HANDLE,
      },
      token
    );
    return `submitted repo entry (${sub.id || "ok"})`;
  }

  return "entered only (no autonomous completion available)";
}

async function main() {
  const skillRes = await fetch(`${API}/skill.md`);
  if (!skillRes.ok) throw new Error(`GET ${API}/skill.md -> HTTP ${skillRes.status}`);
  const skill = await skillRes.text();
  if (!skill.includes("Authenticate")) throw new Error("skill.md did not contain the auth section");
  log("READ", `skill.md read (${skill.length} chars)`);

  const wallet = process.env.AGENT_PRIVATE_KEY
    ? new Wallet(process.env.AGENT_PRIVATE_KEY)
    : Wallet.createRandom();
  log("IDENTITY", `agent address ${wallet.address}`);

  const { challenge } = await getJson(`${API}/api/auth/challenge?address=${wallet.address}`);
  if (!challenge) throw new Error("no challenge returned");
  const signature = await wallet.signMessage(challenge);
  const { token } = await postJson(`${API}/api/auth/verify`, {
    address: wallet.address,
    signature,
  });
  if (!token) throw new Error("no session token returned");
  log("AUTH", "signed challenge, session token issued");

  const data = await getJson(`${API}/api/bounties?status=open`, token);
  const bounties = Array.isArray(data) ? data : data.bounties || [];
  log("LIST", `${bounties.length} open bounties`);

  let entered = 0;
  let completed = 0;
  for (const b of bounties) {
    try {
      const entry = await postJson(
        `${API}/api/bounties/${b.slug}/enter`,
        { handle: HANDLE },
        token
      );
      if (!entry.id) throw new Error("enter returned no id");
      entered++;
      const result = await tryComplete(b, token, wallet.address);
      if (result.startsWith("submitted")) completed++;
      log("BOUNTY", `${b.slug}: ${result}`);
    } catch (e) {
      log("BOUNTY", `${b.slug}: FAILED (${e.message})`);
    }
  }

  const me = await getJson(`${API}/api/me`, token).catch(() => null);
  const subs = me && me.submissions ? me.submissions.length : "?";
  log("SUMMARY", `entered ${entered}, completed ${completed}, submissions on record: ${subs}`);
  console.log("AUTONOMOUS RUN COMPLETE");
}

main().catch((e) => {
  console.error("RUN FAILED:", e.message);
  process.exit(1);
});
