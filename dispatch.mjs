// Runs entirely on GitHub; the target token is supplied by the caller.
const TARGETS = new Set(['publisher_cloud.yml', 'publisher_mac_worker.yml', 'publisher_timer_receiver.yml']);
const INTERVAL = 600_000;

class GitHubFailure extends Error {
  constructor(status) { super(`GitHub HTTP ${status}`); this.status = status; }
}

export async function dispatchTick(env, storage, scheduledTime, {fetcher = fetch, now = Date.now()} = {}) {
  const repository = env.TARGET_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '')) throw new Error('Invalid target repository');
  const target = env.TARGET_WORKFLOW || 'publisher_timer_receiver.yml';
  if (!TARGETS.has(target)) throw new Error('Unsupported target workflow');
  if (env.ENABLED !== 'true') return {status: 'disabled', target};
  if (target === 'publisher_timer_receiver.yml') {
    const end = Date.parse(env.DIAGNOSTIC_EXPIRES_AT || '');
    if (!Number.isFinite(end) || now >= end) return {status: 'diagnostic_expired', target};
  }
  if (!env.GITHUB_DISPATCH_TOKEN) throw new Error('Dispatch token is missing');
  if (!Number.isSafeInteger(scheduledTime) || scheduledTime > now + 60_000 || now - scheduledTime > 12 * 60_000) {
    return {status: 'invalid_or_expired_tick', target};
  }
  const slot = Math.floor(scheduledTime / INTERVAL);
  const tick = new Date(scheduledTime).toISOString();
  // A separate key permits the verified probe to be switched to production.
  const key = `timer:${target}`;
  const previous = await storage.get(key) || {};
  if (slot <= (previous.lastSlot ?? -1)) return {status: 'duplicate_tick', tick, target};
  const root = `https://api.github.com/repos/${repository}`;
  async function api(path, method = 'GET', data) {
    const response = await fetcher(root + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(5_000),
      headers: {'Authorization': `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
        'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10',
        'User-Agent': 'paper-notifier-timer', 'Content-Type': 'application/json'},
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    if (!response.ok) throw new GitHubFailure(response.status);
    return response.status === 204 ? {} : response.json();
  }
  async function record(status, extra = {}) {
    const result = {status, tick, target, ...extra};
    await storage.put(key, {lastSlot: slot, lastResult: result});
    return result;
  }
  try {
    const repo = await api('');
    if (repo.private !== true || repo.default_branch !== 'main') throw new Error('Unexpected repository configuration');
    const workflow = await api(`/actions/workflows/${target}`);
    if (workflow.state !== 'active') return record('workflow_disabled');
    const byId = new Map();
    // A Mac can be offline for more than a day. Do not hide its older queued
    // run behind the bounded history query below and enqueue another each tick.
    for (const status of ['queued', 'waiting', 'pending', 'requested', 'in_progress']) {
      for (let page = 1; page <= 10; page++) {
        const query = new URLSearchParams({branch: 'main', status, per_page: '100', page: String(page)});
        const value = await api(`/actions/workflows/${target}/runs?${query}`);
        if (!Array.isArray(value.workflow_runs)) throw new Error('Invalid workflow history');
        for (const run of value.workflow_runs) byId.set(run.id, run);
        if (value.workflow_runs.length < 100) break;
        if (page === 10) throw new Error('Incomplete active workflow history');
      }
    }
    for (let page = 1; page <= 10; page++) {
      const query = new URLSearchParams({branch: 'main',
        created: '>=' + new Date(now - 24 * 3600_000).toISOString(), per_page: '100', page: String(page)});
      const value = await api(`/actions/workflows/${target}/runs?${query}`);
      if (!Array.isArray(value.workflow_runs)) throw new Error('Invalid workflow history');
      for (const run of value.workflow_runs) byId.set(run.id, run);
      if (value.workflow_runs.length < 100) break;
      if (page === 10) throw new Error('Incomplete workflow history');
    }
    const runs = [...byId.values()].filter(run => run.head_branch === 'main');
    const pending = runs.filter(run => !['completed', 'in_progress'].includes(run.status));
    if (pending.length) return record('already_pending', {run_id: pending[0].id});
    for (const run of runs.filter(run => run.status === 'in_progress')) {
      // A workflow may already be in_progress while its self-hosted job has
      // not acquired a runner. Such a run is the outstanding wake-up request.
      const value = await api(`/actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
      if (!Array.isArray(value.jobs) || value.total_count > 100) throw new Error('Incomplete job history');
      if (!value.jobs.some(job => job.status === 'in_progress') &&
          value.jobs.some(job => job.status !== 'completed')) {
        return record('already_pending', {run_id: run.id});
      }
    }
    const sameSlot = runs.find(run => {
      const created = Date.parse(run.created_at);
      const title = run.display_title || '';
      if (title === `Publisher notifier notify ${tick}` || title === `Publisher timer receiver ${tick}`) return true;
      const delivery = run.event === 'schedule' || title.startsWith('Publisher notifier notify ');
      return delivery && Number.isFinite(created) && Math.floor(created / INTERVAL) === slot;
    });
    if (sameSlot) return record('already_started_this_slot', {run_id: sameSlot.id});
    // Persist before POST: a lost HTTP response must not cause duplicate POSTs.
    await record('dispatching');
    const inputs = {timer_tick: tick};
    if (target === 'publisher_cloud.yml' || target === 'publisher_mac_worker.yml') inputs.mode = 'notify';
    try {
      const result = await api(`/actions/workflows/${target}/dispatches`, 'POST', {ref: 'main', inputs});
      return record('dispatched', result.workflow_run_id ? {run_id: result.workflow_run_id} : {});
    } catch (error) {
      // The next ten-minute tick checks actual GitHub runs before retrying.
      return record(error instanceof GitHubFailure ? 'dispatch_rejected' : 'dispatch_outcome_unknown',
        error instanceof GitHubFailure ? {http_status: error.status} : {});
    }
  } catch (error) {
    return {status: 'preflight_failed', tick, target,
      ...(error instanceof GitHubFailure ? {http_status: error.status} : {error_type: error.name})};
  }
}
