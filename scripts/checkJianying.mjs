// 校验剪映草稿的**字段结构**与不变量，防止以后改动悄悄破坏格式。
//
// 字段清单来自 pyJianYingDraft 0.3.0 的序列化器与两个模板资源（该库在剪映
// 专业版 5.9 / Windows 实测通过生成方向）。清单内联在这里，运行时不依赖那个库。
//
// **这里验不了的事**：本机没有剪映，所以「剪映能打开这份草稿」无法验证。
// 这一步只能靠真机冒烟（见 readme）。
//
// 用法：bun scripts/checkJianying.mjs [--quiet]
import { buildJianyingDraft } from "@toonflow/post-production";

const quiet = process.argv.includes("--quiet");
const log = message => { if (!quiet) console.log(message); };

// 模板里所有**有确定值**的字段路径（数组元素形状由不变量覆盖，这里只比字段名）
const contentFields = [
  "canvas_config.height", "canvas_config.ratio", "canvas_config.width", "color_space",
  "config.adjust_max_index", "config.attachment_info", "config.combination_max_index", "config.export_range",
  "config.extract_audio_last_index", "config.lyrics_recognition_id", "config.lyrics_sync", "config.lyrics_taskinfo",
  "config.maintrack_adsorb", "config.material_save_mode", "config.multi_language_current", "config.multi_language_list",
  "config.multi_language_main", "config.multi_language_mode", "config.original_sound_last_index",
  "config.record_audio_last_index", "config.sticker_max_index", "config.subtitle_keywords_config",
  "config.subtitle_recognition_id", "config.subtitle_sync", "config.subtitle_taskinfo", "config.system_font_list",
  "config.video_mute", "config.zoom_info_params", "cover", "create_time", "duration", "extra_info", "fps",
  "free_render_index_mode_on", "group_container", "id", "keyframe_graph_list",
  "keyframes.adjusts", "keyframes.audios", "keyframes.effects", "keyframes.filters", "keyframes.handwrites",
  "keyframes.stickers", "keyframes.texts", "keyframes.videos",
  "last_modified_platform.app_id", "last_modified_platform.app_source", "last_modified_platform.app_version",
  "last_modified_platform.os", "platform.app_id", "platform.app_source", "platform.app_version", "platform.os",
  "mutable_config", "name", "new_version", "relationships", "render_index_track_mode_on", "retouch_cover",
  "source", "static_cover_image_path", "time_marks", "update_time", "version",
];

const materialKeys = [
  "ai_translates", "audio_balances", "audio_effects", "audio_fades", "audio_track_indexes", "audios", "beats",
  "canvases", "chromas", "color_curves", "digital_humans", "drafts", "effects", "flowers", "green_screens",
  "handwrites", "hsl", "images", "log_color_wheels", "loudnesses", "manual_deformations", "masks",
  "material_animations", "material_colors", "multi_language_refs", "placeholders", "plugin_effects",
  "primary_color_wheels", "realtime_denoises", "shapes", "smart_crops", "smart_relights", "sound_channel_mappings",
  "speeds", "stickers", "tail_leaders", "text_templates", "texts", "time_marks", "transitions", "video_effects",
  "video_trackings", "videos", "vocal_beautifys", "vocal_separations",
];

const metaFields = [
  "cloud_package_completed_time", "draft_cloud_capcut_purchase_info", "draft_cloud_last_action_download",
  "draft_cloud_materials", "draft_cloud_purchase_info", "draft_cloud_template_id", "draft_cloud_tutorial_info",
  "draft_cloud_videocut_purchase_info", "draft_cover", "draft_deeplink_url",
  "draft_enterprise_info.draft_enterprise_extra", "draft_enterprise_info.draft_enterprise_id",
  "draft_enterprise_info.draft_enterprise_name", "draft_enterprise_info.enterprise_material",
  "draft_fold_path", "draft_id", "draft_is_ai_packaging_used", "draft_is_ai_shorts", "draft_is_ai_translate",
  "draft_is_article_video_draft", "draft_is_from_deeplink", "draft_is_invisible", "draft_materials",
  "draft_materials_copied_info", "draft_name", "draft_new_version", "draft_removable_storage_device",
  "draft_root_path", "draft_segment_extra_info", "draft_type", "tm_draft_cloud_completed",
  "tm_draft_cloud_modified", "tm_draft_removed", "tm_duration",
];

function readPath(object, path) {
  return path.split(".").reduce((current, key) => (current == null ? undefined : current[key]), object);
}

const failures = [];
const check = (label, ok, detail = "") => {
  if (!ok) failures.push(`${label}${detail ? "：" + detail : ""}`);
};

const draft = buildJianyingDraft({
  width: 1920, height: 1080, fps: 30, name: "格式校验",
  platePath: "C:/tmp/plate.mp4", plateDurationUs: 9_000_000,
  shots: [{ id: "s01", startFrame: 0, endFrame: 71 }, { id: "s02", startFrame: 71, endFrame: 270 }],
  bgm: { path: "C:/tmp/bgm.mp3", durationUs: 9_000_000, volume: 0.72 },
  sfxLanes: [[{ path: "C:/tmp/hit.wav", durationUs: 300_000, startUs: 1_000_000, volume: 0.9 }]],
  subtitles: [{ text: "验证字幕", beginMs: 0, endMs: 2000, size: 6.0, color: [1, 1, 1], y: -0.8 }],
});
const content = JSON.parse(draft.content);
const meta = JSON.parse(draft.meta);

for (const field of contentFields) check(`draft_content 缺字段 ${field}`, readPath(content, field) !== undefined);
for (const field of metaFields) check(`draft_meta_info 缺字段 ${field}`, readPath(meta, field) !== undefined);
const missingMaterialKeys = materialKeys.filter(key => !(key in content.materials));
const extraMaterialKeys = Object.keys(content.materials).filter(key => !materialKeys.includes(key));
check("materials 缺键", missingMaterialKeys.length === 0, missingMaterialKeys.join(", "));
check("materials 多键", extraMaterialKeys.length === 0, extraMaterialKeys.join(", "));

// 素材引用完整
const materialIds = new Set();
for (const list of Object.values(content.materials)) {
  if (Array.isArray(list)) for (const item of list) if (item?.id) materialIds.add(item.id);
}
const dangling = content.tracks.flatMap(track => track.segments.filter(seg => !materialIds.has(seg.material_id)).map(seg => `${track.name}/${seg.id}`));
check("存在悬空的 material_id", dangling.length === 0, dangling.slice(0, 5).join(", "));

// render_index = 轨道下标
const renderIssues = [];
content.tracks.forEach((track, index) => {
  for (const seg of track.segments) {
    if (seg.render_index !== index) renderIssues.push(`${track.name}:${seg.render_index}≠${index}`);
    if (seg.track_render_index !== 0) renderIssues.push(`${track.name}:track_render_index≠0`);
  }
});
check("render_index 未等于轨道下标", renderIssues.length === 0, renderIssues.slice(0, 5).join(", "));

// 同轨不重叠
for (const track of content.tracks) {
  const sorted = [...track.segments].sort((left, right) => left.target_timerange.start - right.target_timerange.start);
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1].target_timerange.start + sorted[i - 1].target_timerange.duration;
    check(`${track.name} 第 ${i} 段与前段重叠`, sorted[i].target_timerange.start >= prevEnd);
  }
}

// 底片切段：source = target，且首尾严格相接
const plate = content.tracks.find(track => track.type === "video");
plate.segments.forEach((seg, i) => {
  const st = seg.source_timerange, tt = seg.target_timerange;
  check("底片第 " + i + " 段 source≠target", st.start === tt.start && st.duration === tt.duration);
  if (i > 0) {
    const prev = plate.segments[i - 1].target_timerange;
    check("底片第 " + i + " 段与前段不相接", prev.start + prev.duration === tt.start);
  }
});
check("duration ≠ 末段终点", content.duration === plate.segments[plate.segments.length - 1].target_timerange.start + plate.segments[plate.segments.length - 1].target_timerange.duration);
check("tm_duration ≠ duration", meta.tm_duration === content.duration);

// 素材登记
const registered = new Set((meta.draft_materials.find(item => item.type === 0)?.value ?? []).map(item => item.id));
const expected = [...content.materials.videos, ...content.materials.audios].map(item => item.id);
const unregistered = expected.filter(id => !registered.has(id));
check("有音视频素材未登记进 draft_materials[type 0]", unregistered.length === 0, `漏 ${unregistered.length}/${expected.length}`);

// texts 的 content 必须是字符串
for (const text of content.materials.texts) check("texts.content 不是字符串", typeof text.content === "string");

// 幂等
const again = buildJianyingDraft({
  width: 1920, height: 1080, fps: 30, name: "格式校验",
  platePath: "C:/tmp/plate.mp4", plateDurationUs: 9_000_000,
  shots: [{ id: "s01", startFrame: 0, endFrame: 71 }, { id: "s02", startFrame: 71, endFrame: 270 }],
  bgm: { path: "C:/tmp/bgm.mp3", durationUs: 9_000_000, volume: 0.72 },
  sfxLanes: [[{ path: "C:/tmp/hit.wav", durationUs: 300_000, startUs: 1_000_000, volume: 0.9 }]],
  subtitles: [{ text: "验证字幕", beginMs: 0, endMs: 2000, size: 6.0, color: [1, 1, 1], y: -0.8 }],
});
check("两次导出不一致", again.content === draft.content && again.meta === draft.meta);

if (failures.length) {
  console.log(`剪映草稿格式校验失败 ${failures.length} 项：`);
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exit(1);
}
log(`  ✓ 剪映草稿格式：${contentFields.length + metaFields.length + materialKeys.length} 个字段与不变量全部通过`);
console.log(`剪映草稿格式校验通过（字段 ${contentFields.length + metaFields.length + materialKeys.length} 项 + 结构不变量）`);
