<template>
  <el-card class="preferredPanel" shadow="never">
    <div class="preferredHeader">
      <el-text tag="strong">优先选择模型</el-text>
      <el-text size="small" type="info">按顺序优先使用；每一项都不可用时，再退回默认选择。</el-text>
    </div>

    <div v-if="rows.length" class="preferredList">
      <div v-for="(row, index) in rows" :key="row.key" class="preferredRow">
        <el-text class="preferredOrder" size="small" type="info">{{ index + 1 }}</el-text>
        <el-text class="preferredName" :title="row.label">{{ row.label }}</el-text>
        <el-text class="preferredProvider" size="small" type="info" :title="row.providerLabel">{{ row.providerLabel }}</el-text>
        <!-- 上移/下移改的就是优先级，因此放在最显眼的位置。 -->
        <el-button text :icon="IconArrowUp" :disabled="index === 0 || saving" :aria-label="'上移 ' + row.label" @click="move(index, -1)" />
        <el-button text :icon="IconArrowDown" :disabled="index === rows.length - 1 || saving" :aria-label="'下移 ' + row.label" @click="move(index, 1)" />
        <el-button text type="danger" :icon="IconTrash" :disabled="saving" :aria-label="'移除 ' + row.label" @click="remove(index)" />
      </div>
    </div>
    <el-text v-else size="small" type="info">还没有偏好设置。</el-text>

    <div class="preferredAdd">
      <el-select v-model="draftProvider" class="addProvider" filterable clearable placeholder="选择供应商" :disabled="saving" aria-label="偏好供应商">
        <el-option v-for="item in providerOptions" :key="item.id" :label="item.label" :value="item.id" />
      </el-select>
      <el-select v-model="draftModel" class="addModel" filterable clearable placeholder="选择模型" :disabled="saving || !draftProvider" aria-label="偏好模型">
        <el-option v-for="item in modelOptions" :key="item.id" :label="item.label" :value="item.id" />
      </el-select>
      <el-button type="primary" :icon="IconPlus" :disabled="!draftProvider || !draftModel || saving" @click="add">添加</el-button>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from "@tabler/icons-vue";
import { customProviders, saveSettings, settings } from "@/stores/settings";

type Scope = "text" | "video" | "audio";
type Choice = { providerId: string; providerLabel: string; modelId: string; modelLabel: string };

const { scope, available } = defineProps<{
  scope: Scope;
  /** 当前可用的模型（由所在页面提供：媒体模型来自 /api/ai/media/models，语音来自其音频子集，文本来自已配置供应商）。 */
  available: Choice[];
}>();

const saving = ref(false);
const draftProvider = ref("");
const draftModel = ref("");

/** 已保存的偏好，只保留本 scope 的项，并按数组顺序当作优先级。 */
const saved = computed(() => {
  const value = settings.value.preferredModels;
  return Array.isArray(value) ? value : [];
});

const rows = computed(() => {
  const pool = new Map(available.map(item => [`${item.providerId}::${item.modelId}`, item]));
  return saved.value
    .map((item, index) => ({ item, index }))
    .filter(entry => entry.item && typeof entry.item === "object" && (entry.item as { scope?: string }).scope === scope)
    .map(entry => {
      const item = entry.item as { providerId: string; modelId: string };
      const hit = pool.get(`${item.providerId}::${item.modelId}`);
      return {
        key: `${item.providerId}::${item.modelId}`,
        providerId: item.providerId,
        modelId: item.modelId,
        // ACT: 找不到就把 id 当标签显示并标明"不可用" —— 供应商可能被卸载，
        // 直接隐藏会让用户以为设置丢了。
        label: hit?.modelLabel ?? `${item.modelId}（不可用）`,
        providerLabel: hit?.providerLabel ?? item.providerId,
      };
    });
});

const providerOptions = computed(() => {
  const grouped = new Map<string, string>();
  for (const item of available) if (!grouped.has(item.providerId)) grouped.set(item.providerId, item.providerLabel);
  return [...grouped].map(([id, label]) => ({ id, label }));
});

const modelOptions = computed(() =>
  available.filter(item => item.providerId === draftProvider.value).map(item => ({ id: item.modelId, label: item.modelLabel })));

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "保存失败";
}

/** 保存整份偏好：本 scope 的项替换为新顺序，其余 scope 原样保留。 */
async function persist(next: { scope: Scope; providerId: string; modelId: string }[]) {
  saving.value = true;
  try {
    const others = saved.value.filter(item => item && typeof item === "object" && (item as { scope?: string }).scope !== scope);
    await saveSettings(() => ({ preferredModels: [...next, ...others] }));
  } catch (error) {
    ElMessage.error(errorMessage(error));
  } finally {
    saving.value = false;
  }
}

/** 把当前 rows 的顺序写回（rows 的 label 是展示用，存的是标识）。 */
function currentEntries() {
  return rows.value.map(row => ({ scope, providerId: row.providerId, modelId: row.modelId }));
}

function add() {
  const key = `${draftProvider.value}::${draftModel.value}`;
  if (rows.value.some(row => row.key === key)) {
    ElMessage.warning("这个模型已经在偏好列表里了");
    return;
  }
  void persist([...currentEntries(), { scope, providerId: draftProvider.value, modelId: draftModel.value }]);
  draftModel.value = "";
}

function remove(index: number) {
  void persist(currentEntries().filter((_, position) => position !== index));
}

function move(index: number, offset: number) {
  const entries = currentEntries();
  const target = index + offset;
  if (target < 0 || target >= entries.length) return;
  [entries[index], entries[target]] = [entries[target]!, entries[index]!];
  void persist(entries);
}
</script>

<style lang="scss" scoped>
.preferredPanel {
  margin-bottom: 12px;

  :deep(.el-card__body) { padding: 12px; }

  .preferredHeader {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin-bottom: 10px;
  }

  .preferredList {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
  }

  .preferredRow {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: var(--ui-radius-small);

    .preferredOrder {
      flex: 0 0 18px;
      text-align: center;
    }

    .preferredName {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .preferredProvider {
      flex: 0 0 auto;
      max-width: 40%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .el-button { flex: 0 0 auto; }
  }

  .preferredAdd {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;

    .addProvider { flex: 1 1 160px; min-width: 0; }
    .addModel { flex: 1 1 160px; min-width: 0; }
    .el-button { margin-left: 0; }
  }
}
</style>
