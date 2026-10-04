<template>
  <!-- ACT: 极简背景。替换上游两个重动效组件（SVG 光带+星点 275 行、canvas 胶片动画 298 行）。
       这里只有两个静态 CSS 渐变层 + 一层 24 秒的缓慢漂移，没有 SVG、没有 canvas、没有 JS。
       动效只为避免画面完全死板；prefers-reduced-motion 下完全静止。 -->
  <div class="minimalBackground" aria-hidden="true">
    <div class="glow" />
  </div>
</template>

<style lang="scss" scoped>
.minimalBackground {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  background-color: var(--el-bg-color);

  /* 细点阵：一层静态纹理，给大片留白一点材质感 */
  background-image: radial-gradient(circle, var(--el-border-color) 1px, transparent 1px);
  background-size: 22px 22px;

  .glow {
    position: absolute;
    /* 比容器大一圈，漂移时不会露出边缘 */
    inset: -20%;
    background:
      radial-gradient(ellipse 42% 34% at 26% 16%, color-mix(in srgb, var(--el-color-primary) 13%, transparent), transparent 70%),
      radial-gradient(ellipse 34% 30% at 82% 74%, color-mix(in srgb, var(--el-color-primary) 9%, transparent), transparent 70%);
    animation: minimalDrift 24s ease-in-out infinite alternate;
  }
}

@keyframes minimalDrift {
  from { transform: translate3d(-1.5%, -1%, 0) scale(1); }
  to   { transform: translate3d(1.5%, 1.5%, 0) scale(1.04); }
}

/* 无障碍：尊重系统的"减少动态效果"设置，完全静止 */
@media (prefers-reduced-motion: reduce) {
  .minimalBackground .glow {
    animation: none;
  }
}
</style>
