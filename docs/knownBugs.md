# 待修 bug

> 记录时间：2026-10-07。逐条修复中，状态见下表。
> 每一条都标了「已确定」与「未查清」，避免下次从零重查。
> 复现环境：开发版（`bun run dev` → http://localhost:5173）；安装包版本同代码。

## 修复进度一览

| # | 问题 | 状态 |
|---|---|---|
| BUG-1 | ② 节点写不进文本 | ✅ **已修**（文本载入兜底 + 路径缺失时落盘） |
| BUG-2 | 素材库「添加到素材库」无反应 | 🟡 **已消除全部静默失败**（不再「点了没反应」而无报错）；真正原因待用户复测后给出一句话提示 |
| BUG-3 | 营销模式创建项目连续 409 | ✅ **已修**（根因已复现并验证） |
| BUG-4 | 画布工具成功也回错误文案 | 🟡 **已修结构性根因**（操作已生效后的落盘失败不再让整次调用变成错误） |
| BUG-5 | `/api/desktop/update` 500 | ✅ **已修**（根因：去 Toonflow 化留下的 identifier 不一致） |
| BUG-6 | `<label for>` 可访问性提示 | ✅ **已修**（el-input-number 的 id 落在根 div 上，for 永远匹配不到） |
| LIMIT-1 | 抖音链接取流不可用 | ⛔ **平台限制，非缺陷**（四种方案全部被它的安全 SDK 拦掉，见下） |

BUG-1 与 BUG-3 其实是**同一条链**：6 个 textNode 并发建 `assets` 目录 → 撞锁 409 / 父目录未就绪 404
→ `textPath` 读不到 → 载入失败且无重试 → `textReady` 永远 false → 工具写入报「文本尚未加载」。
两处都改完后整条链才通。

---

## BUG-1 ② 节点写不进文本：「文本尚未加载，无法保存」✅ 已修

### 修法（已实现并验证）

`packages/nodes/textNode/src/index.vue` 的 `loadText()`：

1. **新增 `isMissingPath(error)`**：把「读不到文件」（HTTP 404 / `ENOENT`）识别为**尚未有内容**，
   而不是失败 —— 取空文本继续走，并在下面把 `assets/<id>/content.md` 真正创建出来。
2. **建目录改为顺序执行**（`assets` 再 `assets/<id>`）：原先两处 mkdir 并发，
   父目录还没落地就建子目录 → 6 个 `assets/m-*` 全部 404。顺序化后消失。
3. mkdir 的失败容忍扩到 `EEXIST` / `EBUSY` / HTTP 409 —— 目录已存在或正被别的请求建，都算达成目的。

### 验证

- `bun run typecheck`（textNode）通过
- 重建节点产物并核对 `textNode.umd.js` 含 `ENOENT` / `EBUSY` 分支
- 见 BUG-3 的复现脚本：6 个节点并发载入 → 建目录 + 写文件**全部 200**

### 原始记录（保留，便于回溯）

### 现象

- 营销/推广模式的模板画布里有 6 个节点，其中 ② 是「宣传片脚本」文本节点。
- ① 节点（产品与卖点）能正常写入，② 不能。
- 工具写入 ② 时报：**「文本尚未加载」**。
- **退出项目时**报：「无法保存项目：文本尚未加载，无法保存。文件或目录可能已被移动或删除。仍然退出将丢弃尚未保存的修改。」

### 根因（已确定，定位到行）

`packages/nodes/textNode/src/index.vue`：

```ts
// L107 文本只在组件挂载时载入
onMounted(() => { textLoading = loadText(); });

// L108-132 loadText
const value = data.textSnapshot !== undefined ? data.textSnapshot
            : data.textPath ? await textFiles.readText(textPath)   // ← 读失败就抛
            : outputs.value.text.value;
// ...
textReady.value = true;   // ← 只有成功才置 true
```

两个分支的差别：

| 情况 | 结果 |
|---|---|
| 节点没绑 `textPath`（全新节点） | 走 else：建目录 + 写文件 → 成功 ✓（① 是这种） |
| 节点**已绑 `textPath` 但文件不存在** | `readText` 抛 **ENOENT** → 被 catch 吞掉 → `textReady` **永远 false** ✗（② 是这种） |

- 「文件或目录可能已被移动或删除」与「文本尚未加载」是**同一根因的两个出口**（退出时保存事件会去读那个不存在的文件）。
- ② 是模板节点，绑了 `assets/<nodeId>/content.md` 这个路径，但**那个文件从没被创建过** —— 脚本是被写到工作区 `assets/m-script/content.md` 的，不是节点绑的路径。
- **没有重试**：`loadText` 失败一次之后没有任何补载路径。

### 修法（两条都很小）

1. `readText` 的 **ENOENT 视为空文本**，然后照常建目录 + 落盘 → `textReady` 能转 true
2. 给失败留一条**按需重试**：工具来写、或保存事件触发时，若 `textReady` 为 false 先补一次载入

### 临时绕过（不用改代码）

把脚本内容写到 ② **节点绑定**的那个路径（`assets/<②nodeId>/content.md`），再刷新画布。
注意：写到 `assets/m-script/content.md` **没用** —— 那是另一个文件。

---

## BUG-2 画布图片节点「添加到素材库」按钮无反应 ✅ 已修（浏览器实测确认）

### 根因（**用 CDP 驱动真实 Chrome 复现并定位**）

`assetLibrary.vue` 的 `openSave` 里那道守卫读的开关不可靠：

```ts
const canvasMode = computed(() => props.canvas !== false);   // ← 画布里竟是 false
...
if (!canvasMode.value) return;      // 原先静默 return
```

**实测诊断输出**（在画布里点按钮时打印 `props`）：

```
canvas=false   directory=E:\...\cdpProject（有效）   fill=false
```

即 **画布里的这个实例，`props.canvas` 读出来是 false**，于是 `openSave` 直接挡掉、
对话框永远不开。加上上层 `handleCommand` 原本 `saveNodeToAssets?.(...)` **没有 await 没有 catch**，
整条链就是**完全静默** —— 正是用户看到的「点了没反应、控制台也没有报错」。

> `index.vue:64` 并没有传 `canvas` 属性（全仓库只有首页那个传 `:canvas="false"`），
> 所以这个 false 的来源**仍未完全解释清楚**。修法绕开了这个不可靠的开关。

### 修法

判断依据从「那个 canvas 布尔开关」改成「**有没有项目目录**」——
能不能保存取决于上下文是否具备（有目录、能读节点文件），而 `directory` 在画布与对话框
两种用法里都是真实依据；首页那个实例本来就不传目录，会被如实挡住。

1. `assetLibrary.vue`：`canvasMode` → `canUseInCanvas = Boolean(props.directory)`（拖拽也用同一依据）
2. `openSave`：**删掉** `!canvasMode` 那道守卫，改为 `if (!props.directory) throw`（如实报错）
3. `handleCommand`：`await saveNodeToAssets(...)` + `try/catch` + `ElMessage.error`，不再静默
4. `canvas/index.vue`：注入函数在 ref 为空时抛错，不再用 `?.` 静默吞掉

### 验证（**端到端，在真实 Chrome 里跑完**）

```
① 点「添加到素材库」 → CLICKED
② 对话框：标题「保存到素材库」、素材名预填「测试图片.png」、
   保存位置「素材库」、文件夹树 2 项、保存按钮可用
③ 点「保存」 → CLICKED，对话框关闭
④ 落盘确认：PUT /api/assets/save?path=测试图片.png → 200
   data\assets\测试图片.png → 70 字节，真实写入
```

连跑 2 次均稳定打开对话框。

---

## BUG-2 原始记录（保留，含**我两次错误结论**的订正）


### ❌ 先订正一条**错误结论**（我上一轮写的）

上一轮我判断「按钮本来就是禁用的（节点没有内容）」——
**用户明确反馈：节点有内容，按钮点了没反应。所以那个结论是错的，不要按它查。**

（`saveAssetDisabled` 的禁用条件是 `!assetOutputs.length || !saveNodeToAssets`，
节点有内容时 `assetOutputs` 非空 → 按钮**不是**禁用的。方向就错了。）

### 真正的问题：这条链上有 **3 处静默失败**，全都表现为「点了没反应且无报错」

| # | 位置 | 原先的写法 | 为什么静默 |
|---|---|---|---|
| 1 | `nodeSkeleton.vue` `handleCommand` | `saveNodeToAssets?.(props.label, assetOutputs.value)` | **没有 await、没有 catch**；`openSave` 是 async，内部抛错只变成未处理的 Promise 拒绝 |
| 2 | `assetLibrary.vue` `openSave` | `if (!canvasMode.value) return;` 等早退 | 什么都不做、不报错 |
| 3 | `canvas/index.vue:252` | `assetLibraryRef.value?.openSave(...)` | 组件 ref 为空时 `?.` 静默吞掉 |

**这三处都已改为「如实说出来」**：

1. `handleCommand` 改为 `await` + `try/catch` → `ElMessage.error`；
   注入缺失和「节点没内容」也各自给了明确文案
2. `openSave` 的三个早退改为抛错（`当前视图不支持…` / `还没有打开项目目录…` / `节点还没有内容…`）
3. 注入函数改为 ref 为空时抛「素材库面板尚未就绪，请稍后重试」

### 下一步（需要用户复测）

**用含这些改动的版本再点一次**，现在必然会给出具体原因。把弹出的那句话发我即可定位。

候选原因（按可能性排序，都还没证实）：
- `assetLibraryRef` 为空 —— 素材库组件是通过 `v-model="assetsVisible"` 控制的浮层，
  若它未被挂载/被条件渲染掉，注入里的 ref 就是空的
- `props.directory` 为空（项目目录没传到画布面板）
- `openSave` 抛在 `loadEntries()` 之前

### 另一个仍然存在、但**不该**是本次原因的点

`assetLibrary.vue:105` 的「保存」按钮在「素材名含 `\` 或 `/`」或「点了新建文件夹却没提交」时为禁用，
`saveAsset`（L402）里也是静默 `return`。这属用户可自行纠正的输入问题，但同样没提示 ——
与上面的修法一并处理即可。


### ★ 新发现（2026-10-07 第二轮，这条最可能就是答案）

`assetOutputs` 只统计**真的产出过内容**的 source 端口：

```ts
// nodeSkeleton.vue:367
props.handles.flatMap(handle => {
  const output = props.outputs[handle.id];
  if (handle.type !== "source" || !output || (output.dataType === "STRING" && !output.value.trim())) return [];
  ...
})
```

而**两个图片节点的 `image` 输出都只在「生成完成」或「上传图片」之后才被赋值**：

| 节点 | 输出赋值时机 |
|---|---|
| `imageNode`（素材载体） | `index.vue:100`（载入已有图）、`:127`（上传图片） |
| `imageGenerationNode`（③ 主视觉） | `index.vue:178`（上传）、`:234`（生成完成） |

**所以：节点还没有内容时，按钮 `disabled` 条件 `!assetOutputs.length` 成立 → 按钮是灰的 → 点了没反应。**

这条同时解释了为什么右键菜单项「本该」不出现（它的 `v-if` 也包含 `assetOutputs.length`）。
**下次第一件事**：确认用户点的是哪个节点、那个节点当时**有没有图**。

### 这里真正的毛病：**禁用没有任何提示**

工具条上「下载」「全屏」都有 `el-tooltip` + 动态文案，唯独这个按钮是**裸的**：

```html
<el-button :icon="IconFolderPlus" :disabled="!assetOutputs.length || !saveNodeToAssets"
           text title="添加到素材库" @click.stop="handleCommand('saveAsset')" />
```

`title` 也永远写死「添加到素材库」，不会说「节点还没有内容，暂时没有可保存的东西」。
于是用户看到的是**「点了没反应」**，而不是「这个功能现在用不了，因为……」。

**修法**（很小，且能直接消除用户看到的现象）：
1. 给按钮套 `el-tooltip`，禁用时文案改为说明原因（如「节点还没有内容，先生成或上传」）
2. 右键菜单项同理：把 `v-if` 改成「按条件禁用」，而不是**整个消失** —— 菜单项直接不见，
   用户只会以为功能没了

### 另外：一条不必修的

`assetLibrary.vue:105` 的「保存」按钮在**素材名含 `\` 或 `/`**、或**点了「新建文件夹」却没提交**时为禁用，
而后一种在 `saveAsset`（L402）里也是**静默 return**。这两种都属用户可自行纠正的输入问题，
但同样「没提示」——与上面的修法一起处理即可。

---

## BUG-2 原始记录（保留）

### 现象

选中画布上的图片节点后，上方工具条里的「添加到素材库」按钮**点了没反应**（旁边是「替换图片」「下载」，那些正常）。
**未确认**：它是**灰的（禁用态）**还是**亮的但点了没反应**。

### 新增线索（2026-10-07 用户补充）★

1. **右键节点 → 菜单里的「保存到素材库」也没反应** —— 两个入口都坏。
2. 控制台**没有**与素材库相关的报错。
3. 运行在**端口 58944** → 是**桌面应用**，不是开发版（5173）。
   ⚠ 下次先确认这个安装包是不是含最新代码（旧包会让整个排查建立在错代码上）。
4. 控制台里确实有报错，但**与素材库无关**：`/api/desktop/update` 500（见 BUG-5）。

### 两个入口都坏 ⇒ 排除了什么

- 工具栏按钮那条链不是独有的：`nodeSkeleton.vue:42` 的按钮和
  `nodeSkeleton.vue:15` 的右键菜单项**都汇到同一处**
  `handleCommand("saveAsset")`（L376）→ `saveNodeToAssets?.()`。
- 右键菜单项带 `v-if="assetOutputs.length && saveNodeToAssets"`（L15）——
  **它出现了**，说明 `assetOutputs.length` 与 `saveNodeToAssets` **都是真的**。
  这一条同时排除了「注入缺失」和「无输出」两种猜测。

### 剩下的强怀疑点：**静默早退**

这条链上至少有 **3 处「什么都不做、也不报错」**，与用户观察完全一致：

| # | 位置 | 条件 |
|---|---|---|
| 1 | `assetLibrary.vue:384` | `openSave` 第一行 `if (!canvasMode.value) return;` |
| 2 | `assetLibrary.vue:402` | `saveAsset` 第一行 `if (!output \|\| !name \|\| ...) return;` |
| 3 | `assetLibrary.vue:290` 附近 | `openSave` 里 `if (!directory.value) return;`（**未逐行确认**） |

**下次最该先验的一条**：`saveAsset` 里 `outputs.value[selectedOutput.value]?.output` 是否为 undefined。
若为 undefined，点「保存」就是**静默无效** —— 这与「对话框能打开但点了没反应」吻合。
（同时注意 `saveAsset` 的早退条件里 `saveFolderName !== undefined` 也会导致静默无反应：
用户在对话框里点了「新建文件夹」但没提交，保存就会被静默挡掉。）

### 已排除的推断（**别再按这两条查**）

1. ~~「素材库浮层关闭导致对话框不存在」~~ —— **不成立**。虽然 `assetLibrary.vue:2` 的 `el-card` 带 `v-if="visible"`，但两个 `el-dialog`（L66/L73，含「保存到素材库」）是 `</el-card>`（L60）的**兄弟节点**，不受它影响。
2. ~~「canvasMode 为 false 早退」~~ —— **不成立**。全仓库两处使用，只有 `pages/home/index.vue:84` 传了 `:canvas="false"`；画布那处（`canvas/index.vue:64`）没传，所以 `canvasMode` 为 true。
3. ~~「注入缺失」/「节点无输出」~~ —— **不成立**（右键菜单项出现即证明两者都为真，见上）。

### 按钮与链路位置（已定位）

`packages/nodeScaffold/src/nodeSkeleton.vue:36-42`（通用工具条，不是 imageNode 自己的）、L15（右键菜单项）、L376（handleCommand）。

```
nodeSkeleton.vue:38   :disabled="!assetOutputs.length || !saveNodeToAssets"
nodeSkeleton.vue:363  saveNodeToAssets = inject("saveNodeToAssets", undefined)
                      ⚠ 若为 undefined，则 L376 saveNodeToAssets?.(...) 是**静默 no-op**
nodeSkeleton.vue:376  handleCommand("saveAsset") → saveNodeToAssets?.(label, assetOutputs)
canvas/index.vue:252  provide("saveNodeToAssets", (label, outputs) => assetLibraryRef.value?.openSave(...))
                      ⚠ 若 ref 为空，同样是**静默 no-op**（?.）
assetLibrary.vue:382  openSave() → if (!canvasMode.value) return;  / if (!directory.value) return;
assetLibrary.vue:105  「保存」按钮 → saveAsset()  → L402 静默早退
assetLibrary.vue:258  loadEntries() → /api/assets/list（失败会弹 ElMessage，用户说没弹）
```


---

## BUG-3 首页选「营销/推广模式」创建项目后连续多个 409 ✅ 已修（已复现）

### 根因（**已实测复现**，不是推断）

用脚本照前端的真实调用顺序打接口，一次复现：

```
=== 6 个 textNode 并发 mkdir（就是那批 409）===
✗ mkdir assets/m-brief    HTTP 404  找不到这个文件或文件夹     ← 父目录还没建好
✓ mkdir assets (m-brief)  HTTP 200
✗ mkdir assets (m-visual) HTTP 409  文件正在使用，请等待操作完成  ← 抢锁失败
✗ mkdir assets (m-cut)    HTTP 409  文件正在使用，请等待操作完成
✗ mkdir assets (m-script) HTTP 409  文件正在使用，请等待操作完成
✗ mkdir assets (m-audio)  HTTP 409  文件正在使用，请等待操作完成
✗ mkdir assets (m-video)  HTTP 409  这个名称已经被占用了
✗ mkdir assets/m-*        HTTP 409  文件正在使用 / 已被占用
```

**用户的猜测方向是对的**（「模式默认创建了多个节点造成冲突」），
但不是节点之间冲突 —— 而是**营销模式一次铺 6 个 textNode，
每个节点挂载时都去建同一个 `assets` 目录**：

- `apps/server/src/utils/workspace/files.ts` 的 `lockWorkspaceFiles` 对**嵌套路径**也判冲突，
  并发建 `assets` 时 1 个拿到锁、其余撞 `EBUSY` → **409「文件正在使用，请等待操作完成」**
- `assets/<id>` 的父目录尚未落地 → `mkdir`（非 recursive）→ ENOENT → **404**

这两个码都跟「模式里有几个节点」成正比放大了 —— 节点越多，红得越多。

### 修法（已实现并验证）

1. **`apps/server/src/routes/workspaces/files/mkdir.ts` 改为幂等**：
   - 先**无锁探测** `stat(path).isDirectory()` → 已经是目录就直接成功（重入/再进项目零冲突）
   - 还没建好才拿锁建；拿不到锁按 20ms 递增退避重试（上限 10 次 ≈ 1.1s）
   - 建的时候撞 `EEXIST`/`ENOTEMPTY` 也算成功
2. **`textNode` 改为顺序建目录**（见 BUG-1），从源头不再制造 404

### 验证

复现脚本连跑 3 轮：**无 404、无 409**（`mkdir assets` 6 个并发全部 200，
子目录、写文件全部 200）。

### 关于「重复创建画布 409」

单独验过：`write 画布1.json` 第二次确实返回 409
（「这个名称已经被占用了，请换一个名称。原来的内容不会被覆盖。」）——
**这是 exclusive 的正确行为**，且前端 `createProject` 会先 `list()` 判空并拒绝非空目录，
正常路径碰不到。只在「两次提交」这类竞态下才会出现，不是这批 409 的主因。


---

## BUG-4 画布工具把成功操作也回错误文案 🟡 已修结构性根因

用户观察到：**画布工具经常对已经成功的操作，也回一句同样的错误提示**，所以它的提示不可信。
这一条影响很大 —— 它让其它 bug 的排查都会被误导。

### 根因（已定位到具体代码，是结构性的）

`apps/web/src/pages/workspace/panels/canvas/useCanvasTools.ts` 的 `call()` 里，
**操作执行完之后还有几步会抛错，而抛错会让整次调用变成「工具失败」**：

```ts
let result = await execute(request, callSignal, id);   // ① 操作已完成（节点改了、文字写了）
callSignal.throwIfAborted();
if (...) await options.flushSave();   // ② 落盘；saveCanvasState（index.vue:594）会 throw saveError
callSignal.throwIfAborted();          // ③ 或这里（信号中止）
canvasSignal.throwIfAborted();
return result;
```

- ② 的 `flushSave` 最终走到 `apps/web/.../canvas/index.vue:569 flushCanvasSave` →
  `saveCanvasState` → **`if (saveError) throw saveError`**（L594）→ 一路冒泡成工具错误。
- ③ 的两处 `throwIfAborted` 同理：操作已完成，但信号恰好中止 → 工具报错。

**为什么这条特别有害**：Agent 看到工具报错会**重试**，而操作已经生效 ——
重试会重复建节点、重复连线、重复选卡。这类「假失败」最容易被重试放大成脏数据。

### 修法（已实现并验证）

`useCanvasTools.ts`：把 ② 的落盘失败**降级为结果里的警告**，而不是让整次调用失败：

```ts
let saveWarning: string | undefined;
if (!isCanvasRead(request.name) && request.name !== "selectNodes") {
  try { await options.flushSave(); }
  catch (error) { saveWarning = error instanceof Error ? error.message : String(error); }
}
...
if (!saveWarning) return result;
return { result: result ?? null, completed: true, saveWarning,
         note: "操作已经生效，不要重做；保存到磁盘失败，请提示用户后重试保存。" };
```

`CanvasContext.call` 的返回类型是 `Promise<unknown>`，所以这个形状不需要改契约。

### 验证

- web typecheck：仅 7 个**既有** TS7006，`useCanvasTools.ts` 不在其中（无新增）
- 构建 web 通过，产物 `workspace-*.js` 含新文案「操作已经生效，不要重做」
- preflight 全部通过

### 仍需用户确认的一点

这只是**结构性**根因（操作生效后的失败被当成操作失败）。如果用户见到的错误文案
**不是**关于「保存 / 信号中止」而是别的具体话术，那还有第二个来源 ——
请给出工具回的原话，可据此继续定位。

---

## BUG-5 `/api/desktop/update` 返回 500 ✅ 已修

### 现象

控制台上反复出现：

```
Failed to load resource: the server responded with a status of 500 (Internal Server Error)
:58944/api/desktop/update:1        ×3
```

### 根因（**已确定，两个独立缺陷，都实测过**）

#### 主因：去 Toonflow 化留下的 **identifier 不一致** ← 这才是 500 的来源

`apps/desktop/src/update/windowsUpdater.ts:95` 的 `getLocalInfo()` 会校验打包进
`Resources/version.json` 的安装标识。而两个文件的值**不一致**：

| 位置 | 值 |
|---|---|
| `electrobun.config.ts:6` `app.identifier` | `local.zhukai.desktop`（品牌已改成住凯） |
| `windowsUpdater.ts:98` 的校验 | `info.identifier !== "local.toonflow.desktop"`（旧标识） |

于是 `getLocalInfo()` **每次都抛**「桌面安装标识无效，请重新安装」→ `/api/desktop/update` 500。

**实测证据**：把**真实打包产物**的 `version.json`
（`{"identifier":"local.zhukai.desktop", ...}`，从 `Resources/ynlwszz9zbu0.tar.zst` 里抽出）
分别喂给新旧两套校验逻辑：

```
① 旧逻辑（identifier !== local.toonflow.desktop） → 抛错 ✗  ← 500 的原因
② 新逻辑（只校验格式合法）                        → 通过 ✓
   10 项边界（identifier 非法/channel 非法/version 格式错/…/换品牌标识）全部符合预期
```

> ⚠️ 注意 `getLocalInfo` 里 identifier 与 name 用的是**不同**的字符集规则：
> `identifier` 允许 `[a-zA-Z0-9._-]`、`name` 只允许 `[a-zA-Z0-9_-]`。
> 写验证脚本时必须与源码 `windowsUpdater.ts:13-14` 的正则**逐字一致**，
> 我第一次照猜写成十六进制 hash，得出「修复无效」的错误结论。

**修法**：不再拿 identifier 跟写死的字符串比，只校验它是合法名字 ——
品牌由 `electrobun.config.ts` 决定，代码里钉常量只会让下次改名重演同一个故障。
`identifier` 的自洽性由别处保证（`windowsUpdater.ts:171/194/294`、
`compat/macIntel/updater.ts:170` 都是拿 `info.identifier` 跟自己比）。

#### 次因：独立 server 下解构 undefined

`getDesktopUpdate` 原先第一行就 `const { updater } = getDesktopRuntime(req);`，
而独立 server 下 `req.app.locals.desktop` 是 `undefined` → TypeError → 500。

不过 `/api/desktop/*` 前面有一道门 `apps/server/src/lib/desktop.ts:5`：

```ts
if (!req.app.locals.desktop) return res.status(404).json(error("此接口仅在桌面客户端中可用", null, 404));
```

所以**独立 server 下实际是 404、根本进不到这里** —— 这也解释了我一开始
用裸请求打这个接口拿到 404 的原因。次因属防御性修复
（`getDesktopUpdate` 返回 `canUpdate: false` 的空快照；`checkDesktopUpdate` 如实报 400）。

### 谁在调

全仓库只有一处：`apps/web/src/components/settings/panels/developer/index.vue:148`
（开发者面板里的更新检查）。它请求时 `timeout: 10000` 且会自动重试，所以一次打开会刷出多条。

### 修法

`getDesktopUpdate`（以及 `checkDesktopUpdate` / `downloadDesktopUpdate` / `applyDesktopUpdate`）
应先判断 `req.app.locals.desktop` 是否存在，不存在就返回一个「无更新能力」的快照
（`canUpdate: false`）而不是抛错；前端据此隐藏更新区。

---

## BUG-6 控制台可访问性提示：`<label for>` 不匹配表单元素 id ✅ 已修

```
Incorrect use of <label for=FORM_ELEMENT>
The label's for attribute doesn't match any element id.
2 个资源
```

不影响功能，只影响浏览器自动填充与读屏。

### 根因（已确定）

全仓库只有一处原生 `<label>`：`apps/web/src/components/settings/panels/mcp/index.vue:35`

```html
<label for="mcpPort">首选本地端口</label>
<el-input-number id="mcpPort" v-model="portDraft" ... />
```

**Element Plus 的 `el-input-number` 把 `id` 落在根 div 上**，真正接收输入的 `<input>`
是内部用 `useFormItemInputId` 生成的（不在表单里时是随机 id）。所以 `for` 永远匹配不到
任何元素 —— 每次渲染都报这条，读屏也读不到这个字段名。

### 修法

该组件**没有 `inputId` 之类的透传属性**（已核 `node_modules/element-plus` 源码），
所以不靠 `for`，改用 `aria-labelledby` 建立显式关联：
`<span id="mcpPortLabel">` + `el-input-number aria-labelledby="mcpPortLabel"`。
不依赖第三方内部实现，语义也更准确。CSS 用 flex + `.el-input-number` 选择器，外观不变。

### 验证

web typecheck：仅 7 个**既有** TS7006（与我改的文件无关），无新增；
全仓库已无 `for=` 形式的原生 label。

---

## 顺带：仓库里已有两份可复用的经验文档

- `构建笔记.md` —— 打包全流程与全部网络障碍（**打包前先读它**，能省掉一小时的盲试）
- `docs/cardAuthoring.md` —— 卡开发方法与已知坑

## 下次开工的建议顺序

**已修并验证**：BUG-1、BUG-3、BUG-5、BUG-6。
**已修但待用户复测确认**：BUG-4（结构性根因）、BUG-2（静默失败已全部消除）。

**下次只剩一件事** —— 等用户复测后的一句话：

1. **BUG-2**：用含改动的版本再点一次「添加到素材库」。
   现在必然会给出具体原因（不再静默），把那句话记下来即可定位。
   候选：`assetLibraryRef` 为空 / `props.directory` 为空 / `loadEntries` 之前抛错。
2. **BUG-4**：若用户见到的错误文案**不是**关于「保存 / 信号中止」而是别的原话，
   说明还有第二个来源 —— 同样需要那句话。

**另外**：这些改动都在服务端路由、节点产物与 web 产物里，要装进应用需**重新打包**
（按 `构建笔记.md` §7，不要直接跑 `package:desktop`）。

## 教训（写在这里，避免重复）

- **我犯过两次同类错**：把「界面没反应」直接归因成最省事的解释（第一次是「按钮禁用」），
  而没有先让失败**可见**。正确的顺序是：**先把静默失败改成会报错，再根据报错定位** ——
  这条链上有 3 处静默失败，任何一处都会伪装成「点了没反应」。
- **验证脚本的常量必须与源码逐字对齐**（BUG-5 那次我把 hash 正则照猜成十六进制，
  得出「修复无效」的错误结论）。照猜的规则验证的是自己的假设，不是代码。

---

## LIMIT-1 抖音链接取流不可用 ⛔ 平台限制（不是我们的缺陷）

> 记录时间：2026-10-08。**结论已定，不要再重查**。
> 验证用的真实链接：`https://v.douyin.com/nAo9EQ6qfZM/` → 解析到视频 id `7688392913676713915`
> （作者「冉冉启山河」，标题「300多3天2晚住进南宁全新开业酒店」）。

### 现象

粘贴抖音分享链接取流，报 `ERROR: [Douyin] <id>: Fresh cookies (not necessarily logged in) are needed`。
`--verbose` 下能看到真因：`Failed to download web detail JSON: HTTP Error 403: Forbidden`。

### 已排除的原因（都实测过，不要重复试）

| 猜测 | 实测结果 |
|---|---|
| 缺 cookies | ✗ 不是。用 `--cookies-from-browser` 取不到（见下），但**我自己启动的浏览器**里取到 32 条 cookie（含 `ttwid`、`__ac_signature`、`s_v_web_id`），写成 Netscape 格式喂给 yt-dlp **仍然 403** |
| `--cookies-from-browser chrome` | ✗ Chrome 127+ 的 App-Bound 加密，yt-dlp 报 `Failed to decrypt with DPAPI`（yt-dlp #10927） |
| `--cookies-from-browser edge` | ✗ 报 `Could not copy Chrome cookie database`（数据库被占用，yt-dlp #7271） |
| 缺 Referer 头 | ✗ 加 `--add-header "Referer:https://www.douyin.com/"` 仍 403 |
| TLS 指纹 | ✗ `--impersonate chrome / chrome-136 / safari` 三种都试过（curl_cffi 0.16.0 可用），仍要 cookie |
| yt-dlp 版本旧 | 大概不是。用的是官方最新 `2026.08.19`（与上游锁的版本一致） |

### 关键对照：**同一接口，浏览器 200、yt-dlp 403**

在真实浏览器页面里请求同一个 detail 接口：

```
同源 fetch detail → HTTP 200，69923 字节，返回完整 aweme_detail
页面 video 元素 → duration 39.83、videoWidth 1280（正常播放）
视频真实规格 → 1920x1080，39.834 秒
```

所以不是平台封禁，而是**抖音的风控识别出"不是真实浏览器页面的请求"**。

### 试过并失败的绕过方案（四种，都被同一个安全 SDK 拦掉）

抖音页面加载了 `lf-security.bytegoofy.com/.../sdk-glue.js`，它**替换了 `window.fetch`**。

| 方案 | 结果 |
|---|---|
| 主世界（页面上下文）`fetch` | ✗ 被 SDK 拦，`TypeError: Failed to fetch`，堆栈直接指向它自己的 `onRequest` |
| `XMLHttpRequest` | ✗ detail 能过，但视频 CDN 跨域失败（`xhr.onerror`）——SDK 的 hook 显然为跨域加了别的东西 |
| 隔离环境（`Page.createIsolatedWorld`）里 `fetch` | ✗ WAF 返回 `Blocked by ...` 页面（不是 JSON），说明隔离环境的请求被判为异常 |
| 隔离环境取原生 `fetch`、在主世界调用 | ✗ 仍被 SDK 拦 —— 它拦的是**调用点**，不是函数本身 |

另外两条路也试过，不成立：
- 让 Chrome 自己下载（`Browser.setDownloadBehavior` + `<a download>`）：跨域资源上 `download` 属性被浏览器忽略，**0 字节落地**
- 直接下 CDN 地址（带浏览器取到的播放地址）：**403**，CDN 也要会话

### 结论与产品的处置

**这是抖音专门对抗自动化的结果，不是我们代码能修的。** 已按此处置：

- `POST /api/videoFetch` 遇到这类拒绝时，返回**可执行的中文提示**：
  「这个站点拒绝了自动下载（需要它的登录态或签名）。可以：① 在浏览器里打开该视频并另存为文件，再上传到素材库；② 换其他站点的链接。」
  （`code: "SITE_BLOCKED"`）
- **不再尝试浏览器辅助提取** —— 试了四种实现都被拦，继续做只会得到一个不稳定、随时失效的功能。

### 教训

排查时踩过两次误判，记下来避免下次重复：

1. **`Fresh cookies` 不是真因**。它是 yt-dlp 对「detail 接口没返回可用 JSON」的兜底文案；
   真因要 `--verbose` 才看得到（403）。我第一次只按 `403` 做降级判断，
   结果**非 verbose 输出里没有 403**，降级从未触发。
2. **`TypeError: Failed to fetch` 不一定是我们的连接失败**。它出在抖音页面自己的
   Slardar 遥测脚本里；我当时花了很久查自己的 CDP `fetch`，其实连接一直是通的。
   判断依据：看堆栈是不是指向站点的 SDK。

### 仍然可用的取流

- **B站**：完整可用，无需 cookie。实测 `POST /api/videoFetch` 4.3 秒 →
  `参考_bili.mp4` 71.75 MB、`h264/avc1 + aac/mp4a`、1920x1080、212.3 秒。
- **本地文件**：永远可用，也是抖音这条的兜底路径。
