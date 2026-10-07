# 待修 bug

> 记录时间：2026-10-07。逐条修复中，状态见下表。
> 每一条都标了「已确定」与「未查清」，避免下次从零重查。
> 复现环境：开发版（`bun run dev` → http://localhost:5173）；安装包版本同代码。

## 修复进度一览

| # | 问题 | 状态 |
|---|---|---|
| BUG-1 | ② 节点写不进文本 | ✅ **已修**（文本载入兜底 + 路径缺失时落盘） |
| BUG-2 | 素材库「添加到素材库」无反应 | 🟡 **已修「禁用无提示」**（用户看到的现象）；若仍无反应，按「新发现」一节继续查 |
| BUG-3 | 营销模式创建项目连续 409 | ✅ **已修**（根因已复现并验证） |
| BUG-4 | 画布工具成功也回错误文案 | ❌ 未修，需要一次现场证据 |
| BUG-5 | `/api/desktop/update` 500 | ❌ 未修，根因已确定（很好修） |
| BUG-6 | `<label for>` 可访问性提示 | ❌ 未修（轻微） |

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

## BUG-2 画布图片节点「添加到素材库」按钮无反应 ❌ 未修（怀疑点已收敛，见「新发现」）

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

## BUG-4 画布工具把成功操作也回错误文案 ★ 未查清（用户补充）

用户观察到：**画布工具经常对已经成功的操作，也回一句同样的错误提示**，所以它的提示不可信。

这一条影响很大 —— 它让 BUG-1/2/3 的排查都会被误导。**优先级应该排在最前**，因为它污染了所有其它判断。

### 下次该查

- 画布工具（`packages/tools/canvas`）各 op 的返回值构造：是否存在「先按成功分支做完、但返回时走了错误文案模板」的路径
- 重点看 `nodeTools` / `addNode` / `connectNodes` 这类会**批量执行、部分失败**的 op：
  批量里只要有一个失败就整体回错误文案，而用户看到的是「操作其实成功了」

---

## BUG-5 `/api/desktop/update` 在浏览器模式下返回 500 ★ 根因已确定（与素材库无关）

### 现象

控制台上反复出现：

```
Failed to load resource: the server responded with a status of 500 (Internal Server Error)
:58944/api/desktop/update:1        ×3
```

### 根因（已确定）

`apps/server/src/utils/desktop/index.ts:116`

```ts
export function getDesktopRuntime(req: Request): DesktopRuntime {
  return req.app.locals.desktop;          // 独立 server 下是 undefined
}
```

`getDesktopUpdate`（L138）第一行就 `const { updater } = getDesktopRuntime(req);` →
**解构 undefined 抛 TypeError** → 统一错误处理中间件当 500 返回。

即：**在非桌面运行时（独立 server / 浏览器访问）调这个接口必然 500**，属既有缺陷。

### 谁在调

全仓库只有一处：`apps/web/src/components/settings/panels/developer/index.vue:148`
（开发者面板里的更新检查）。它请求时 `timeout: 10000` 且会自动重试，所以一次打开会刷出多条。

### 修法

`getDesktopUpdate`（以及 `checkDesktopUpdate` / `downloadDesktopUpdate` / `applyDesktopUpdate`）
应先判断 `req.app.locals.desktop` 是否存在，不存在就返回一个「无更新能力」的快照
（`canUpdate: false`）而不是抛错；前端据此隐藏更新区。

---

## BUG-6 控制台可访问性提示：`<label for>` 不匹配表单元素 id ★ 轻微

```
Incorrect use of <label for=FORM_ELEMENT>
The label's for attribute doesn't match any element id.
2 个资源
```

不影响功能，只影响浏览器自动填充与读屏。下次在开发者面板表单里找那两个 `<label>`，
给对应输入补 `id`（或改用包裹式 label）。

---

## 顺带：仓库里已有两份可复用的经验文档

- `构建笔记.md` —— 打包全流程与全部网络障碍（**打包前先读它**，能省掉一小时的盲试）
- `docs/cardAuthoring.md` —— 卡开发方法与已知坑

## 下次开工的建议顺序

1. **BUG-4**（工具成功却回错误文案）—— 先修它，否则其余每条都被它的假提示带偏
2. **BUG-1**（② 节点）—— 根因已确定，改动最小，且它真正卡住用户的进度
3. **BUG-2**（素材库）—— 先验「`saveAsset` 里 output 是否为 undefined」这一个点
4. **BUG-5**（desktop/update 500）—— 独立好修
5. **BUG-3** / **BUG-6** —— 需要更多信息 / 轻微

