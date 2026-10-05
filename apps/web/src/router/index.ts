import { createRouter, createWebHashHistory } from "vue-router";

// 不再有独立的引导页：所有用户直接进首页。
// 未配置模型时的提醒改由首页的模态承担（components/modelSetupDialog.vue），
// 因此路由层不再需要判断「引导是否完成」。
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      redirect: "/home",
    },
    {
      // 旧地址兼容：原先的 /hello 引导页已移除，直接送去首页。
      path: "/hello",
      redirect: "/home",
    },
    {
      path: "/home",
      component: () => import("@/pages/home/index.vue"),
    },
    {
      path: "/canvas",
      redirect: "/workspace",
    },
    {
      path: "/workspace",
      component: () => import("@/pages/workspace/index.vue"),
    },
  ],
});

export default router;
