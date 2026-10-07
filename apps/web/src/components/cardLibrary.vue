<template>
  <el-dialog v-model="visible" title="配方卡片库" width="min(1080px, 96vw)" alignCenter appendToBody destroyOnClose class="cardLibraryDialog">
    <div class="libraryHeader">
      <el-input v-model="keyword" class="searchInput" placeholder="搜索卡片（名称、用途、分类）" :prefix-icon="IconSearch" clearable aria-label="搜索卡片" />
      <el-text size="small" type="info">共 {{ library?.total ?? 0 }} 张 · 分析 {{ library?.counts.analysis ?? 0 }} · HTML {{ library?.counts.html ?? 0 }} · 滤镜 {{ library?.counts.ffmpeg ?? 0 }}</el-text>
    </div>

    <el-scrollbar class="libraryScroll" maxHeight="62dvh">
      <el-text v-if="loading" size="small" type="info">正在读取卡片库…</el-text>
      <el-alert v-else-if="loadError" :title="loadError" type="error" :closable="false" show-icon />

      <section v-for="group in visibleGroups" :key="group.kind" class="cardGroup" :aria-label="group.label">
        <header class="groupHeader">
          <el-text tag="strong">{{ group.label }}</el-text>
          <el-text size="small" type="info">{{ group.cards.length }} 张</el-text>
        </header>
        <el-text class="groupDescription" size="small" type="info">{{ group.description }}</el-text>

        <div class="cardGrid">
          <article v-for="card in group.cards" :key="card.slug" class="cardEntry">
            <!-- HTML 卡有可独立呈现的画面，直接给首帧预览；另两类没有画面可渲染。 -->
            <iframe
              v-if="card.kind === 'html'"
              class="cardPreview"
              :src="previewUrl(card.slug)"
              loading="lazy"
              scrolling="no"
              :title="`${card.title} 预览`"
            />
            <div v-else class="cardBadge" :class="`badge-${card.kind}`">
              <icon-eye v-if="card.kind === 'analysis'" :size="22" />
              <icon-adjustments v-else :size="22" />
            </div>

            <div class="cardBody">
              <div class="cardTitleRow">
                <el-text tag="strong" class="cardTitle">{{ card.title }}</el-text>
                <el-tag v-if="card.kind === 'analysis'" size="small" type="success" disable-transitions>分析</el-tag>
                <el-tag v-else-if="card.shape" size="small" disable-transitions>{{ shapeLabel(card.shape) }}</el-tag>
              </div>
              <el-text class="cardOneliner" size="small">{{ card.oneliner }}</el-text>
              <div class="cardTags">
                <el-tag size="small" type="info" disable-transitions>{{ card.category }}</el-tag>
                <el-tag v-for="item in card.evidence ?? []" :key="item" size="small" type="success" effect="plain" disable-transitions>{{ item }}</el-tag>
                <el-tag v-for="item in card.semantics ?? []" :key="item" size="small" effect="plain" disable-transitions>{{ item }}</el-tag>
                <el-text v-if="card.frames" size="small" type="info">{{ card.frames }} 帧</el-text>
              </div>
              <!-- 分析卡最该被看见的是「为什么必须用它」——不用它会怎样 -->
              <el-text v-if="card.why" class="cardWhy" size="small" type="warning">{{ card.why }}</el-text>
            </div>

            <footer class="cardFooter">
              <el-text size="small" type="info" class="slugText">{{ card.slug }}</el-text>
            </footer>
          </article>
        </div>
      </section>

      <el-text v-if="!loading && !visibleGroups.length" size="small" type="info">没有匹配的卡片。</el-text>
    </el-scrollbar>

    <template #footer>
      <el-text size="small" type="info">分析卡产出证据（帧、词级时间、变化候选），不产出画面；生成视频时先取证，再让 Agent 按卡生成。</el-text>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import axios from "axios";
import { IconAdjustments, IconEye, IconSearch } from "@tabler/icons-vue";

type CardKind = "analysis" | "html" | "ffmpeg";
type CardEntry = {
  kind: CardKind;
  slug: string;
  title: string;
  category: string;
  oneliner: string;
  shape?: "fullscreen" | "overlay" | "transition";
  frames?: number;
  semantics?: string[];
  evidence?: string[];
  why?: string;
};
type CardGroup = { kind: CardKind; label: string; description: string; cards: CardEntry[] };
type CardLibrary = { total: number; counts: Record<CardKind, number>; groups: CardGroup[] };

const visible = defineModel<boolean>({ required: true });

const library = ref<CardLibrary>();
const loading = ref(false);
const loadError = ref("");
const keyword = ref("");

const shapeLabels: Record<string, string> = { fullscreen: "全屏", overlay: "叠加", transition: "转场" };
function shapeLabel(shape: string) {
  return shapeLabels[shape] ?? shape;
}

function previewUrl(slug: string) {
  return `/api/cardPreview?slug=${encodeURIComponent(slug)}&width=270&height=480`;
}

const visibleGroups = computed(() => {
  const groups = library.value?.groups ?? [];
  const query = keyword.value.trim().toLowerCase();
  if (!query) return groups.filter(group => group.cards.length);
  return groups
    .map(group => ({
      ...group,
      cards: group.cards.filter(card =>
        [card.title, card.oneliner, card.category, card.slug, ...(card.semantics ?? []), ...(card.evidence ?? [])]
          .join(" ")
          .toLowerCase()
          .includes(query)),
    }))
    .filter(group => group.cards.length);
});

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const { data } = await axios.get<{ code: number; data: CardLibrary; message?: string }>("/api/cardLibrary", {
      headers: { "x-toonflow-workspace": "1" },
    });
    if (data.code !== 200 || !data.data) throw new Error(data.message || "读取卡片库失败");
    library.value = data.data;
  } catch (error) {
    loadError.value = axios.isAxiosError<{ message?: string }>(error)
      ? error.response?.data?.message ?? error.message
      : error instanceof Error ? error.message : "读取卡片库失败";
  } finally {
    loading.value = false;
  }
}

// 每次打开都重新读：卡库会随插件与技能更新，缓存一份会让用户看到过期内容。
watch(visible, open => { if (open) void load(); }, { immediate: true });
</script>

<style scoped lang="scss">
.libraryHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;

  .searchInput {
    max-width: 320px;
  }
}

.libraryScroll {
  padding-right: 4px;
}

.cardGroup {
  margin-bottom: 20px;

  .groupHeader {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .groupDescription {
    display: block;
    margin: 4px 0 10px;
  }
}

.cardGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(228px, 1fr));
  gap: 12px;
}

.cardEntry {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  overflow: hidden;
  background: var(--el-bg-color);

  .cardPreview {
    display: block;
    width: 100%;
    height: 140px;
    border: 0;
    background: #000;
  }

  .cardBadge {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 140px;
    color: var(--el-text-color-secondary);
    background: var(--el-fill-color-light);

    &.badge-analysis {
      color: var(--el-color-success);
      background: var(--el-color-success-light-9);
    }
  }

  .cardBody {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    flex: 1;
  }

  .cardTitleRow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;

    .cardTitle {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .cardOneliner {
    line-height: 1.5;
  }

  .cardTags {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
  }

  .cardWhy {
    line-height: 1.5;
  }

  .cardFooter {
    padding: 6px 10px;
    border-top: 1px solid var(--el-border-color-lighter);

    .slugText {
      font-family: var(--el-font-family-mono, monospace);
    }
  }
}
</style>
