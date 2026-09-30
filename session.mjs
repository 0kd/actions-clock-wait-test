// A bounded GitHub-only clock. All tick jobs are declared before the session starts.
import {appendFile} from 'node:fs/promises';
import {setTimeout as sleep} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {dispatchTick} from './dispatch.mjs';

export const INTERVAL = 600_000;
const MAX_WAIT = 120_000;
export function environmentName(minutes) { return minutes === 0 ? 'clock-seed' : `clock-wait-${minutes}`; }
export function waitMinutes(planned, now) { return Math.min(9, Math.max(0, Math.floor((planned-now)/60_000))); }
function timestamp(value) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value || '')) throw new Error('Invalid UTC time');
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new Error('Invalid UTC time');
  return result;
}
function parameters(env) {
  const start = timestamp(env.SESSION_START), end = timestamp(env.SESSION_END);
  if (end <= start || end-start > 144*INTERVAL || (end-start)%INTERVAL !== 0)
    throw new Error('Invalid bounded session');
  if (!['probe','notify'].includes(env.CLOCK_MODE)) throw new Error('Invalid clock mode');
  return {start,end};
}
export function publicApi(env, fetcher=fetch) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY || '')) throw new Error('Invalid clock repository');
  return async path => {
    const response = await fetcher(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}${path}`, {
      redirect:'error', signal:AbortSignal.timeout(15_000),
      headers:{Authorization:`Bearer ${env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json',
        'X-GitHub-Api-Version':'2026-03-10'},
    });
    if (!response.ok) throw new Error(`Clock API HTTP ${response.status}`);
    return response.json();
  };
}
export async function verifyEnvironment(api, name) {
  const minutes = name === 'clock-seed' ? 0 : Number(/^clock-wait-([1-9])$/.exec(name)?.[1]);
  if (!Number.isInteger(minutes)) throw new Error('Invalid wait environment');
  const value = await api(`/environments/${name}`);
  const rules = value.protection_rules || [];
  const timers = rules.filter(rule=>rule.type==='wait_timer');
  if (minutes === 0 ? timers.some(rule=>rule.wait_timer !== 0)
      : timers.length !== 1 || timers[0].wait_timer !== minutes) throw new Error('Unexpected wait rule');
  if (rules.some(rule=>rule.type==='required_reviewers')) throw new Error('Unexpected manual review wait');
  if (value.deployment_branch_policy?.custom_branch_policies !== true) throw new Error('Main-only branch restriction is required');
  const policy = await api(`/environments/${name}/deployment-branch-policies`);
  if (policy.total_count !== 1 || policy.branch_policies?.[0]?.name !== 'main' ||
      policy.branch_policies[0].type !== 'branch') throw new Error('Main-only branch restriction is required');
  return minutes;
}
export async function prepare(env, {now=Date.now, api=publicApi(env)}={}) {
  const count = Number(env.TICKS);
  if (![3,144].includes(count) || !['probe','notify'].includes(env.CLOCK_MODE)) throw new Error('Invalid session request');
  if (env.GITHUB_RUN_ATTEMPT !== '1' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw new Error('Start a new bounded session; do not rerun one');
  for(let i=0;i<=9;i++) await verifyEnvironment(api,environmentName(i));
  const current = now();
  const start = Math.ceil(current/INTERVAL)*INTERVAL;
  return {start:new Date(start).toISOString(),end:new Date(start+count*INTERVAL).toISOString(),
    first_environment:environmentName(waitMinutes(start,current)),ticks:count};
}
export async function tick(env, {now=Date.now,wait=sleep,api=publicApi(env),dispatch=dispatchTick}={}) {
  const {start,end}=parameters(env);
  if(env.GITHUB_RUN_ATTEMPT !== '1') throw new Error('Reruns are not permitted');
  const receipt={source:'github_bounded_clock',run_id:env.GITHUB_RUN_ID,
    job:env.CLOCK_INDEX,mode:env.CLOCK_MODE,halt:false};
  if(now()>=end) return {...receipt,status:'expired',halt:true};
  const workflow=await api('/actions/workflows/connected-clock.yml');
  if(workflow.state!=='active') return {...receipt,status:'disabled',halt:true};
  await verifyEnvironment(api,env.WAIT_ENVIRONMENT);
  let planned=env.PLANNED_FOR ? timestamp(env.PLANNED_FOR) : start;
  if(planned<start || planned>=end || (planned-start)%INTERVAL!==0) throw new Error('Invalid planned tick');
  // After an interruption service the most recent slot once; never replay a backlog.
  const skipped=Math.max(0,Math.floor((now()-planned)/INTERVAL));
  planned+=skipped*INTERVAL;
  if(planned-now()>MAX_WAIT) throw new Error('Job started before its environment wait elapsed');
  if(planned>now()) await wait(planned-now());
  const observed=now();
  if(observed>=end) return {...receipt,status:'expired',halt:true};
  const memory=new Map();
  const settings={ENABLED:'true',TARGET_REPOSITORY:env.TARGET_REPOSITORY,
    TARGET_WORKFLOW:env.CLOCK_MODE==='notify'?'publisher_mac_worker.yml':'publisher_timer_receiver.yml',
    GITHUB_DISPATCH_TOKEN:env.PRIVATE_DISPATCH_TOKEN,DIAGNOSTIC_EXPIRES_AT:env.SESSION_END};
  let result;
  try {
    result=await dispatch(settings,{get:async key=>memory.get(key),put:async(key,value)=>memory.set(key,value)},planned,{now:observed});
  } catch {
    // Unknown exceptions may contain a token or private URL. Keep them off public logs.
    result={status:'dispatch_exception'};
  }
  const finished=now();
  const next=start+(Math.floor((finished-start)/INTERVAL)+1)*INTERVAL;
  const halt=next>=end || [401,403].includes(result.http_status);
  return {...receipt,status:result.status,http_status:result.http_status,halt,
    planned_for:new Date(planned).toISOString(),observed_at:new Date(observed).toISOString(),
    lag_seconds:(observed-planned)/1000,skipped_slots:skipped,
    next_planned:new Date(next).toISOString(),next_environment:environmentName(waitMinutes(next,finished))};
}
async function output(values) {
  if(process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,
    Object.entries(values).map(([key,value])=>`${key}=${value}\n`).join(''));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    if(process.argv.includes('--prepare')) {
      const result=await prepare(process.env); await output(result);
      console.log('CLOCK_SESSION='+JSON.stringify(result));
    } else {
      const result=await tick(process.env);
      await output({halt:String(result.halt),next_planned:result.next_planned||'',
        next_environment:result.next_environment||'clock-wait-9'});
      console.log('CLOCK_RECEIPT='+JSON.stringify(result));
      if(process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
        '```json\n'+JSON.stringify(result,null,2)+'\n```\n');
      if(['preflight_failed','dispatch_rejected','dispatch_outcome_unknown','dispatch_exception'].includes(result.status)) process.exitCode=1;
    }
  } catch {
    await output({halt:'true'});
    console.log('CLOCK_RECEIPT='+JSON.stringify({source:'github_bounded_clock',status:'configuration_error',halt:true}));
    process.exitCode=1;
  }
}
