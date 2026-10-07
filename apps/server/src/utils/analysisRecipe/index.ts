// 用户保存的「视频分析配方卡」。
//
// 与内置的分析卡（packages/postProduction 的 videoAnalysisCards）**不是一回事**：
//   · 内置的 6 张是"怎么读素材"的手法（探测、取帧、网格、边界、词级时间、按短语定位）—— 固定、随产品发布
//   · 这里是用户让 Agent 分析完一条视频之后，**把这次的分析成果命名保存成卡**，
//     下次做同类视频时让 Agent 取用它
// 所以本模块管的是"用户的产物"，不是"产品的能力"。
//
// 存储：数据目录下 analysisRecipes/<slug>.json，一张卡一个文件（与 skills 同思路：
// 用户能直接看到、备份、删掉单张，不需要动 settings.json）。
import { mkdir, readFile, readdir, rm, writeAtomic, lstat } from "@toonflow/file";
import { dirname, join } from "node:path";
import { isStoryAnchor } from "@toonflow/post-production";
import conf from "@/utils/conf";

export interface AnalysisRecipe {
  /** 文件标识（小驼峰）；由名字生成，重名时自动加序号。 */
  slug: string;
  /** 用户给这张卡起的名字。 */
  name: string;
  /** 这张卡是在哪条素材上分析出来的（可追溯）。 */
  source?: { path?: string; url?: string; title?: string; durationSeconds?: number };
  /** 这类视频的套路：骨架、节奏、钩子位置。 */
  pattern?: string;
  /** 意图与受众。 */
  intent?: string;
  /**
   * 值得复用的手法清单。
   *
   * ACT: 这里记的是**关系**，不是时刻 —— 这是复刻路径的核心改造。
   * 「第 4 秒有一个硬切」是观察，换个脚本就失效；真正可复用的是
   * 「在抛出价格那一刻切硬切」。所以每条手法必须写清 `respondsTo`（在回应什么）
   * 与 `role`（替观众做了什么），复刻时用**新脚本自己的时间**去实例化它。
   */
  techniques?: {
    name: string;
    /** 它回应故事的哪一下（storyAnchor 的 key）。 */
    respondsTo?: string;
    /** 参考片里它长什么样（形式，不是要照抄的像素）。 */
    form?: string;
    /** 参考片里的时点（仅作观察记录，**不是新片的时间**）。 */
    atSeconds?: number;
    /** 它替观众做了什么 —— 这才是要保留的东西。 */
    role?: string;
    /** 新片子里用什么形式完成同一件事（复刻时的落法）。 */
    when?: string;
    evidence?: string;
  }[];
  /** 证据引用（帧图、网格、边界候选时刻、词级时间），指向工作区内的路径或时刻。 */
  evidence?: { kind: string; label: string; ref: string }[];
  /** 已知坑。 */
  pitfalls?: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * 把一张卡里的手法锚点规范化。
 *
 * ACT: 锚点写错会**静默毁掉检索能力** —— 「在回应什么」这一列的用处就是让下游按锚点找卡，
 * 写一个不存在的标识，那条手法就再也搜不到了，而且没有任何报错。所以这里校验：
 * 非法锚点**丢掉并在结果里报出来**（不整卡拒绝，否则一次笔误会让整次分析白做）。
 */
function normalizeAnchors(techniques: AnalysisRecipe["techniques"]) {
  const dropped: { name: string; respondsTo: string }[] = [];
  const kept = (techniques ?? []).map(technique => {
    if (!technique.respondsTo) return technique;
    if (isStoryAnchor(technique.respondsTo)) return technique;
    dropped.push({ name: technique.name, respondsTo: technique.respondsTo });
    const { respondsTo: _ignored, ...rest } = technique;
    return rest;
  });
  return { techniques: kept, droppedAnchors: dropped };
}

export function recipesDirectory() {
  return join(dirname(conf.path), "analysisRecipes");
}

/** 名字 → slug。中文无法直接做文件名标识，所以用时间戳后缀保证可读且唯一。 */
function slugFromName(name: string, existing: Set<string>) {
  const ascii = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const base = ascii ? `${ascii}-${stamp}` : `recipe-${stamp}`;
  if (!existing.has(base)) return base;
  for (let index = 2; index < 100; index++) {
    const candidate = `${base}-${index}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error("同名配方卡过多，请换一个名字");
}

async function ensureDirectory() {
  const directory = recipesDirectory();
  await mkdir(directory, { recursive: true });
  return directory;
}

function parseRecipe(raw: unknown, slug: string): AnalysisRecipe | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Partial<AnalysisRecipe>;
  if (typeof value.name !== "string" || !value.name.trim()) return undefined;
  return {
    slug,
    name: value.name.trim(),
    ...(value.source ? { source: value.source } : {}),
    ...(typeof value.pattern === "string" ? { pattern: value.pattern } : {}),
    ...(typeof value.intent === "string" ? { intent: value.intent } : {}),
    ...(Array.isArray(value.techniques) ? { techniques: value.techniques } : {}),
    ...(Array.isArray(value.evidence) ? { evidence: value.evidence } : {}),
    ...(Array.isArray(value.pitfalls) ? { pitfalls: value.pitfalls } : {}),
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
  };
}

export async function listRecipes(): Promise<AnalysisRecipe[]> {
  const directory = await ensureDirectory();
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const recipes: AnalysisRecipe[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const slug = entry.name.slice(0, -5);
    const raw = await readFile(join(directory, entry.name)).catch(() => undefined);
    if (!raw) continue;
    try {
      const parsed = parseRecipe(JSON.parse(raw.toString("utf8")), slug);
      if (parsed) recipes.push(parsed);
    } catch {
      // ACT: 单张卡损坏不影响其他卡 —— 用户手改坏 JSON 时不该让整个卡库打不开。
      continue;
    }
  }
  return recipes.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function readRecipe(slug: string): Promise<AnalysisRecipe | undefined> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw Object.assign(new Error("配方卡标识不合法"), { status: 400 });
  const raw = await readFile(join(recipesDirectory(), `${slug}.json`)).catch(() => undefined);
  if (!raw) return undefined;
  return parseRecipe(JSON.parse(raw.toString("utf8")), slug);
}

/**
 * 新增或更新一张卡。
 *
 * @param input 卡内容；给 `slug` 表示更新已有的（不存在则按新卡建）
 */
export async function saveRecipe(input: Omit<AnalysisRecipe, "slug" | "createdAt" | "updatedAt"> & { slug?: string }): Promise<{ recipe: AnalysisRecipe; droppedAnchors: { name: string; respondsTo: string }[] }> {
  const name = input.name?.trim();
  if (!name) throw Object.assign(new Error("请给这张配方卡起一个名字"), { status: 400 });
  const directory = await ensureDirectory();
  const existing = input.slug ? await readRecipe(input.slug) : undefined;
  let slug = existing?.slug;
  if (!slug) {
    const names = new Set((await readdir(directory).catch(() => [])).filter(entry => entry.endsWith(".json")).map(entry => entry.slice(0, -5)));
    slug = slugFromName(name, names);
  }
  const now = new Date().toISOString();
  const { techniques, droppedAnchors } = normalizeAnchors(input.techniques);
  const recipe: AnalysisRecipe = {
    slug,
    name,
    ...(input.source ? { source: input.source } : {}),
    ...(input.pattern?.trim() ? { pattern: input.pattern.trim() } : {}),
    ...(input.intent?.trim() ? { intent: input.intent.trim() } : {}),
    ...(techniques?.length ? { techniques } : {}),
    ...(input.evidence?.length ? { evidence: input.evidence } : {}),
    ...(input.pitfalls?.length ? { pitfalls: input.pitfalls } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  // ACT: 整卡覆盖写用 writeAtomic —— 用户可能在卡库里改过，半截 JSON 会让这张卡读不出来。
  await writeAtomic(join(directory, `${slug}.json`), `${JSON.stringify(recipe, null, 2)}\n`);
  return { recipe, droppedAnchors };
}

export async function removeRecipe(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw Object.assign(new Error("配方卡标识不合法"), { status: 400 });
  const target = join(recipesDirectory(), `${slug}.json`);
  const info = await lstat(target).catch(() => undefined);
  if (!info?.isFile()) throw Object.assign(new Error("找不到这张配方卡"), { status: 404 });
  await rm(target, { force: true });
}
