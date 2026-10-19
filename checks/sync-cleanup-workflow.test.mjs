import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const repoRoot = path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..', '..');
const syncWfPath = path.join(repoRoot, '.github', 'workflows', 'sync-upstream.yml');
const cleanupWfPath = path.join(repoRoot, '.github', 'workflows', 'pr-cleanup-reset.yml');
const syncShPath = path.join(repoRoot, '.github', 'scripts', 'sync-upstream.sh');
const cleanupShPath = path.join(repoRoot, '.github', 'scripts', 'pr-cleanup-reset.sh');
// 存在性守卫读取：.sh 在场即脱离引擎的纯 shell 本体；缺席返回 '' 而非 ENOENT 击穿套件，
//   使 Red 由「YAML 仍内联未迁出」的形状断言（AssertionError）产生，非脚手架崩溃。
const readIfExists = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');

test('Static contract: inline shell externalized to .sh, YAML run lines carry zero interpolation (anti-drift + anti-injection)', () => {
  const syncWfYml = fs.readFileSync(syncWfPath, 'utf8');
  const cleanupWfYml = fs.readFileSync(cleanupWfPath, 'utf8');
  const syncSh = readIfExists(syncShPath);
  const cleanupSh = readIfExists(cleanupShPath);

  // 引擎面收口：main run 块改为单行 `run: bash .github/scripts/<name>.sh`，业务逻辑不再内联 YAML。
  //   本断言为 Red 立点（重构前 YAML 仍内联 shell，此处必抛 AssertionError，非 Cannot-find-module）。
  assert.ok(/run:\s*bash \.github\/scripts\/sync-upstream\.sh\b/.test(syncWfYml), 'sync workflow must delegate to sync-upstream.sh (inline shell externalized)');
  assert.ok(/run:\s*bash \.github\/scripts\/pr-cleanup-reset\.sh\b/.test(cleanupWfYml), 'cleanup workflow must delegate to pr-cleanup-reset.sh (inline shell externalized)');

  // 凭证选择原语（URL 内嵌 token）只存在于 .sh，绝不再内联 YAML（迁移完成的在场/缺席双向锁）。
  assert.ok(!syncWfYml.includes('x-access-token'), 'sync workflow YAML must not embed push credentials inline (moved to .sh)');
  assert.ok(syncSh.includes('x-access-token'), 'sync-upstream.sh carries the push-credential selection primitive');
  assert.ok(!cleanupWfYml.includes('x-access-token'), 'cleanup workflow YAML must not embed push credentials inline (moved to .sh)');
  assert.ok(cleanupSh.includes('x-access-token'), 'pr-cleanup-reset.sh carries the push-credential selection primitive');

  // 反注入闸：.sh 是脱离引擎的纯 shell，绝不含 ${{ }} GitHub Actions 插值。
  assert.ok(!syncSh.includes('${{'), 'sync-upstream.sh must not contain GitHub Actions interpolation');
  assert.ok(!cleanupSh.includes('${{'), 'pr-cleanup-reset.sh must not contain GitHub Actions interpolation');

  // overlay 整目录命令迁入 .sh（杜绝 MODULE_NOT_FOUND，原子整体覆盖）。
  assert.ok(/checkout origin\/hub -- \.github\/(?![\w.])/.test(syncSh), 'sync-upstream.sh overlays the whole .github/ automation layer');
  // 不得退回"单文件 cherry-pick"导致配套 mjs/模板缺失的旧形态（.sh 与 YAML 双向锁）。
  assert.ok(!/checkout origin\/hub -- \.github\/workflows\//.test(syncSh), 'sync-upstream.sh must NOT cherry-pick only a single workflow file');
  assert.ok(!/checkout origin\/hub -- \.github\/workflows\//.test(syncWfYml), 'sync workflow YAML must NOT cherry-pick only a single workflow file');
  // 旧 pr-cleanup.yml 名称零残留（YAML + .sh）。
  assert.ok(!/\bpr-cleanup\.yml\b/.test(syncWfYml), 'sync workflow must NOT reference the stale pr-cleanup.yml name');
  assert.ok(!/\bpr-cleanup\.yml\b/.test(syncSh), 'sync-upstream.sh must NOT reference the stale pr-cleanup.yml name');
  // 控制分支不得硬编码 main：YAML checkout 与 .sh git 操作均不得引用 origin/main 或 ref: main。
  assert.ok(!/ref:\s*main\b/.test(syncWfYml), 'sync workflow must not hardcode main as checkout ref');
  assert.ok(!/origin\/main\b/.test(syncWfYml), 'sync workflow YAML must not reference origin/main');
  assert.ok(!/origin\/main\b/.test(syncSh), 'sync-upstream.sh must not reference origin/main');
  // fork-parent 自动探测原语（curl | jq .parent.full_name）迁入各自 .sh。
  assert.ok(/\.parent\.full_name/.test(syncSh), 'sync-upstream.sh carries fork-parent detection');
  assert.ok(/\.parent\.full_name/.test(cleanupSh), 'pr-cleanup-reset.sh carries fork-parent detection');
  // 探测失败必须保留错误形态（E-B，PR-Reviewer r3 Minor 可观测性）：`|| true` 兜住 set -e 抢跑后，
  //   须以 curl 退出码/wc -c 区分「网络失败（连接拒绝/超时/404）」与「非 fork（parent 缺席）」两条路径，
  //   绝不把网络错误静默折叠进『本仓库不是 fork』诊断（否则本地 WSL 缺 jq/断网时误导排查方向）。
  for (const [name, sh] of [['sync-upstream.sh', syncSh], ['pr-cleanup-reset.sh', cleanupSh]]) {
    assert.ok(/curl_exit=\$\{PIPESTATUS\[0\]\}/.test(sh), `${name} must capture curl exit code via PIPESTATUS`);
    assert.ok(/探测请求失败|probe request failed/.test(sh), `${name} must log a distinct network-failure diagnostic before the not-a-fork fallback`);
  }

  // 清理工作流触发面（仍属 YAML 引擎面）：仅 pull_request_target，禁止冗余 pull_request 双触发。
  const onBlock = cleanupWfYml.split(/^jobs:/m)[0];
  assert.ok(/pull_request_target:/.test(onBlock), 'cleanup workflow uses pull_request_target');
  assert.ok(!/^\s{2}pull_request:/m.test(onBlock), 'cleanup workflow must NOT declare redundant pull_request trigger');

  // 并发防护（PR 审查回灌·发现 4）：sync 与 cleanup 都强推 wip——两工作流必须共享同一
  //   job 级 concurrency 组（ephemeral-staging-<repo>）+ queue:max + cancel-in-progress:false，
  //   否则并发运行互相覆盖（cleanup 的回退被随后 sync 覆盖，或反之）。
  const CONC_RE = /concurrency:\s*\n\s*group: ephemeral-staging-\$\{\{ github\.repository \}\}\s*\n\s*queue:\s*max\s*\n\s*cancel-in-progress:\s*false/;
  assert.ok(CONC_RE.test(syncWfYml), 'sync workflow must share the ephemeral-staging concurrency group');
  assert.ok(CONC_RE.test(cleanupWfYml), 'cleanup workflow must share the ephemeral-staging concurrency group');

  // 供应链闸（外部审查回灌·F2）：wip 上的工作流以仓库级凭证运行——上游 dev/PR 合并夹带的
  //   .github/workflows 不得存活到 wip：两脚本 overlay 前必须整目录清除 .github/workflows 再叠加；
  //   cleanup YAML 不得把仓库级 PAT（secrets.PUSH_TOKEN）注入 wip 执行面（回退 GITHUB_TOKEN）。
  for (const [name, sh] of [['sync-upstream.sh', syncSh], ['pr-cleanup-reset.sh', cleanupSh]]) {
    assert.ok(/git rm -rq --ignore-unmatch \.github\/workflows/.test(sh), `${name} must purge upstream-carried .github/workflows before overlay`);
    assert.ok(sh.indexOf('git rm -rq --ignore-unmatch .github/workflows') < sh.indexOf('git checkout origin/hub -- .github/'), `${name} purge must precede the origin/hub overlay`);
  }
  assert.ok(!cleanupWfYml.includes('secrets.PUSH_TOKEN'), 'cleanup workflow must not inject repo-level PUSH_TOKEN into the wip execution surface');
  assert.ok(!cleanupWfYml.includes('GH_TOKEN_PAT'), 'cleanup workflow must not alias the repo-level PAT');

  // 分支名安全闸（外部审查回灌·F3）：workflow_dispatch 入参直通 refs/heads 强推面——
  //   首次 push 前必须校验：不合 ref-format 的值拒绝；任一分支名为 hub 拒绝（覆盖控制面）；
  //   MIRROR==STAGING 拒绝（基线与沙盒互覆）。校验须先于脚本内首次 git push。
  {
    assert.ok(/check_branch_name/.test(syncSh), 'sync script must carry the branch-name validator');
    assert.ok(/不得为 hub/.test(syncSh), 'sync script must reject hub as MIRROR/STAGING');
    assert.ok(/与 STAGING_BRANCH 相同|same as STAGING/.test(syncSh) || /STAGING_BRANCH.*相同/.test(syncSh), 'sync script must reject MIRROR==STAGING');
    const firstPush = syncSh.indexOf('git push "${PUSH_URL}"');
    const gateStart = syncSh.indexOf('check_branch_name()');
    assert.ok(gateStart !== -1 && firstPush !== -1 && gateStart < firstPush, 'branch gate must be defined before the first push');
  }
});

test('Architectural Regression: Control Branch (hub) + Mirror (dev) + Ephemeral Staging (wip)', async (t) => {
  const UP = 'dev';     // 上游同步源分支
  const WIP = 'wip';    // PR 模拟临时分支
  const HUB = 'hub';    // 本仓库默认控制分支
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-fixture-'));
  const upstreamBare = path.join(tmpDir, 'upstream.git');
  const forkBare = path.join(tmpDir, 'fork.git');
  const workDir = path.join(tmpDir, 'work');

  try {
    // 1. 初始化上游仓库，仅有分支 dev
    execSync(`git init --bare "${upstreamBare}"`);
    const initUpstream = path.join(tmpDir, 'init-upstream');
    fs.mkdirSync(initUpstream);
    execSync(`git init -b ${UP} "${initUpstream}"`);
    fs.writeFileSync(path.join(initUpstream, 'app.js'), 'console.log("upstream v1");');
    execSync(`git -C "${initUpstream}" config user.email "upstream@corp.com"`);
    execSync(`git -C "${initUpstream}" config user.name "Upstream Dev"`);
    execSync(`git -C "${initUpstream}" add .`);
    execSync(`git -C "${initUpstream}" commit -m "upstream initial"`);
    execSync(`git -C "${initUpstream}" remote add origin "${upstreamBare}"`);
    execSync(`git -C "${initUpstream}" push origin ${UP}`);

    // 2. 初始化本仓库：默认分支设为 hub（控制中心，仅工作流）
    execSync(`git init --bare -b ${HUB} "${forkBare}"`);
    const initFork = path.join(tmpDir, 'init-fork');
    fs.mkdirSync(initFork);
    execSync(`git init -b ${HUB} "${initFork}"`);
    // 控制中心 hub 携带完整自动化层（4 工作流 + 本地脚本 + 模板），供 overlay 整目录复制取证——
    //   杜绝 copy-stub 掩盖真实 .sh 命令序列与解耦后新增脚本（PR-Reviewer E-3 夹具保真）。
    const ghDir = path.join(initFork, '.github');
    fs.mkdirSync(path.join(ghDir, 'workflows'), { recursive: true });
    fs.mkdirSync(path.join(ghDir, 'scripts'), { recursive: true });
    for (const f of ['sync-upstream.yml', 'pr-cleanup-reset.yml', 'bot-review-labeler.yml', 'auto-fill-pr.yml']) {
      fs.copyFileSync(path.join(repoRoot, '.github', 'workflows', f), path.join(ghDir, 'workflows', f));
    }
    for (const f of ['auto-fill-pr.mjs', 'bot-review-labeler.mjs', 'gh-client.mjs', 'sync-upstream.sh', 'pr-cleanup-reset.sh']) {
      fs.copyFileSync(path.join(repoRoot, '.github', 'scripts', f), path.join(ghDir, 'scripts', f));
    }
    fs.writeFileSync(path.join(ghDir, 'pull_request_template.md'), '# template');
    execSync(`git -C "${initFork}" config user.email "bot@test.com"`);
    execSync(`git -C "${initFork}" config user.name "Actions Bot"`);
    execSync(`git -C "${initFork}" add .`);
    execSync(`git -C "${initFork}" commit -m "initialize control hub branch"`);
    execSync(`git -C "${initFork}" remote add origin "${forkBare}"`);
    execSync(`git -C "${initFork}" push origin ${HUB}`);

    // 3. 模拟 Actions Runner 执行环境
    execSync(`git clone "${forkBare}" "${workDir}"`);
    execSync(`git -C "${workDir}" config user.email "bot@test.com"`);
    execSync(`git -C "${workDir}" config user.name "Actions Bot"`);
    execSync(`git -C "${workDir}" remote add upstream "${upstreamBare}"`);

    // 真实脚本执行环境（PR 审查回灌·脚本保真）：sync/cleanup 步骤不再用 JS 模拟，
    //   而是通过 bash 执行仓库内的真实 sync-upstream.sh / pr-cleanup-reset.sh，
    //   注入测试所需 env——PUSH_URL_OVERRIDE 指向本地 bare 仓库（本地路径直接作推送 URL），
    //   GITHUB_REPOSITORY/TARGET_BRANCH 等按 runner 自带 env 口径注入。凭证探测
    //   （fork-parent curl）因 UPSTREAM_REPO 显式注入被跳过，不触网。
    const syncSh = path.join(repoRoot, '.github', 'scripts', 'sync-upstream.sh');
    const cleanupSh = path.join(repoRoot, '.github', 'scripts', 'pr-cleanup-reset.sh');
    const shEnv = (extra) => ({
      ...process.env,
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_TOKEN: 'test-token',
      GH_TOKEN_PAT: '',
      PUSH_URL_OVERRIDE: forkBare,
      UPSTREAM_REPO: 'upstream-corp/dev',
      UPSTREAM_URL_OVERRIDE: upstreamBare,
      ...extra,
    });

    await t.test('Step 1: real sync-upstream.sh runs on hub, spawns wip from dev and carries automation layer', () => {
      // 上游更新到 v2
      fs.writeFileSync(path.join(initUpstream, 'app.js'), 'console.log("upstream v2");');
      execSync(`git -C "${initUpstream}" add .`);
      execSync(`git -C "${initUpstream}" commit -m "upstream v2"`);
      execSync(`git -C "${initUpstream}" push origin ${UP}`);

      // 真实执行 sync-upstream.sh（CI 引擎解耦后的本地可运行面）：
      //   脚本内 git 操作作用于 workDir（runner 检出区），推送经 PUSH_URL_OVERRIDE 落到本地 forkBare。
      //   注意脚本使用的 UPSTREAM_BRANCH/MIRROR_BRANCH/STAGING_BRANCH 缺省与夹具分支名一致（dev/dev/wip）。
      execFileSync('bash', [syncSh], {
        cwd: workDir,
        env: shEnv({ UPSTREAM_BRANCH: UP, MIRROR_BRANCH: UP, STAGING_BRANCH: WIP }),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // 验证：默认分支依然是 hub，wip 分支建立且具备全套自动化层（yml+脚本+模板，非单文件）
      const defaultBranch = execSync(`git --git-dir="${forkBare}" symbolic-ref HEAD`).toString().trim();
      assert.strictEqual(defaultBranch, `refs/heads/${HUB}`, 'Default branch remains hub');
      assert.doesNotThrow(() => execSync(`git --git-dir="${forkBare}" rev-parse --verify refs/heads/${WIP}`));
      // 配套自动化层必须同在 wip：解耦后四个本地脚本 + bot 工作流 + 模板随整目录 overlay 一并携带
      //   （auto-fill-pr.yml ref:base_ref、labeler checkout ref:default_branch 检出时方能取到配套脚本）。
      for (const p of [
        '.github/workflows/pr-cleanup-reset.yml',
        '.github/workflows/sync-upstream.yml',
        '.github/workflows/bot-review-labeler.yml',
        '.github/scripts/auto-fill-pr.mjs',
        '.github/scripts/bot-review-labeler.mjs',
        '.github/scripts/gh-client.mjs',
        '.github/scripts/sync-upstream.sh',
        '.github/scripts/pr-cleanup-reset.sh',
        '.github/pull_request_template.md',
      ]) {
        assert.doesNotThrow(
          () => execSync(`git --git-dir="${forkBare}" rev-parse --verify refs/heads/${WIP}:${p}`),
          `wip must carry ${p} (atomic automation layer)`
        );
      }
    });

    await t.test('Step 2: PR from feat into wip merged -> real pr-cleanup-reset.sh resets wip parent to dev with automation layer intact', () => {
      const FEAT = 'feat/#1';
      // 从上游切出特性分支
      execSync(`git -C "${workDir}" checkout -b "${FEAT}" upstream/${UP}`);
      fs.writeFileSync(path.join(workDir, 'feat.js'), 'console.log("my feature c");');
      execSync(`git -C "${workDir}" add .`);
      execSync(`git -C "${workDir}" commit -m "feature commit"`);
      execSync(`git -C "${workDir}" push origin "${FEAT}"`);
      const featSha = execSync(`git -C "${workDir}" rev-parse "${FEAT}"`).toString().trim();
      // devSha 从 forkBare 直读（dev 镜像分支由 Step 1 的真实 sync 脚本推送落库）；
      //   workDir 的 origin/dev 远程跟踪引用在真实 sync 流程后不保证存在，不作取数面。
      const devSha = execSync(`git --git-dir="${forkBare}" rev-parse refs/heads/${UP}`).toString().trim();

      // 模拟 PR 合并：feat/#1 合并入 wip（merge commit，即 a222）
      execSync(`git -C "${workDir}" checkout ${WIP}`);
      execSync(`git -C "${workDir}" merge "${FEAT}" --no-ff -m "Merge PR feat into wip"`);
      execSync(`git -C "${workDir}" push origin ${WIP}`);
      const mergedSha = execSync(`git -C "${workDir}" rev-parse ${WIP}`).toString().trim();
      assert.notStrictEqual(mergedSha, devSha, 'wip is polluted by the merge before cleanup');

      // 真实执行 pr-cleanup-reset.sh：wip 强推回退到镜像分支 dev 后，脚本从 origin/hub
      //   叠加 .github/ 自动化层并提交（PR 审查回灌：清理与同步并发覆盖防护 + 脚本自愈面）。
      execFileSync('bash', [cleanupSh], {
        cwd: workDir,
        env: shEnv({ TARGET_BRANCH: WIP, PR_HEAD: FEAT, MIRROR_BRANCH: UP }),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // 断言 1: wip 分支仍在场（不删除，无真空期）
      assert.doesNotThrow(() => execSync(`git --git-dir="${forkBare}" rev-parse --verify refs/heads/${WIP}`));

      // 断言 2（契约修订，PR 审查回灌）：清理 = 重置 + overlay 提交两步——wip 顶端是 overlay 提交，
      //   其**父提交**是镜像分支 dev（合并内容全部丢弃、自动化层随 overlay 在场）。
      //   本夹具中镜像 dev 恒不携带 .github/（直接推自上游），overlay 提交必然发生——
      //   no-op 形态（head=dev）即「漏提交」缺陷复发，不接受为合法终态（防脚本未跟踪面 bug 回归）。
      //   旧断言 wipAfter === devSha 只覆盖漏提交形态，属过时口径，已废。
      const wipHead = execSync(`git --git-dir="${forkBare}" rev-parse refs/heads/${WIP}`).toString().trim();
      // 用 ~1 而非 ^：execSync 在 Windows 经 cmd.exe 执行，^ 是转义元字符（会把 wip^ 吞成 wip）。
      const wipParent = execSync(`git --git-dir="${forkBare}" rev-parse "refs/heads/${WIP}~1"`).toString().trim();
      assert.notStrictEqual(wipHead, devSha, 'cleaned wip head must be the overlay commit (a no-op reset = missed-commit regression)');
      assert.strictEqual(wipParent, devSha, 'wip parent commit is dev (merge content dropped)');

      // 断言 3: 清理后 wip 仍携带全套自动化层（overlay 自 origin/hub 叠加回来的证明）
      for (const p of [
        '.github/workflows/pr-cleanup-reset.yml',
        '.github/scripts/auto-fill-pr.mjs',
        '.github/scripts/pr-cleanup-reset.sh',
        '.github/pull_request_template.md',
      ]) {
        assert.doesNotThrow(
          () => execSync(`git --git-dir="${forkBare}" rev-parse --verify refs/heads/${WIP}:${p}`),
          `cleaned wip must still carry ${p} (automation layer survives cleanup)`
        );
      }

      // 断言 4: 默认分支 hub 上的 sync 工作流毫发无损（定时器永久安全）
      const hubWorkflow = execSync(`git --git-dir="${forkBare}" rev-parse refs/heads/${HUB}:.github/workflows/sync-upstream.yml`).toString().trim();
      assert.ok(hubWorkflow, 'Control plane workflow in hub branch is 100% intact');

      // 断言 5: 特性分支 feat/#1 完好无损，未受影响
      const preservedFeatSha = execSync(`git --git-dir="${forkBare}" rev-parse refs/heads/${FEAT}`).toString().trim();
      assert.strictEqual(preservedFeatSha, featSha, 'Branch feat/#1 is preserved untouched');
    });

  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});