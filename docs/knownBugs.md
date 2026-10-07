# 待修 bug（未修复，等待下次处理）

> 记录时间：2026-10-07。**这些 bug 都还没修**，只做了定位。
> 每一条都标了「已确定」与「未查清」，避免下次从零重查。
> 复现环境：开发版（`bun run dev` → http://localhost:5173）；安装包版本同代码。

---

## BUG-1 ② 节点写不进文本：「文本尚未加载，无法保存」★ 根因已确定

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

## BUG-2 画布图片节点「添加到素材库」按钮无反应 ★ 未查清（有新线索）

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

## BUG-3 首页选「营销/推广模式」创建项目后连续多个 409 ★ 未查清

### 现象

在首页选营销/推广模式进入画布后，**提示了好几个 409**（`Request failed with status code 409`）。

### 已查

服务端 409 有 20+ 处，最可能的三个（**但哪一个还没确认**）：

```
apps/server/src/utils/workspace/files.ts:63        文件正在使用，请等待操作完成
apps/server/src/agent/mentionFiles.ts:35           画布正在保存，请重试
apps/server/src/app.ts:88                          EEXIST / ENOTEMPTY → 409（已存在同名文件或目录）
```

### 下次该查

F12 → Network → 点 409 请求 → 读响应体 `message`（前端只显示了英文的 axios 文案，真实原因在 `message` 里）。
或看服务端控制台日志。

**提示**：因为是「营销/推广模式」这种**模板/模式**初始化流程，且是**连续多个**，
更像是初始化时并发写了同一批文件 / 或目录已存在（重复创建模式时会撞 EEXIST）。

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

