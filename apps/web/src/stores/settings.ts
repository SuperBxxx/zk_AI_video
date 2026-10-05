import axios from "axios";
import { normalizeLocale } from "@toonflow/i18n";
import { computed, nextTick, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { invalidateNodeModels } from "@toonflow/nodes-scaffold/nodeAi";
import { canvasShortcutFields, defaultCanvasShortcuts, getShortcutBindings, isShortcutAllowed, normalizeShortcut, type CanvasShortcuts } from "@/lib/canvasShortcuts";
import "element-plus/es/components/message/style/css";

export const settings = ref<Record<string, unknown>>({});
// ACT: 页面在 loadSettings 完成后才挂载，加载标记仅保留在设置初始化与自动保存内部。
let settingsReady = false;
let saveQueue = Promise.resolve();
let applyingSettings = false;

export const settingsStorage = {
  getItem(key: string) {
    const stores = settings.value.stores as Record<string, unknown> | undefined;
    if (stores && Object.hasOwn(stores, key)) return JSON.stringify(stores[key]);
    // ACT: 只迁移当前来源可读取的旧缓存，保留原值；不同端口的 localStorage 不能互读。
    const value = localStorage.getItem(key);
    if (value !== null) settingsStorage.setItem(key, value);
    return value;
  },
  setItem(key: string, value: string) {
    settings.value.stores = { ...(settings.value.stores as Record<string, unknown> | undefined), [key]: JSON.parse(value) };
  },
};

// ACT: primaryColor 原为 Element Plus 出厂蓝 #409eff —— 那是"一眼就是默认皮肤"的主要来源。
// 现用品牌竹绿 #2E9E6B：比早先的深青绿 #1F8A70 更饱和、更明确，主按钮与选中态能一眼看出是绿的，
// 在浅色底上也不会糊成灰。派生色阶（light-1..9 / dark-2）由 App.vue 用 color-mix 运行时生成，
// 所以改这一处即可全站生效，不需要手工维护色阶。
export const defaultUiSettings = { theme: "light", language: "system", primaryColor: "#2E9E6B", fontScale: 100, radius: 6 };
export const uiSettings = computed(() => {
  const raw = settings.value.ui;
  const ui = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return {
    language: normalizeLocale(ui.language) ?? "system" as const,
    theme: ui.theme === "dark" || ui.theme === "system" ? ui.theme : "light",
    primaryColor: typeof ui.primaryColor === "string" && /^#[\da-f]{6}$/i.test(ui.primaryColor) ? ui.primaryColor : defaultUiSettings.primaryColor,
    fontScale: typeof ui.fontScale === "number" && Number.isFinite(ui.fontScale) ? Math.min(125, Math.max(85, ui.fontScale)) : defaultUiSettings.fontScale,
    radius: typeof ui.radius === "number" && Number.isFinite(ui.radius) ? Math.min(16, Math.max(0, ui.radius)) : defaultUiSettings.radius,
  };
});

export function updateUiSettings(patch: Partial<typeof defaultUiSettings>) {
  const current = settings.value.ui;
  settings.value = { ...settings.value, ui: { ...(current && typeof current === "object" && !Array.isArray(current) ? current : {}), ...patch } };
}

export const generalSettings = computed(() => {
  const raw = settings.value.general;
  const general = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const shortcuts = general.canvasShortcuts && typeof general.canvasShortcuts === "object" && !Array.isArray(general.canvasShortcuts)
    ? general.canvasShortcuts as Record<string, unknown> : {};
  const savedBindings = new Map(canvasShortcutFields.flatMap(field => {
    const value = shortcuts[field.id];
    const binding = typeof value === "string" ? normalizeShortcut(value) : undefined;
    return binding !== undefined && isShortcutAllowed(field, binding) ? [[field.id, binding] as const] : [];
  }));
  return {
    canvasCompositingEnabled: general.canvasCompositingEnabled === true,
    canvasEdgeAnimationEnabled: general.canvasEdgeAnimationEnabled !== false,
    canvasEdgeColorMode: general.canvasEdgeColorMode === "none" || general.canvasEdgeColorMode === "custom" ? general.canvasEdgeColorMode : "theme",
    canvasEdgeColor: typeof general.canvasEdgeColor === "string" && /^#[\da-f]{6}$/i.test(general.canvasEdgeColor) ? general.canvasEdgeColor : defaultUiSettings.primaryColor,
    canvasShortcuts: Object.fromEntries(canvasShortcutFields.map(field => {
      if (savedBindings.has(field.id)) return [field.id, savedBindings.get(field.id)];
      const binding = defaultCanvasShortcuts[field.id];
      const conflicts = canvasShortcutFields.some(other => other.gesture === field.gesture
        && getShortcutBindings(savedBindings.get(other.id) ?? "").some(value => getShortcutBindings(binding).includes(value)));
      return [field.id, conflicts ? "" : binding];
    })) as CanvasShortcuts,
  };
});

export function updateGeneralSettings(patch: Partial<typeof generalSettings.value>) {
  const current = settings.value.general;
  settings.value = { ...settings.value, general: { ...(current && typeof current === "object" && !Array.isArray(current) ? current : {}), ...patch } };
}

export type CustomProviderModel = { id: string; label: string; contextWindow?: number; maxOutputTokens?: number };
export type CustomProvider = { id: string; label: string; version?: string; apiUrl: string; apiKey: string; protocol: string; models: CustomProviderModel[] };
export const customProviders = computed<CustomProvider[]>(() => Array.isArray(settings.value.customProviders)
  ? settings.value.customProviders.filter((item): item is CustomProvider => !!item && typeof item.id === "string" && typeof item.label === "string" && Array.isArray(item.models)
    && item.models.every((model: CustomProviderModel) => !!model && typeof model.id === "string" && typeof model.label === "string"))
  : []);

export const modelChoices = computed(() => customProviders.value.flatMap(provider => provider.models.map(model => ({
  value: JSON.stringify([provider.id, model.id]), providerId: provider.id, modelId: model.id, label: model.label, contextWindow: model.contextWindow,
}))));

export async function loadSettings() {
  if (settingsReady) return;
  const { data } = await axios.get("/api/settings/get", { headers: { "Cache-Control": "no-cache", "x-toonflow-workspace": "1" } });
  if (settingsReady) return;
  if (data.code !== 200 || !data.data || typeof data.data !== "object" || Array.isArray(data.data)) {
    throw new Error("读取设置失败");
  }
  settings.value = migrate(data.data);
  // 等初始化引发的监听执行完，再允许自动保存。
  await nextTick();
  settingsReady = true;
}

// ACT: 一次性迁移被替换掉的主题色。旧版本的 primaryColor 会持久化在服务端配置里，
// 优先级高于代码默认值 —— 不迁移的话，凡是装过旧版本的机器都会一直停留在旧配色上，
// 代码里改默认色对它们完全无效。只迁移明确作废的旧值，不触碰用户自己选的颜色。
// 统一转大写再比较，避免 hex 大小写差异导致漏迁移。
const retiredPrimaryColors = new Set(["#409EFF", "#1F8A70"]);
function migrate(value: Record<string, unknown>): Record<string, unknown> {
  const ui = value.ui;
  if (!ui || typeof ui !== "object" || Array.isArray(ui)) return value;
  const primaryColor = (ui as Record<string, unknown>).primaryColor;
  if (typeof primaryColor !== "string" || !retiredPrimaryColors.has(primaryColor.toUpperCase())) return value;
  const { primaryColor: _retired, ...rest } = ui as Record<string, unknown>;
  return { ...value, ui: rest };
}

export function saveSettings(update?: (current: Record<string, unknown>) => Record<string, unknown> | undefined) {
  // ACT: 队列内读取最新配置再计算变更，确认成功后发布；仅协调当前页面的保存。
  const saving = saveQueue.then(async () => {
    const patch = update?.(settings.value);
    if (update && !patch) return false;
    const { data } = await axios.put("/api/settings/save", { settings: { ...settings.value, ...patch } }, { headers: { "x-toonflow-workspace": "1" } });
    if (data.code !== 200) throw new Error("保存设置失败");
    if (patch && Object.hasOwn(patch, "customProviders")) invalidateNodeModels("language");
    if (patch) {
      applyingSettings = true;
      try { settings.value = { ...settings.value, ...patch }; }
      finally { applyingSettings = false; }
    }
    return true;
  });
  saveQueue = saving.then(() => {}, () => {});
  return saving;
}

watch(settings, () => {
  if (!settingsReady || applyingSettings) return;
  void saveSettings().catch(() => { ElMessage.error("设置保存失败，请稍后重试"); });
}, { deep: true, flush: "sync" });
