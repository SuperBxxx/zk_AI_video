// @hutch cottontail=0.5.0
// ACT: 钉住 Electrobun 版本。不钉的话 hutch 在 stable 频道上漂移到最新版（2.0.2）并去
// GitHub 下载 devkit；而本项目锁的是 2.0.1（依赖与已缓存的 devkit 都是 2.0.1）。
export default {
  packageManager: "bun",
  electrobun: {
    version: "2.0.1",
  },
};
