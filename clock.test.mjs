import test from 'node:test';
import assert from 'node:assert/strict';
import {clockTick} from './clock.mjs';
const PLAN = Date.parse('2026-09-28T13:00:00Z');
const env = {PLANNED_FOR: new Date(PLAN).toISOString(), REMAINING: '3',
  GITHUB_REPOSITORY: 'example/clock', GITHUB_RUN_ID: '1'};
function setup({start = PLAN - 50_000, rule = 9} = {}) {
  let t = start; const posts = [], waits = [];
  return {posts, waits, deps: {now: () => t, wait: async ms => {waits.push(ms); t += ms;},
    request: async (path, method, body) => {
      if (method === 'POST') {posts.push({path, body}); return {};}
      return {protection_rules: [{type:'wait_timer', wait_timer:rule}]};
    }}};
}
test('uses the wait rule and dispatches one successor at the next planned time', async () => {
  const s=setup(); const result=await clockTick(env,s.deps);
  assert.equal(result.lag_seconds,0); assert.deepEqual(s.waits,[50_000]);
  assert.equal(s.posts.length,1);
  assert.deepEqual(s.posts[0].body.inputs,{planned_for:new Date(PLAN+600_000).toISOString(),remaining:'2'});
});
test('the final tick stops without creating a successor', async () => {
  const s=setup(); const result=await clockTick({...env,REMAINING:'1'},s.deps);
  assert.equal(result.within_tolerance,true); assert.equal(s.posts.length,0);
});
test('a late event is recorded as failure and does not start another chain', async () => {
  const s=setup({start:PLAN+121_000}); const result=await clockTick(env,s.deps);
  assert.equal(result.within_tolerance,false); assert.equal(s.posts.length,0);
});
test('a missing wait rule cannot create a rapid dispatch loop', async () => {
  const s=setup({rule:0}); await assert.rejects(clockTick(env,s.deps),/wait rule/);
  assert.equal(s.posts.length,0);
});
test('an early job never consumes ten minutes of runner time', async () => {
  const s=setup({start:PLAN-600_000}); await assert.rejects(clockTick(env,s.deps),/too early/);
  assert.deepEqual(s.waits,[]); assert.equal(s.posts.length,0);
});
test('unbounded and invalid chains are rejected', async () => {
  for(const count of ['0','4','1000','NaN']) {
    const s=setup(); await assert.rejects(clockTick({...env,REMAINING:count},s.deps),/one to three/);
    assert.equal(s.posts.length,0);
  }
});
