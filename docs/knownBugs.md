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

## BUG-2 画布图片节点「添加到素材库」按钮无反应 ★ 未查清

### 现象

选中画布上的图片节点后，上方工具条里的「添加到素材库」按钮**点了没反应**（旁边是「替换图片」「下载」，那些正常）。
**未确认**：它是**灰的（禁用态）**还是**亮的但点了没反应** —— 这两者根因完全不同，下次先确认这一点。

### 按钮位置（已定位）

`packages/nodeScaffold/src/nodeSkeleton.vue:36-42`（通用工具条，不是 imageNode 自己的）：

```html
<el-button :icon="IconFolderPlus"
           :disabled="!assetOutputs.length || !saveNodeToAssets"
           title="添加到素材库"
           @click.stop="handleCommand('saveAsset')" />
```

### 链路（已逐一读过，**每一环看起来都通**）

```
nodeSkeleton.vue:38   :disabled="!assetOutputs.length || !saveNodeToAssets"
nodeSkeleton.vue:367  assetOutputs = handles 里 type==="source" 且有输出（IMAGE 有值 → 应有 1 项）
nodeSkeleton.vue:363  saveNodeToAssets = inject("saveNodeToAssets", undefined)
                      ⚠ 若为 undefined，则 L376 saveNodeToAssets?.(...) 是**静默 no-op**
nodeSkeleton.vue:376  handleCommand("saveAsset") → saveNodeToAssets?.(label, assetOutputs)
canvas/index.vue:252  provide("saveNodeToAssets", (label, outputs) => assetLibraryRef.value?.openSave(...))
                      ⚠ 若 ref 为空，同样是**静默 no-op**（?.）
assetLibrary.vue:382  openSave() 第一行：if (!canvasMode.value) return;   ← 又一处静默早退
assetLibrary.vue:137  canvasMode = props.canvas !== false
```

### 已排除的推断（**别再按这两条查**）

1. ~~「素材库浮层关闭导致对话框不存在」~~ —— **不成立**。虽然 `assetLibrary.vue:2` 的 `el-card` 带 `v-if="visible"`，但两个 `el-dialog`（L66/L73，含「保存到素材库」）是 `</el-card>`（L60）的**兄弟节点**，不受它影响。
2. ~~「canvasMode 为 false 早退」~~ —— **不成立**。全仓库两处使用，只有 `pages/home/index.vue:84` 传了 `:canvas="false"`；画布那处（`canvas/index.vue:64`）没传，所以 `canvasMode` 为 true。

### 下次该查

- 先确认按钮是否**禁用**（灰）→ 若是，查 `assetOutputs.length` 与 inject 是否拿到
- 若按钮是亮的但无反应 → 在 `handleCommand` / `openSave` / `loadEntries` 各加一句 console 定位
- 顺带注意：**这条链上有 3 处静默 no-op**（`?.`、`?.`、`if (!canvasMode) return`），
  任何一环断掉都表现为「点了没反应」且**不报错** —— 这是它难查的根本原因

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

## 顺带：仓库里已有两份可复用的经验文档

- `构建笔记.md` —— 打包全流程与全部网络障碍（**打包前先读它**，能省掉一小时的盲试）
- `docs/cardAuthoring.md` —— 卡开发方法与已知坑
