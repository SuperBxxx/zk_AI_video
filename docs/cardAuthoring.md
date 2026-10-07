# HTML 卡的开发方法

本文记录**做一张 HTML 卡该怎么做、以及踩过哪些坑**。卡的机制本身见
`packages/cardRuntime/src/types.ts` 的契约注释；这里记的是**可操作的方法与判据**。

上游的两套卡（Apache-2.0 的 video-shotcraft、PolyForm Noncommercial 的 video-talkcraft）
是**规格来源**：读它的时序、缓动、参数表与已知坑，用我们自己的形态实现。
**不要复制它的 Remotion/tsx 代码** —— 我们没有 React/Remotion，复制过来一行都跑不起来。

---

## 一、开发一张卡的标准流程

1. **读上游规格**
   - shotcraft：`gallery/source/<卡名>.md`（意图 / 动效核心 / 参数表 / 已知坑）
   - talkcraft：`references/cards/<卡名>.md`（更细：意图 / 动效核心含工程结构 / 参数表 /
     已知坑 / 复用指引 / 动效范围）
   - 需要精确常量时才读实现（`demos/**/*.tsx`、`demos/<卡名>/index.html`）
2. **写卡**：`packages/cardRuntime/src/cards/<name>.ts`，在 `cards/index.ts` 注册
3. **类型检查**：`cd packages/cardRuntime; bun x tsc --noEmit`
4. **自检**：`bun scripts/checkHtmlCards.mjs --slug <卡名>`（需先起 Chrome，见下）
5. **渲染抽帧看画面**：`bun scripts/renderCard.mjs --card <卡名> --out <路径>`，
   再用 ffmpeg 抽几帧拼图确认动效真的对
6. **提交**：卡的注释里写清上游来源与授权

起 Chrome（本机沙箱不允许脚本自起浏览器）：

```bash
bun scripts/renderCard.mjs --print-chrome   # 打印确切命令
# 在另一个终端跑那条命令；然后 checkHtmlCards / renderCard 会自动连上
```

---

## 二、卡的机制约束（最容易踩的一类）

卡的 `render` 与 `helpers` 里的函数会被 **`toString()` 序列化后内联进页面**。
由此产生三条硬约束：

| 约束 | 症状 | 做法 |
|---|---|---|
| **进 helpers 的函数必须自包含** | 页面**加载失败** | 不引用模块级变量。常量与调色板写在函数体内部 |
| **`render` 本身也必须自包含** | `xxx is not defined` | 同上：常量写进函数体 |
| **不要引用原型上的原生方法** | 页面语法错误（`[native code]`） | 抽取器会跳过原生函数；若报错说明它进了 helpers，去掉即可 |

**为什么**：闭包会带走对外部作用域的引用，而页面里没有那些变量；原生方法的
`toString()` 是 `function x() { [native code] }`，塞进页面就是语法错误。

> 这三条都实际踩过。`buildCardPage` 现在会对「helpers 里含原生函数」直接抛错，
> 不再静默产出坏页面。

---

## 三、布局坑（视觉上不明显，靠自检与抽帧发现）

### 设计坐标（移植上游 `DesignStage`）

卡只按**设计坐标**作画，输出分辨率由 runtime 等比放大：

```
输出 1920×1080 → 设计 480×270  scale 4
输出 1080×1920 → 设计 270×480  scale 4
输出 2560×1080 → 设计 640×270  scale 4
```

**卡参数在设计坐标里标定，换画幅不改参数。** 输出分辨率不是卡参数。

### 字号必须**同时受宽与高约束**

只按高算会在「位数多 / 字多 + 窄画幅」时横向溢出。**这个错误犯过两次**
（`digitRoll`、`counterConfetti`）。竖屏的瓶颈永远是**宽度**。

### 其它坑

| 坑 | 症状 | 做法 |
|---|---|---|
| 列宽没约束 | `overflow:hidden` 按内容宽度撑开，竖条被裁成方块 | 写死列宽（如 `0.62em`）+ `flex:none` |
| 分数像素 | 裁剪窗与内容边界各取整到不同像素，**恰好一列被裁** | 字号与行高 `Math.round` |
| **绝对定位子元素影响 flex 居中** | 末尾一帧容器悄悄偏移 | 用 `margin:auto` 居中，不用 flex 居中 |
| 逐字排版用变宽字体 | 逐帧重排抖动 | 打字/滚动类必须等宽 + `tabular-nums` |
| 表达式里做算术 | 滤镜/样式静默算错 | 加括号（FFmpeg 卡那边踩过同一类） |
| **叠加卡用 jpeg 中间帧** | alpha 被丢掉，叠上去是白框 | 叠加卡走 png 中间帧 + **ProRes 4444** |
| **以为 libvpx-vp9 能保 alpha** | 喂 png 进去也输出 yuv420p，alpha 悄悄没了 | 实测只有 `prores_ks` / `qtrle` / `png` 三种保得住 |
| **render 引用了模块级函数却没进 helpers** | 页面报 `xxx is not defined`，渲染直接失败 | 每个 render 用到的模块级函数都要列进 helpers。**踩过 3 次**（bezierEase / scanTargets / polar）—— 浏览器自检的「页面没加载成功」会抓到 |
| **SVG 宽高用百分比推导的表达式** | 椭圆被压扁成几条竖线 | SVG 宽高写成显式 px，并配同值 viewBox |
| **转场卡的块色与舞台底色相同** | 极端状态下整张卡都是纯色，等于没转场；自检报「帧间无变化」 | 转场卡必须是实心可见的色，舞台底色用中性灰 |
| **自检抽样点太稀疏** | 42 帧的转场卡只抽 0/15/41，动作集中在 6~18 帧 → 误报「动画没生效」 | 抽 6 帧按帧数均分（短卡逐帧） |
| **累加循环里的抖动写成 ±** | 步长可能变负 → 累加值不再增长 → **动画永久停在中途**，不报错 | 抖动**只加不减** |
| **参数是「内容长度的镜像」** | 文案 19 字而参数默认 14 → 只显示前 14 字，看着像动画坏了 | 这类参数一律由内容本身推导，不手填 |

---

## 四、自检的纪律（**同一个坑犯过两次**）

`data-check` **只标注「不该溢出」的元素**。

| 该标 | 不该标 |
|---|---|
| 数字行、色块、标签条、说明行 | 中心辉光（负 margin 居中，本就超出） |
| 数位盒（滚动裁剪窗） | 冲击环（扩散到 2.95 倍，本就超出） |
| | 急推/缩放类容器（放大后本就超出） |

标错的代价：**误报**（辉光/冲击环一次误报 12 项；急推一次误报 8 项）。

另外：**边界不要用 `offsetParent`** —— 卡里常用零尺寸的定位锚点包一层，
那会让边界退化成一条线。自检用的是显式声明的 `[data-check="舞台"]`。

---

## 四之二、全屏卡 vs 叠加卡（两条渲染路径）

`shape` 字段决定渲染路径，不能混：

| shape | 中间帧 | 合成 | 用途 |
|---|---|---|---|
| `fullscreen` | jpeg（快 3.4 倍） | H.264 / yuv420p | 替代这一段画面 |
| `overlay` | png | **ProRes 4444 / yuva444p10le** | 叠在 AI 视频上（必须带 alpha） |

踩过：叠加卡用 jpeg 中间帧 → alpha 丢失 → 叠上去是白框。
又踩过：以为 `libvpx-vp9` 能保 alpha（体积更小）→ 喂 png 也输出 yuv420p。
**实测只有 `prores_ks` / `qtrle` / `png` 三种保得住**，选 ProRes 4444（剪辑软件标准格式）。

### 最隐蔽的一层：Chrome 截图默认合成到不透明白底

即使编码格式选对了，**alpha 仍然是全 255**。原因是 Chrome 截图默认把画面合成到白底上，
哪怕页面自己写了 `html, body { background: transparent }`。

**这一层特别难发现，因为 ffprobe 会骗你**：它报告 `yuva444p12le`，
像素格式确实带 alpha 通道 —— 但通道里全是 255。**「格式带 a」不等于「真有透明区域」**，
必须**量像素**才能发现（`ffmpeg -i x.mov -frames:v 1 -pix_fmt rgba -f rawvideo` 后读第 4 字节）。

修法（两条缺一不可）：

1. CDP `Emulation.setDefaultBackgroundColorOverride` 设成 `{ r:0, g:0, b:0, a:0 }`
2. `Page.captureScreenshot` 时传 `background: "transparent"`

Chrome 154 已**不认**启动参数 `--default-background-color`（传了浏览器直接起不来），
CDP 是唯一有效路径。

### 验证 alpha 的最小判据

```bash
# 抽取一帧为 rgba，读左上角（该处应透明）的 alpha
ffmpeg -y -i card.mov -frames:v 1 -pix_fmt rgba probe.png
ffmpeg -y -i probe.png -f rawvideo -pix_fmt rgba probe.raw
# probe.raw 第 4 个字节就是左上角的 alpha：≈0 才对，255 说明白底没去掉
```

---

## 四之三、`transform: scale` 不占布局空间

关键词弹出、色块定格这类**放大**动效，放大后的内容会**盖住邻字** ——
因为 `scale` 只是绘制变换，布局宽度仍按原尺寸算。

踩过：`keywordPopHighlight` 的关键词定格在 1.15 倍，色块把旁边的字压住了。
肉眼在横屏下不明显，**竖屏合成后一眼看出**。

修法是**预留固定空间 + 反向缩放**：

```html
<!-- 外层占比按 1 倍算（1/settle 的反向缩放抵消内层放大） -->
<span style="margin:0 {溢出量}em">
  <span style="transform:scale(1/settle)">
    <span style="transform:scale({动画倍数})">关键词</span>
  </span>
</span>
```

溢出量 = 字宽 × (定格倍数 − 1) / 2，再加 skew 的横向偏移。
**字号估算也必须按放大后的占位算**，否则窄画幅下整行会溢出。

---

## 五、逐帧渲染的确定性（这条是整条流水线的前提）

**不确定 = 成片逐帧闪。**

| 要求 | 做法 |
|---|---|
| 设帧后**等一次真实绘制**再截图 | 双 `requestAnimationFrame` + 强制 reflow；不要用 `sleep` 赌 |
| 正式抓帧前**预热** | 渲染几帧并等稳定，挡掉页面刚加载时的光栅化过渡态 |
| 随机必须可复现 | 用 `rand(seed)`，**绝不用 `Math.random`** |
| 收尾真静止 | 装饰元素要在末帧前硬摘（如光标 `opacity:0`），不留残留 |

---

## 六、验证判据（做完一张卡要过哪些关）

| 关 | 怎么验 | 通过判据 |
|---|---|---|
| 类型 | `bun x tsc --noEmit` | 零错误 |
| 页面可加载 | 自检脚本 | `window.renderAt` 存在且能执行 |
| **渲染确定性** | 自检：同一帧截两次 | 字节级一致 |
| 动画生效 | 自检：多帧截图 | 帧间有变化 |
| **落位** | 自检：4 种画幅 | `data-check` 元素不越界 |
| 画面正确 | 渲染 + 抽帧拼图 | 动效与上游规格一致（**必须真看，不能只看自检绿**） |

**自检全绿不等于画面对** —— 例如 `numberSlabPop` 的居中偏移自检抓不到，是抽帧看出来的。

---

## 七、两套上游的授权差异（选卡时要看）

| | video-shotcraft | video-talkcraft |
|---|---|---|
| 卡数 | 157（`.tsx`） | 108（`.tsx` + **`demos/*/index.html`**） |
| 许可 | **Apache-2.0** | **PolyForm Noncommercial** |
| 我们的用法 | 读规格 + 自主实现；按 Apache-2.0 标注来源 | **只读规格、独立实现**（商用需授权才能直接用其代码） |
| 特别提示 | 48 张卡的上游自己也是「参考商业宣传片后重写」，商用前建议法务过一眼 | 它的 HTML demo 技术上能直接接入我们的渲染器，但许可不允许商用直接复用 |

卡的注释里统一写一行 `origin:`，注明来源与许可，便于回溯。

---

## 八、当前进度（24 张名单）

```
批次 1 数据类     ✅ digitRoll · ✅ counterConfetti · ✅ numberSlabPop
批次 2 文字类     ✅ typewriterTerminal · ✅ typewriterReveal · ✅ perCharacterRise
批次 3 口播语法   ✅ keywordPopHighlight · ✅ highlighterSweep · ✅ focusDimSpotlight
批次 4 叠加标注   ✅ markerUnderlineTitle · ✅ scanlineAnnotateFocus · ✅ handDrawnEllipse
批次 5 图表       ✅ chartLiveOscilloscope · ✅ gaugeReadout · ✅ barChartGrowth
批次 6 文字强化   ✅ typeAssembly · ✅ softBlurIn · ✅ wordSlotCycle
批次 7 时间轴     ✅ timelineTravel · ✅ metricWithSparkline · ✅ titleDemoteToLabel
批次 8 转场       ✅ wipeTransition · ✅ flashCutLogo · ✅ scanBracketSweep
```

**24 张全部完成（96/96 自检通过）。**

---

## 九、卡怎么被 Agent 用到（接线）

做完卡只是第一步，**卡要被 Agent 看见才能用**。这条链路上有三个必须都通：

| 环节 | 位置 | 不通的后果 |
|---|---|---|
| 卡进检索目录 | `postProduction/cardCatalog.ts` 合并两个卡库 | Agent 完全不知道这些卡存在 |
| `useCard` 读目录 | `tools/postProduction` 的 `useCard` op | 同上（接线前就是这个状态：24 张卡全不可见） |
| 帧渲染 + 合成 | `scripts/renderCard.mjs` + ffmpeg overlay | 卡查得到但用不到成片里 |

**每张 HTML 卡必须显式标 `meta.semantics`**（封闭词表）。不要从文案里猜 ——
踩过：写过「从 oneliner 查关键词」的推导，24 张卡里 23 张语义成了空数组，
语义检索全军覆没。`scripts/checkCardCatalog.mjs` 现在会拦这一条。

**画幅契约**（`postProduction/cardFrame.ts`）：

- 卡是**分辨率无关**的：设计画布「短边恒为 270，长边按画幅比伸缩」，
  所以竖屏视频渲竖屏卡，**不会出现横屏卡拼竖屏视频**
- `fullscreen` / `transition` 按目标画幅渲染；`overlay` 的画幅必须与视频一致
- 代价：竖屏可用宽度只有 270（横屏 480 量级），**长句卡会自动缩字**

**合成的画幅必须与视频一致**：`renderCard.mjs --width --height` 要给成片的宽高。
卡宽高与视频不一致时再缩放一次，字幕与描边会出现非整数像素抖动。
