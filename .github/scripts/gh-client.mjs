// gh-client.mjs —— 独立 fetch REST 封装（契约 A）：
//   ① 抛错对象暴露 .status（labeler 依赖 err.status===422/!==404 控制流，原 bot-review-labeler.yml:237/:803/:1121）；
//   ② 实现 Link 头全量分页，复刻 github.paginate 的 filter:'all' 语义（原码 7+ 处 paginate）。
//   严禁复用 auto-fill makeCliDeps（它抛 new Error 无 .status、无分页 → 照搬即致 422/404 升级硬崩 + 截断误判）。
//   base = process.env.GITHUB_API_URL || 'https://api.github.com'，Bearer = process.env.GITHUB_TOKEN。
//   零依赖：仅 Node 内置 + 全局 fetch（Node 18+，runner v22）。可脱离引擎本地运行（注入 fetchImpl 亦供测试）。

const DEFAULT_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';

// 路由表：namespace.method → [HTTP method, path 模板]，逐一对齐 labeler 调用面（octokit 端点语义）。
const ROUTES = {
  issues: {
    listLabelsForRepo: ['GET', '/repos/{owner}/{repo}/labels'],
    createLabel: ['POST', '/repos/{owner}/{repo}/labels'],
    listLabelsOnIssue: ['GET', '/repos/{owner}/{repo}/issues/{issue_number}/labels'],
    addLabels: ['POST', '/repos/{owner}/{repo}/issues/{issue_number}/labels'],
    removeLabel: ['DELETE', '/repos/{owner}/{repo}/issues/{issue_number}/labels/{name}'],
    listComments: ['GET', '/repos/{owner}/{repo}/issues/{issue_number}/comments'],
    createComment: ['POST', '/repos/{owner}/{repo}/issues/{issue_number}/comments'],
    updateComment: ['PATCH', '/repos/{owner}/{repo}/issues/comments/{comment_id}'],
    get: ['GET', '/repos/{owner}/{repo}/issues/{issue_number}'],
    listEventsForTimeline: ['GET', '/repos/{owner}/{repo}/issues/{issue_number}/timeline'],
  },
  pulls: {
    get: ['GET', '/repos/{owner}/{repo}/pulls/{pull_number}'],
    listReviews: ['GET', '/repos/{owner}/{repo}/pulls/{pull_number}/reviews'],
    listComments: ['GET', '/repos/{owner}/{repo}/pulls/{pull_number}/comments'],
  },
  repos: {
    get: ['GET', '/repos/{owner}/{repo}'],
    listCommitStatusesForRef: ['GET', '/repos/{owner}/{repo}/commits/{ref}/statuses'],
    listPullRequestsAssociatedWithCommit: ['GET', '/repos/{owner}/{repo}/commits/{commit_sha}/pull-requests'],
  },
  checks: {
    listForRef: ['GET', '/repos/{owner}/{repo}/commits/{ref}/check-runs'],
  },
  actions: {
    getWorkflowRun: ['GET', '/repos/{owner}/{repo}/actions/runs/{run_id}'],
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 解析 Link 头中的 rel="next" URL（全量分页游标）。
function linkNext(headers) {
  const link = typeof headers?.get === 'function' ? headers.get('link') : headers?.link;
  if (!link) return null;
  for (const seg of String(link).split(',')) {
    const m = /<([^>]+)>;\s*rel="next"/.exec(seg);
    if (m) return m[1];
  }
  return null;
}

function buildPath(template, params) {
  const used = new Set((template.match(/\{\w+\}/g) || []).map((s) => s.slice(1, -1)));
  let missing = null;
  const path = template.replace(/\{(\w+)\}/g, (_, k) => {
    const v = params?.[k];
    if (v === undefined || v === null) { missing = missing || k; return ''; }
    return encodeURIComponent(String(v));
  });
  if (missing !== null) throw new Error(`gh-client: missing path param {${missing}}`);
  return { path, used };
}

function appendQuery(path, query) {
  const entries = Object.entries(query).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return path;
  const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
  return `${path}${path.includes('?') ? '&' : '?'}${qs}`;
}

export function createGitHubClient({ token, baseUrl, fetchImpl, maxRetries, maxBackoffMs } = {}) {
  const base = baseUrl || globalThis.process?.env?.GITHUB_API_URL || DEFAULT_BASE;
  const auth = token ?? globalThis.process?.env?.GITHUB_TOKEN ?? '';
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('gh-client: no fetch available (Node 18+ or pass fetchImpl)');
  const retries = Number.isInteger(maxRetries) ? maxRetries : 2;
  // 429 单次退避上界（PR-Reviewer E-A）：滥用限流可发 Retry-After: 3600，无上界退避＝单次 sleep 1 小时
  //   ×重试次数 → sync-labels job 接近默认超时。钳制为有限值（缺省 30s），不吞重试语义（钳后仍重试）。
  const capMs = Number.isInteger(maxBackoffMs) ? maxBackoffMs : 30_000;

  async function send(method, path, body) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
    };
    if (auth) headers.Authorization = `Bearer ${auth}`;
    const init = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let attempt = 0;
    while (true) {
      const res = await doFetch(`${base}${path}`, init);
      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
      // 429 退避：尊重 Retry-After 但钳制到 capMs（E-A 活性上界），重试至多 retries 次；耗尽后按下方统一抛错（不吞成成功）。
      if (res.status === 429 && attempt < retries) {
        const ra = Number(res.headers?.get?.('retry-after') || '0');
        const waitMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, capMs) : 0;
        await sleep(waitMs);
        attempt += 1;
        continue;
      }
      if (!res.ok) {
        // 关键：抛错对象携带 .status（422/404/429 控制流依赖它，契约 A）。
        const msg = data && typeof data.message === 'string' ? `: ${data.message}` : '';
        const err = new Error(`gh-client ${method} ${path} -> ${res.status}${msg}`);
        err.status = res.status;
        err.response = data;
        throw err;
      }
      return { status: res.status, data, headers: res.headers, url: `${base}${path}` };
    }
  }

  function request(method, template, params = {}) {
    const { path, used } = buildPath(template, params);
    const query = {};
    const body = {};
    for (const [k, v] of Object.entries(params)) {
      if (used.has(k)) continue;
      if (method === 'GET' || method === 'DELETE') query[k] = v;
      else body[k] = v;
    }
    const finalPath = appendQuery(path, query);
    return send(method, finalPath, method === 'GET' || method === 'DELETE' ? undefined : body);
  }

  // paginate(endpointFn, params)：跟随 Link rel="next" 逐页累加，复刻 github.paginate filter:'all'。
  //   endpointFn 须返回 {data, headers}（即 rest.ns.method）；data 兼容裸数组与 {check_runs/reviews/comments} 包裹。
  //   防呆上界： pathological 恒 next 的 Link 头不得使循环失控——超过 MAX_PAGES 即 fail-loud（绝不静默截断，
  //   截断会误判 approved/pending，契约 A）；GitHub 单端点 100×1000＝10 万项，远超真实审查/check-run 量。
  async function paginate(endpointFn, params = {}) {
    if (typeof endpointFn !== 'function') throw new Error('gh-client.paginate: endpoint function required');
    const MAX_PAGES = 1000;
    const perPage = params.per_page || 100;
    let page = 1;
    let guard = 0;
    const out = [];
    while (true) {
      const res = await endpointFn({ ...params, per_page: perPage, page });
      const arr = Array.isArray(res.data) ? res.data
        : (res.data?.check_runs || res.data?.reviews || res.data?.comments || []);
      out.push(...arr);
      const next = linkNext(res.headers);
      if (!next) break;
      const pm = /[?&]page=(\d+)/.exec(next);
      page = pm ? Number(pm[1]) : page + 1;
      if (++guard >= MAX_PAGES) {
        const err = new Error(`gh-client.paginate exceeded ${MAX_PAGES} pages (疑似 Link 环回/异常分页)`);
        err.status = 500;
        throw err;
      }
    }
    return out;
  }

  const rest = {};
  for (const [ns, methods] of Object.entries(ROUTES)) {
    rest[ns] = {};
    for (const [name, [method, template]] of Object.entries(methods)) {
      rest[ns][name] = (params) => request(method, template, params || {});
    }
  }

  return { rest, paginate, request };
}
