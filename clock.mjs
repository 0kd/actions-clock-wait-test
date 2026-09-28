// A finite GitHub-only environment-wait experiment. No cross-repository requests.
import {writeFile} from 'node:fs/promises';
import {setTimeout as sleep} from 'node:timers/promises';

export async function clockTick(env, {now = Date.now, wait = sleep, request} = {}) {
  const planned = Date.parse(env.PLANNED_FOR || '');
  const remaining = Number(env.REMAINING);
  const repo = env.GITHUB_REPOSITORY;
  if (!Number.isFinite(planned) || !Number.isInteger(remaining) || remaining < 1 || remaining > 3)
    throw new Error('A valid timestamp and one to three ticks are required');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || '')) throw new Error('Invalid repository');
  const api = request || (async (path, method = 'GET', body) => {
    const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: {Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10', 'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`);
    return response.status === 204 ? {} : response.json();
  });
  const environment = await api('/environments/clock-wait-nine-minutes');
  if (!environment.protection_rules?.some(rule => rule.type === 'wait_timer' && rule.wait_timer === 9))
    throw new Error('The nine-minute environment wait rule is required');
  const delay = planned - now();
  if (delay > 120_000) throw new Error('The job started too early; refusing a long runner wait');
  if (delay > 0) await wait(delay);
  const observed = now();
  const receipt = {source: 'github_environment_wait_test', run_id: env.GITHUB_RUN_ID,
    planned_for: new Date(planned).toISOString(), observed_at: new Date(observed).toISOString(),
    lag_seconds: (observed - planned) / 1000, remaining,
    within_tolerance: observed >= planned && observed - planned <= 120_000,
    successor_requested: false, paper_notifications: false};
  if (receipt.within_tolerance && remaining > 1) {
    // One attempt only: an ambiguous POST response must not cause duplicate chains.
    await api('/actions/workflows/clock.yml/dispatches', 'POST', {ref: 'main', inputs: {
      planned_for: new Date(planned + 600_000).toISOString(), remaining: String(remaining - 1)}});
    receipt.successor_requested = true;
  }
  return receipt;
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  const result = await clockTick(process.env);
  console.log('GITHUB_CLOCK_RECEIPT=' + JSON.stringify(result));
  await writeFile('clock-receipt.json', JSON.stringify(result, null, 2) + '\n');
  if (!result.within_tolerance) process.exitCode = 1;
}
