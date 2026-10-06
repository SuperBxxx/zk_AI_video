// 语义标注：把口播稿逐句标成结构化产物，让「选卡」有需求侧的依据。
//
// 为什么需要这一步（参考实现的原话复盘）：
//   「我是万里」被当成又一个论点关键词，配了全库能量最低的文字卡，
//   而库里 P0 级的人名条就在货架上、它的「适用」行明写「也用于自我介绍」，
//   却没人在那一刻查到它。三份独立评审都判这一镜无缺陷 ——
//   因为评审只核「摆上去的东西对不对」，不核「该摆的东西在不在」。
// 根因不是漏了某一类语义，而是**需求侧没有结构化产物**。
//
// 本脚本产出的 semantics.json 供三处使用：选卡（出候选）、覆盖闸（核该摆的在不在）、
// 评审（把语义标注与候选表一起给评审，rubric 才核得了「该摆的东西」）。
//
// 用法：bun scripts/semanticAnnotate.mjs --init --script <稿> --timestamps <t.json> --out <semantics.json>
//       bun scripts/semanticAnnotate.mjs --stats --out <semantics.json>
//       bun scripts/semanticAnnotate.mjs --sync-shots --out <semantics.json> --shots <shots.json>
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// 语义词表（封闭，26 词）—— 与参考实现的 VOCAB 对齐。
// 封闭是关键：词表一旦开放，「这句话在做什么」就会退化成自由文本，匹配与覆盖闸都失效。
const vocab = [
  ["钩子", "开场抓注意力的问题 / 反差 / 大数字"],
  ["论点", "一个主张或结论句（没有更具体的类型时归它）"],
  ["例证", "用实例 / 证据 / 素材支撑上一句"],
  ["数据", "数字、比例、增长、金额出现"],
  ["对比", "A vs B、前后、优劣并置"],
  ["列举", "并列几项（清单 / 要点 / 盘点），无先后"],
  ["定义", "解释一个术语 / 概念是什么"],
  ["步骤", "有先后顺序的流程 / 做法"],
  ["转折", "但是 / 然而 / 其实——推翻或修正前文"],
  ["设问", "抛出问题不立即回答"],
  ["金句", "可以单独摘出的总结句 / 名言"],
  ["标题", "片名 / 题眼 / 段落大标题（不是章节翻页）"],
  ["引用", "引别人的话或给出处"],
  ["自我介绍", "讲者报自己的名字 / 身份"],
  ["介绍他人", "介绍某个人 / 账号 / 嘉宾"],
  ["号召", "关注 / 点赞 / 订阅 / 去做某事"],
  ["时间地点", "时间戳、地点、事件坐标"],
  ["空间叙事", "在一个连续空间 / 地图 / 长画布里移动讲述"],
  ["机制", "多对一 / 因果 / 流程关系图（讲「怎么运作」）"],
  ["选择", "N 选一、决策、排除"],
  ["过程演示", "界面 / 操作按脚本自演"],
  ["章节", "分章 / 翻页 / 进度"],
  ["转场", "镜头边界处置（作用于前后两镜）"],
  ["强调", "在素材或文字上指哪看哪 / 划重点"],
  ["氛围", "素材当底床不当主体"],
  ["结尾", "收束 / 谢幕 / 落幕"],
];
const vocabWords = new Set(vocab.map(([word]) => word));

// 画面需求（供 ③ 采素材按需找料）
const needs = ["证据", "身份", "量化", "对比", "结构", "强调", "无"];

/**
 * 词法粗筛：三条硬规 + 若干提示。
 *
 * 参考实现强调「词法粗筛不是判断」——脚本的硬规只拦系统性漏标
 * （比如「我是 X」一定在自我介绍、「点赞/订阅」一定在号召、出现数量词一定涉数据），
 * 真正的判断在人。所以这里只给 hint，不直接下结论。
 */
function lexicalHints(text) {
  const hints = [];
  const hard = [];
  if (/^(我是|我叫|大家好，?我是)/.test(text) || /(我是|我叫)[\u4e00-\u9fff]{2,4}([，。！]|$)/.test(text)) {
    hard.push("自我介绍");
    hints.push("句首报名字/身份 → 自我介绍（硬规：这类有专设卡族，无替代物）");
  }
  if (/(点赞|关注|订阅|三连|转发|收藏)/.test(text)) {
    hard.push("号召");
    hints.push("出现号召词 → 号召（硬规：这类有专设卡族，无替代物）");
  }
  if (/\d|[一二三四五六七八九十百千万亿]/.test(text) && /(个|人|倍|%|％|万|亿|元|天|小时|分钟|年|月)/.test(text)) {
    hard.push("数据");
    hints.push("出现数量词 → 数据（硬规：数据句若需量化而没承载数字的卡，闸会 FAIL）");
  }
  if (/[？?]$/.test(text)) hints.push("以问号结尾 → 可能是设问");
  if (/^(但是|然而|其实|不过)/.test(text)) hints.push("转折词开头 → 可能是转折");
  if (/^(第一|第二|第三|首先|其次|最后|接下来)/.test(text)) hints.push("序数词 → 可能是步骤或列举");
  return { hints, hard };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function extractScriptSentences(scriptPath) {
  const raw = readFileSync(scriptPath, "utf8");
  if (scriptPath.endsWith(".json")) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.sentences)) return parsed.sentences.map(item => String(item?.text ?? item));
    if (typeof parsed?.text === "string") return [parsed.text];
  }
  return raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

const args = process.argv.slice(2);
function readOption(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
}
const outPath = readOption("out", "semantics.json");

// ── --init：从稿子 + 时间戳生成骨架，带词法提示 ────────────────────
if (args.includes("--init")) {
  const scriptPath = readOption("script", "");
  const timestampsPath = readOption("timestamps", "");
  if (!scriptPath) { console.error("--init 需要 --script <稿>"); process.exit(2); }
  const sentences = extractScriptSentences(scriptPath);

  // 时间戳与稿子逐字一致是硬规：预剪 → 时间戳 → 标注，顺序不能反。
  // 有 timestamps.json 时用它校对句数与起止时间；不一致直接报出来。
  let timings = [];
  if (timestampsPath && existsSync(timestampsPath)) {
    const timestamps = readJson(timestampsPath);
    timings = timestamps.sentences ?? [];
    if (timings.length !== sentences.length) {
      console.error(`✗ 稿子 ${sentences.length} 句、时间戳 ${timings.length} 句，对不上。`);
      console.error("  时间戳必须与稿子逐字一致：改稿或重剪后要重新走 时间戳 → 标注。");
      process.exit(1);
    }
  }

  const output = {
    version: 1,
    source: { script: scriptPath, timestamps: timestampsPath || undefined },
    vocab,
    sentences: sentences.map((text, index) => {
      const { hints, hard } = lexicalHints(text);
      return {
        i: index,
        t: timings[index] ? timings[index].beginMs / 1000 : undefined,
        text,
        // 句所属镜头在分镜写完后用 --sync-shots 回填（此时还没有分镜）
        shot: "",
        // sem 留空交给人工/agent 判断；hard 是词法硬规命中的，必须处理
        sem: [],
        hardHits: hard,
        hints,
        entities: [],
        need: [],
        weight: "",
      };
    }),
  };
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log("=== 语义标注骨架已生成 ===");
  console.log(`  ${outPath}`);
  console.log(`  ${output.sentences.length} 句`);
  console.log("");
  console.log("  逐句填写 sem / weight / entities / need，然后跑 --stats 校验。");
  console.log("");
  for (const sentence of output.sentences) {
    const marks = [sentence.hardHits.length ? `硬规:${sentence.hardHits.join("/")}` : "", sentence.hints.length ? `${sentence.hints.length} 条提示` : ""].filter(Boolean).join("  ");
    console.log(`  [${String(sentence.i).padStart(2, "0")}] ${sentence.text}${marks ? `    ← ${marks}` : ""}`);
  }
  process.exit(0);
}

// ── --sync-shots：分镜写完后把 shot 回填 ───────────────────────────
// 参考实现的硬规：分镜边界改过之后必须重跑，否则覆盖闸会拿错镜头的卡来核这句。
if (args.includes("--sync-shots")) {
  const shotsPath = readOption("shots", "");
  if (!shotsPath || !existsSync(shotsPath)) { console.error("--sync-shots 需要 --shots <shots.json>"); process.exit(2); }
  if (!existsSync(outPath)) { console.error(`找不到 ${outPath}`); process.exit(2); }
  const semantics = readJson(outPath);
  const shots = readJson(shotsPath);
  let changed = 0;
  let unassigned = 0;
  for (const sentence of semantics.sentences) {
    const seconds = Number(sentence.t);
    const shot = shots.find(item => seconds >= Number(item.start) && seconds < Number(item.end));
    const next = shot ? shot.id : "";
    if (next !== sentence.shot) changed++;
    if (!next) unassigned++;
    sentence.shot = next;
  }
  writeFileSync(outPath, JSON.stringify(semantics, null, 2));
  console.log("=== shot 回填完成 ===");
  console.log(`  ${changed} 句的 shot 有变化`);
  if (unassigned) {
    console.log(`  ⚠ ${unassigned} 句没归到任何镜头 —— 覆盖闸会 FAIL（那些句会被静默跳过，结论不可信）`);
    process.exit(1);
  }
  process.exit(0);
}

// ── --stats：校验 + 分布 ──────────────────────────────────────────
if (!existsSync(outPath)) { console.error(`找不到 ${outPath}；先用 --init 生成`); process.exit(2); }
const semantics = readJson(outPath);
const sentences = semantics.sentences ?? [];
const problems = [];
const warnings = [];

for (const sentence of sentences) {
  if (!Array.isArray(sentence.sem) || !sentence.sem.length) {
    problems.push(`[${sentence.i}] 没有语义标注：${sentence.text}`);
    continue;
  }
  const unknown = sentence.sem.filter(word => !vocabWords.has(word));
  if (unknown.length) problems.push(`[${sentence.i}] 语义不在封闭词表内：${unknown.join("、")}`);
  if (!["main", "sub"].includes(sentence.weight)) {
    problems.push(`[${sentence.i}] weight 必须是 main 或 sub（当前「${sentence.weight}」）`);
  }
  if (sentence.need?.length) {
    const bad = sentence.need.filter(need => !needs.includes(need));
    if (bad.length) problems.push(`[${sentence.i}] need 不在词表内：${bad.join("、")}`);
  }
}

// 参考实现的占比闸：把什么都标成论点等于让覆盖闸全部失效
// （论点既不在硬规也不在软规里，所以它一泛滥，闸就查不出任何东西）。
const argumentCount = sentences.filter(sentence => sentence.sem?.includes("论点")).length;
if (sentences.length && argumentCount / sentences.length > 0.5) {
  warnings.push(`标成「论点」的句子占 ${argumentCount}/${sentences.length}（> 一半）——「论点」是兜底档不是垃圾桶，泛滥会让覆盖闸失效`);
}

console.log("=== 语义标注校验 ===");
console.log(`  ${sentences.length} 句`);
const distribution = {};
for (const sentence of sentences) for (const word of sentence.sem ?? []) distribution[word] = (distribution[word] ?? 0) + 1;
console.log("");
console.log("  语义分布：");
for (const [word, count] of Object.entries(distribution).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${word.padEnd(8)} ${count}`);
}
const unused = vocab.filter(([word]) => !distribution[word]).map(([word]) => word);
if (unused.length) console.log(`    未用到：${unused.join("、")}`);
console.log("");
console.log(`  weight：main ${sentences.filter(s => s.weight === "main").length} / sub ${sentences.filter(s => s.weight === "sub").length}`);

// 「该摆的东西在不在」：这三类语义有专设卡族、无替代物，漏了就是硬伤。
for (const [word, label] of [["自我介绍", "自我介绍"], ["介绍他人", "介绍他人"], ["号召", "号召"]]) {
  const used = distribution[word] ?? 0;
  if (!used) continue;
  console.log(`  · ${label}：${used} 句 —— 这三类有专设卡族、无替代物，选卡时不得用别的类别顶替`);
}

if (warnings.length) {
  console.log("");
  console.log(`警告 ${warnings.length} 项：`);
  for (const warning of warnings) console.log(`  ⚠ ${warning}`);
}
console.log("");
if (problems.length) {
  console.log(`失败 ${problems.length} 项：`);
  for (const problem of problems.slice(0, 20)) console.log(`  ✗ ${problem}`);
  if (problems.length > 20) console.log(`  …… 另有 ${problems.length - 20} 项`);
  process.exit(1);
}
console.log("校验通过");
