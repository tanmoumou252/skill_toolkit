// build-status-badges.mjs — 状态评论徽章/图标资产生成器（一次性入库，产物冻结）
// 运行：node checks/build-status-badges.mjs   产物：.github/assets/badges/*.svg
// 规则：圆角形态 flat（rx=3）/ 直角 plastic（rx=0）；文本 HTML 实体转义防注入；
//       图标为 octicon 官方 path 着色 #57606a；新增枚举必须连资产一起补（缺文件名映射即抛错）。
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'assets', 'badges');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// 画布宽度按逐字符实际渲染宽度计算（防首尾缺字）：全角字符（CJK）宽≈字号 11px，
// 半角（ASCII）宽≈0.66×字号；再留左右 padding 12px。禁止按固定系数估——中文标签
// 曾因按 ASCII 系数估宽被视口裁剪首尾（实测缺陷）。
const textWidth = (s, fontSize) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e7f ? fontSize : fontSize * 0.66), 0);
const flat = (label, color, opts = {}) => {
  const bold = opts.bold ? ` font-weight="bold"` : '';
  const fontSize = opts.fontSize ?? 11;
  const w = opts.width ?? Math.ceil(textWidth(label, fontSize)) + 24;
  const h = opts.height ?? 20;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="3" fill="#${color}"/><text x="${w / 2}" y="${h / 2 + 4}" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="${fontSize}"${bold} fill="#fff" text-anchor="middle">${esc(label)}</text></svg>`;
};
const ICONS = {
  'icon-git-pull-request': "M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z",
  'icon-tasklist': "M2 2h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm4.655 8.595a.75.75 0 0 1 0 1.06L4.03 14.28a.75.75 0 0 1-1.06 0l-1.5-1.5a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215l.97.97 2.095-2.095a.75.75 0 0 1 1.06 0ZM9.75 2.5h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1 0-1.5Zm0 5h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1 0-1.5Zm0 5h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1 0-1.5Zm-7.25-9v3h3v-3Z",
  'icon-pencil': "M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z",
  'icon-file': "M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z",
  'icon-link-external': "M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z",
  'icon-code': "m11.28 3.22 4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L13.94 8l-3.72-3.72a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215Zm-6.56 0a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L2.06 8l3.72 3.72a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L.47 8.53a.75.75 0 0 1 0-1.06Z",
};
// 与 labeler BOT_STATE_META / BOT_RISK_LABELS / BOT_VERDICT_META / AUTOFILL_META 逐字同步（单一事实源在 labeler，此处为冻结镜像；改任一侧必须同步另一侧）
const BADGES = [
  // 状态（flat 圆角）
  ['状态-缺席-8c959f', '状态-缺席', '8c959f', 'flat'],
  ['状态-跳过审查-8c959f', '状态-跳过审查', '8c959f', 'flat'],
  ['状态-审查中-d97706', '状态-审查中', 'd97706', 'flat'],
  ['状态-审查完成-2da44e', '状态-审查完成', '2da44e', 'flat'],
  ['状态-审查失败-crimson', '状态-审查失败', 'dc3545', 'flat'],
  ['状态-需人工触发-d97706', '状态-需人工触发', 'd97706', 'flat'],
  // 风险评级（flat）
  ['风险评级-高-d93f0b', '风险评级-高', 'd93f0b', 'flat'],
  ['风险评级-中-d97706', '风险评级-中', 'd97706', 'flat'],
  ['风险评级-低-2da44e', '风险评级-低', '2da44e', 'flat'],
  // 结论 + 等级（flat）
  ['本轮结论-等待审查结果-fbca04', '本轮结论-等待审查结果', 'fbca04', 'flat'],
  ['本轮结论-无可用审查来源-8c959f', '本轮结论-无可用审查来源', '8c959f', 'flat'],
  ['本轮结论-全部必需_Bot_已核准-2da44e', '本轮结论-全部必需Bot已核准', '2da44e', 'flat'],
  ['本轮结论-存在风险发现-d93f0b', '本轮结论-存在风险发现', 'd93f0b', 'flat'],
  ['本轮结论-部分_Bot_已评级-fbca04', '本轮结论-部分Bot已评级', 'fbca04', 'flat'],
  ['风险等级-低-2da44e', '风险等级-低', '2da44e', 'flat'],
  ['风险等级-中-d97706', '风险等级-中', 'd97706', 'flat'],
  ['风险等级-高-d93f0b', '风险等级-高', 'd93f0b', 'flat'],
  ['风险等级-严重-dc3545', '风险等级-严重', 'dc3545', 'flat'],
  // auto-fill 进度（plastic 直角）
  ['已更新-teal', '已更新', '00b8a9', 'plastic'],
  ['已生成_但head过期-purp', '已生成 但head过期', '9d7cd8', 'plastic'],
  ['未生成-blueviolet', '未生成', '8a2be2', 'plastic'],
  ['失败-crimson', '失败', 'dc3545', 'plastic'],
];
mkdirSync(OUT, { recursive: true });
let failures = 0;
for (const [file, label, color, shape] of BADGES) {
  const svg = flat(label, color, {});
  // 自检：画布宽必须 ≥ 文本实测宽 + 左右 padding（防首尾缺字回归）；不达标即失败退出。
  const m = svg.match(/width="(\d+)"/);
  const w = Number(m?.[1] || 0);
  const need = Math.ceil(textWidth(label, 11)) + 16;
  if (w < need) { console.error(`FAIL ${file}: canvas=${w} < text=${need}`); failures += 1; }
  // 输出文件名必须带 shape 后缀（-flat/-plastic），与 labeler BADGE_FILES 登记表及
  //   工作流 BADGE() 引用形态逐字一致——缺后缀 = 全部静态徽章 404（实测缺陷）。
  writeFileSync(join(OUT, `${file}-${shape}.svg`), svg);
}
for (const [name, d] of Object.entries(ICONS)) {
  writeFileSync(join(OUT, `${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="${d}" fill="#57606a"/></svg>`);
}
// HEAD 徽章模板（运行时按 sha 动态绘制写入的形态锚，本脚本不产出）
console.log(`WROTE ${BADGES.length} badges + ${Object.keys(ICONS).length} icons -> ${OUT}`);
if (failures > 0) { console.error(`FAILURES=${failures}`); process.exitCode = 1; }
