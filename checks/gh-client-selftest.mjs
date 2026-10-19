// gh-client.mjs 端点级测试：以注入的假 fetch 断言 Link 头全量分页累加、err.status===422/404/429 语义。
// 守 gh-client 自身（真实分页/status 面），不靠 bot-labeler harness 的 mock 注入。零依赖，仅 Node 内置。
import assert from 'node:assert/strict';
import { createGitHubClient } from '../.github/scripts/gh-client.mjs';

let failures = 0;
function check(name, fn) {
  return fn().then(
    () => { console.log(`OK   ${name}`); },
    (err) => { failures += 1; console.log(`FAIL ${name}: ${(err && (err.stack || err.message)) || String(err)}`); }
  );
}

// 脚本化假 fetch：按队列返回响应（fetch 语义：res.ok/res.status/res.headers.get/res.text）。
function makeFetch(script) {
  let i = 0;
  const state = { calls: 0, urls: [] };
  const fetchImpl = async (url, init) => {
    state.calls += 1;
    state.urls.push({ url, method: init?.method });
    const step = script[Math.min(i, script.length - 1)];
    i += 1;
    const headersStore = {};
    for (const [k, v] of Object.entries(step.headers || {})) headersStore[k.toLowerCase()] = v;
    const bodyText = typeof step.body === 'string' ? step.body : JSON.stringify(step.body ?? null);
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      headers: { get: (name) => headersStore[String(name).toLowerCase()] ?? null },
      text: async () => bodyText,
    };
  };
  return { fetchImpl, state };
}

// 1. 端点面：createGitHubClient 暴露 .rest.{issues,pulls,repos,checks,actions} 与 .paginate。
await check('gh-client-exposes-rest-namespaces-and-paginate', async () => {
  const { fetchImpl } = makeFetch([{ status: 200, ok: true, body: {} }]);
  const client = createGitHubClient({ token: 't', fetchImpl });
  assert.equal(typeof client.paginate, 'function');
  for (const [ns, methods] of [
    ['issues', ['listLabelsForRepo', 'createLabel', 'listLabelsOnIssue', 'addLabels', 'removeLabel', 'listComments', 'createComment', 'updateComment', 'get', 'listEventsForTimeline']],
    ['pulls', ['get', 'listReviews', 'listComments']],
    ['repos', ['get', 'listCommitStatusesForRef', 'listPullRequestsAssociatedWithCommit']],
    ['checks', ['listForRef']],
    ['actions', ['getWorkflowRun']],
  ]) {
    for (const m of methods) {
      assert.ok(client.rest?.[ns]?.[m] instanceof Function, `missing endpoint ${ns}.${m}`);
    }
  }
});

// 2. err.status===422（供 labeler :237 容错）：createLabel 422 → 抛出且 err.status 在场。
await check('gh-client-surfaces-422-status', async () => {
  const { fetchImpl } = makeFetch([{ status: 422, ok: false, body: { message: 'Label already exists' } }]);
  const client = createGitHubClient({ token: 't', fetchImpl });
  let thrown = null;
  try { await client.rest.issues.createLabel({ owner: 'o', repo: 'r', name: 'x', color: 'fff', description: '' }); }
  catch (e) { thrown = e; }
  assert.ok(thrown instanceof Error, 'expected a thrown error');
  assert.equal(thrown.status, 422);
});

// 3. err.status===404（供 labeler :803/:1121 removeLabel 容错）：removeLabel 404 → 抛出且 err.status 在场。
await check('gh-client-surfaces-404-status', async () => {
  const { fetchImpl } = makeFetch([{ status: 404, ok: false, body: { message: 'Not Found' } }]);
  const client = createGitHubClient({ token: 't', fetchImpl });
  let thrown = null;
  try { await client.rest.issues.removeLabel({ owner: 'o', repo: 'r', issue_number: 8, name: 'risk:high' }); }
  catch (e) { thrown = e; }
  assert.ok(thrown instanceof Error, 'expected a thrown error');
  assert.equal(thrown.status, 404);
});

// 4. Link 头全量分页累加（复刻 github.paginate filter:'all'）：两页 check_runs 累积为全量。
await check('gh-client-paginate-follows-link-next-and-accumulates', async () => {
  const { fetchImpl, state } = makeFetch([
    { status: 200, ok: true, headers: { link: '<https://api.github.com/repos/o/r/commits/SHA/check-runs?per_page=100&page=2>; rel="next"' }, body: { total: 3, check_runs: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] } },
    { status: 200, ok: true, headers: {}, body: { total: 3, check_runs: [{ id: 3, name: 'c' }] } },
  ]);
  const client = createGitHubClient({ token: 't', fetchImpl });
  const all = await client.paginate(client.rest.checks.listForRef, { owner: 'o', repo: 'r', ref: 'SHA', filter: 'all', per_page: 100 });
  assert.equal(Array.isArray(all), true);
  assert.equal(all.length, 3, 'accumulated across both pages');
  assert.deepEqual(all.map((x) => x.id), [1, 2, 3]);
  assert.equal(state.calls, 2, 'two pages fetched');
  assert.ok(/page=2/.test(state.urls[1].url), 'second request carries page=2');
});

// 5. 429 退避不吞：首个 429（Retry-After 0）后自动退避重试成功；请求未被静默丢弃。
await check('gh-client-429-backs-off-and-retries-not-swallow', async () => {
  const { fetchImpl, state } = makeFetch([
    { status: 429, ok: false, headers: { 'retry-after': '0' }, body: { message: 'rate limited' } },
    { status: 200, ok: true, headers: {}, body: { stargazers_count: 10 } },
  ]);
  const client = createGitHubClient({ token: 't', fetchImpl });
  const res = await client.rest.repos.get({ owner: 'o', repo: 'r' });
  assert.equal(res.status, 200);
  assert.equal(res.data.stargazers_count, 10);
  assert.equal(state.calls, 2, 'retried after 429');
});

// 5b. 429 重试耗尽仍暴露状态（不吞成成功/不无限重试）。
await check('gh-client-429-exhausted-surfaces-status', async () => {
  const { fetchImpl } = makeFetch([
    { status: 429, ok: false, headers: { 'retry-after': '0' }, body: { message: 'rate limited' } },
  ]);
  const client = createGitHubClient({ token: 't', fetchImpl, maxRetries: 1 });
  let thrown = null;
  try { await client.rest.repos.get({ owner: 'o', repo: 'r' }); }
  catch (e) { thrown = e; }
  assert.ok(thrown instanceof Error, 'expected a thrown error');
  assert.equal(thrown.status, 429);
});

// 5c（E-A 修正，PR-Reviewer r3 Minor）：429 退避必须带单次上界——滥用限流可发 Retry-After: 3600，
//   无上界退避＝单次 sleep 1 小时 ×重试次数 → sync-labels job 接近默认超时（活性 Minor）。
//   契约：单次退避至多 MAX_BACKOFF_MS（默认 30s）；上界钳制不吞重试（钳后仍重试，耗尽仍抛 .status=429）。
//   实测口径：注入 Retry-After: 3600，计时全流程耗时应远小于 3600s（实际上界钳制后 ≈30s×次数）；
//   测试用 maxBackoffMs=10 的注入配置验证钳制生效且重试语义不变。
await check('gh-client-429-backoff-capped-per-attempt', async () => {
  const { fetchImpl, state } = makeFetch([
    { status: 429, ok: false, headers: { 'retry-after': '3600' }, body: { message: 'abuse limit' } },
    { status: 200, ok: true, headers: {}, body: { stargazers_count: 10 } },
  ]);
  const client = createGitHubClient({ token: 't', fetchImpl, maxRetries: 2, maxBackoffMs: 10 });
  const t0 = Date.now();
  const res = await client.rest.repos.get({ owner: 'o', repo: 'r' });
  const elapsed = Date.now() - t0;
  assert.equal(res.status, 200);
  assert.equal(state.calls, 2, 'retried after capped backoff');
  assert.ok(elapsed < 5000, `backoff must be capped, got ${elapsed}ms (uncapped would be 3600s)`);
});
// 5d. 上界可注入性：缺省时上界生效（构造面接受 maxBackoffMs，缺省钳制为有限值——防 job 挂起）。
await check('gh-client-accepts-maxBackoffMs-option', async () => {
  const { fetchImpl, state } = makeFetch([
    { status: 429, ok: false, headers: { 'retry-after': '3600' }, body: { message: 'abuse limit' } },
    { status: 200, ok: true, headers: {}, body: { stargazers_count: 7 } },
  ]);
  // 缺省配置也应钳制（缺省上界 30s < 3600s）；计时上界给足余量但不允许 3600s 级挂起。
  const client = createGitHubClient({ token: 't', fetchImpl });
  const t0 = Date.now();
  const res = await client.rest.repos.get({ owner: 'o', repo: 'r' });
  const elapsed = Date.now() - t0;
  assert.equal(res.status, 200);
  assert.equal(res.data.stargazers_count, 7);
  assert.ok(elapsed < 60000, `default cap must apply, got ${elapsed}ms (uncapped would be 3600s)`);
});

console.log(failures === 0 ? 'GH-CLIENT-SELFTEST ALL OK' : 'GH-CLIENT-SELFTEST FAILURES=' + failures);
process.exit(failures === 0 ? 0 : 1);
