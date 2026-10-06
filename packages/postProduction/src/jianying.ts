// 剪映草稿导出：把切段表与字幕变成剪映专业版能打开的工程文件。
//
// 格式来源（重要）：**不是猜的**。字段结构逐项对照 pyJianYingDraft 0.3.0 的
// 序列化器（local_materials.py / segment.py / video_segment.py / audio_segment.py /
// text_segment.py / track.py / script_file.py）与它的两个模板资源
// （draft_content_template.json / draft_meta_info.json）确定。
// 该库在剪映专业版 5.9（Windows）实测通过生成方向。
//
// 但必须说清**未验证的部分**：本机没有剪映，所以「生成的草稿能被剪映打开」
// 这一步未经真机验证 —— 高风险的是我可能漏掉某个必需字段，而剪映对缺字段的
// 反应是「内容已损坏」。所以导出物只写到工作区，**不自动装进剪映草稿库**；
// 首次使用请按 README 的冒烟步骤先验一个最小草稿。
//
// 本模块是纯逻辑（不碰文件系统），返回两个文件的内容字符串，由调用方落盘。

/** 剪映草稿的画布与轨道类型。 */
export interface JianyingOptions {
  width: number;
  height: number;
  fps: number;
  /** 草稿名（也是剪映列表里显示的名字）。 */
  name: string;
  /** 底片素材的绝对路径（剪映要读它）。 */
  platePath: string;
  /** 底片素材的真实时长（微秒），用于素材登记。 */
  plateDurationUs: number;
  shots: { id: string; startFrame: number; endFrame: number }[];
  bgm?: { path: string; durationUs: number; volume: number };
  /** 音效轨：同一轨内的片段不能重叠，所以按道分轨。 */
  sfxLanes?: { path: string; durationUs: number; startUs: number; volume: number }[][];
  /** 字幕轨，一条轨一种样式（一个文本段只能一种字号，中英双语要拆两轨）。 */
  subtitles?: { text: string; beginMs: number; endMs: number; size: number; color: [number, number, number]; y: number }[];
}

/**
 * 生成稳定且唯一的 32 位十六进制 id。
 *
 * ACT: 不用 `crypto.randomUUID()` —— 本模块会被打进 agent 工具产物，跑在
 * 只给了 fetch/ffmpeg 的沙箱里，不保证有 crypto。剪映只要求 id 在草稿内唯一，
 * 所以用「种子 + 计数器」的伪随机即可。种子由草稿名与内容派生，同一份输入
 * 每次导出得到相同 id，便于比对两次导出的差异。
 */
function makeIdFactory(seed: string) {
  let state = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    state ^= seed.charCodeAt(i);
    state = Math.imul(state, 0x01000193) >>> 0;
  }
  let counter = 0;
  return () => {
    counter += 1;
    let value = state ^ Math.imul(counter, 0x9e3779b1);
    let out = "";
    for (let i = 0; i < 4; i++) {
      value ^= value << 13; value >>>= 0;
      value ^= value >>> 17;
      value ^= value << 5; value >>>= 0;
      out += value.toString(16).padStart(8, "0");
    }
    return out.slice(0, 32);
  };
}

/** 微秒计时区间。start/duration 两个整数，**时长必须由两个边界相减得出**。 */
function timerange(startUs: number, durationUs: number) {
  return { start: startUs, duration: durationUs };
}

/** 素材集合的键名与顺序照抄库的 ScriptMaterial.export_json（键一个都不能少）。 */
function emptyMaterials() {
  return {
    ai_translates: [], audio_balances: [], audio_effects: [], audio_fades: [],
    audio_track_indexes: [], audios: [], beats: [], canvases: [], chromas: [],
    color_curves: [], digital_humans: [], drafts: [], effects: [], flowers: [],
    green_screens: [], handwrites: [], hsl: [], images: [], log_color_wheels: [],
    loudnesses: [], manual_deformations: [], masks: [], material_animations: [],
    material_colors: [], multi_language_refs: [], placeholders: [], plugin_effects: [],
    primary_color_wheels: [], realtime_denoises: [], shapes: [], smart_crops: [],
    smart_relights: [], sound_channel_mappings: [], speeds: [], stickers: [],
    tail_leaders: [], text_templates: [], texts: [], time_marks: [], transitions: [],
    video_effects: [], video_trackings: [], videos: [], vocal_beautifys: [],
    vocal_separations: [],
  } as Record<string, unknown[]>;
}

/** 新建设备信息的默认裁剪设置（照抄 CropSettings 的默认值）。 */
function defaultCrop() {
  return { lower_left_x: 0.0, lower_left_y: 1.0, lower_right_x: 1.0, lower_right_y: 1.0, upper_left_x: 0.0, upper_left_y: 0.0, upper_right_x: 1.0, upper_right_y: 0.0 };
}

function defaultClip() {
  return { alpha: 1.0, flip: { horizontal: false, vertical: false }, rotation: 0.0, scale: { x: 1.0, y: 1.0 }, transform: { x: 0.0, y: 0.0 } };
}

/**
 * 生成剪映草稿的两个文件。
 *
 * 轨道顺序（`render_index` 就是数组下标，库在导出时按下标回填）：
 *   底片（video）→ BGM（audio）→ SFX 各道（audio）→ 字幕各轨（text）
 * 底片轨放最前，字幕轨靠后 —— 剪映里索引越大越靠上层显示。
 */
export function buildJianyingDraft(options: JianyingOptions): { content: string; meta: string } {
  const nextId = makeIdFactory(`${options.name}|${options.width}x${options.height}|${options.shots.length}`);
  const materials = emptyMaterials();
  const tracks: unknown[] = [];

  // ── 底片素材（切段共用同一份素材，这是「同一文件不同 source_timerange」的用法） ──
  const plateId = nextId();
  const plateName = options.platePath.split(/[\\/]/).pop() ?? "plate.mp4";
  materials.videos.push({
    audio_fade: null,
    category_id: "",
    category_name: "local",
    check_flag: 63487,
    crop: defaultCrop(),
    crop_ratio: "free",
    crop_scale: 1.0,
    duration: options.plateDurationUs,
    height: options.height,
    id: plateId,
    local_material_id: "",
    material_id: plateId,
    material_name: plateName,
    media_path: "",
    path: options.platePath,
    type: "video",
    width: options.width,
  });

  // ── 底片轨：每个镜头一段，source 与 target 同区间 → 每段可在剪映单独变速/重排 ──
  const plateSegments = options.shots.map(shot => {
    const startUs = Math.round((shot.startFrame * 1_000_000) / options.fps);
    const endUs = Math.round((shot.endFrame * 1_000_000) / options.fps);
    const speedId = nextId();
    materials.speeds.push({ curve_speed: null, id: speedId, mode: 0, speed: 1.0, type: "speed" });
    return {
      ...baseSegment(nextId(), plateId, timerange(startUs, endUs - startUs)),
      source_timerange: timerange(startUs, endUs - startUs),
      speed: 1.0,
      volume: 1.0,
      extra_material_refs: [speedId],
      is_tone_modify: false,
      clip: defaultClip(),
      uniform_scale: { on: true, value: 1.0 },
      hdr_settings: { intensity: 1.0, mode: 1, nits: 1000 },
    };
  });
  tracks.push(makeTrack("底片", "video", plateSegments));

  // ── BGM：一段铺满全片 ──
  if (options.bgm) {
    const bgmId = nextId();
    materials.audios.push(audioMaterial(bgmId, options.bgm.path));
    const speedId = nextId();
    materials.speeds.push({ curve_speed: null, id: speedId, mode: 0, speed: 1.0, type: "speed" });
    const durationUs = Math.min(options.bgm.durationUs, totalUs(options.shots, options.fps));
    tracks.push(makeTrack("BGM", "audio", [{
      ...baseSegment(nextId(), bgmId, timerange(0, durationUs)),
      source_timerange: timerange(0, durationUs),
      speed: 1.0,
      volume: options.bgm.volume,
      extra_material_refs: [speedId],
      is_tone_modify: false,
      clip: null,
      hdr_settings: null,
    }]));
  }

  // ── SFX：调用方已经按「同轨不重叠」分好道，这里一轨一道 ──
  (options.sfxLanes ?? []).forEach((lane, laneIndex) => {
    const segments = lane.map(item => {
      const materialId = nextId();
      materials.audios.push(audioMaterial(materialId, item.path));
      const speedId = nextId();
      materials.speeds.push({ curve_speed: null, id: speedId, mode: 0, speed: 1.0, type: "speed" });
      return {
        ...baseSegment(nextId(), materialId, timerange(item.startUs, item.durationUs)),
        source_timerange: timerange(0, item.durationUs),
        speed: 1.0,
        volume: item.volume,
        extra_material_refs: [speedId],
        is_tone_modify: false,
        clip: null,
        hdr_settings: null,
      };
    });
    tracks.push(makeTrack(`SFX${laneIndex + 1}`, "audio", segments));
  });

  // ── 字幕：一条轨一种样式。一个文本段只能一种字号，中英双语必须拆两轨 ──
  (options.subtitles ?? []).forEach((subtitle, index) => {
    const materialId = nextId();
    const startUs = subtitle.beginMs * 1000;
    const endUs = subtitle.endMs * 1000;
    const speedId = nextId();
    materials.speeds.push({ curve_speed: null, id: speedId, mode: 0, speed: 1.0, type: "speed" });
    const content = {
      styles: [{
        fill: { alpha: 1.0, content: { render_type: "solid", solid: { alpha: 1.0, color: subtitle.color } } },
        range: [0, subtitle.text.length],
        size: subtitle.size,
        bold: false,
        italic: false,
        underline: false,
        strokes: [],
      }],
      text: subtitle.text,
    };
    materials.texts.push({
      id: materialId,
      // 库把 content 序列化成**字符串**再放进 texts（不是嵌套对象），照抄
      content: JSON.stringify(content),
      typesetting: 0,
      alignment: 1,
      letter_spacing: 0.0,
      line_spacing: 0.02,
      line_feed: 1,
      line_max_width: 0.82,
      force_apply_line_max_width: false,
      check_flag: 7,
      type: "subtitle",
      global_alpha: 1.0,
    });
    tracks.push(makeTrack(`字幕${index + 1}`, "text", [{
      ...baseSegment(nextId(), materialId, timerange(startUs, endUs - startUs)),
      clip: { alpha: 1.0, flip: { horizontal: false, vertical: false }, rotation: 0.0, scale: { x: 1.0, y: 1.0 }, transform: { x: 0.0, y: subtitle.y } },
      uniform_scale: { on: true, value: 1.0 },
      hdr_settings: null,
      speed: 1.0,
      volume: 1.0,
      source_timerange: null,
      extra_material_refs: [speedId],
      is_tone_modify: false,
    }]));
  });

  // render_index / track_render_index 由轨道下标回填 —— 库就是这么做的
  tracks.forEach((track, trackIndex) => {
    for (const segment of (track as { segments: Record<string, unknown>[] }).segments) {
      segment.render_index = trackIndex;
      segment.track_render_index = 0;
    }
  });

  const durationUs = totalUs(options.shots, options.fps);
  const content = {
    ...contentTemplate(),
    canvas_config: { width: options.width, height: options.height, ratio: "original" },
    fps: options.fps,
    duration: durationUs,
    materials,
    tracks,
  };
  const draftId = nextId().toUpperCase();
  const meta = {
    ...metaTemplate(),
    draft_id: draftId,
    draft_name: options.name,
    draft_fold_path: "",
    draft_root_path: "",
    tm_duration: durationUs,
    // 库把素材登记写进 draft_materials 的 type 0（视频/图片），漏了剪映会弹「媒体丢失」
    draft_materials: [{ type: 0, value: materials.videos.concat(materials.audios).map(material => ({
      create_time: 0,
      duration: (material as { duration: number }).duration,
      file_Path: (material as { path: string }).path,
      height: 0,
      id: (material as { id: string }).id,
      material_name: (material as { material_name?: string; name?: string }).material_name ?? (material as { name?: string }).name ?? "",
      type: 0,
      width: 0,
    })) },
    { type: 1, value: [] }, { type: 2, value: [] }, { type: 3, value: [] },
    { type: 6, value: [] }, { type: 7, value: [] }, { type: 8, value: [] }],
  };
  return { content: JSON.stringify(content, null, 4), meta: JSON.stringify(meta, null, 4) };
}

/** 片段通用字段（照抄 BaseSegment.export_json）。 */
function baseSegment(id: string, materialId: string, range: { start: number; duration: number }) {
  return {
    enable_adjust: true,
    enable_color_correct_adjust: false,
    enable_color_curves: true,
    enable_color_match_adjust: false,
    enable_color_wheels: true,
    enable_lut: true,
    enable_smart_color_adjust: false,
    last_nonzero_volume: 1.0,
    reverse: false,
    track_attribute: 0,
    track_render_index: 0,
    visible: true,
    id,
    material_id: materialId,
    target_timerange: range,
    common_keyframes: [],
    keyframe_refs: [],
  };
}

function makeTrack(name: string, type: "video" | "audio" | "text", segments: unknown[]) {
  return { attribute: 0, flag: 0, id: `track-${type}-${name}`, is_default_name: name.length === 0, name, segments, type };
}

function audioMaterial(id: string, path: string) {
  return {
    app_id: 0,
    category_id: "",
    category_name: "local",
    check_flag: 3,
    copyright_limit_type: "none",
    duration: 0,
    effect_id: "",
    formula_id: "",
    id,
    local_material_id: id,
    music_id: id,
    name: path.split(/[\\/]/).pop() ?? "audio",
    path,
    source_platform: 0,
    type: "extract_music",
    wave_points: [],
  };
}

function totalUs(shots: { startFrame: number; endFrame: number }[], fps: number) {
  const last = shots[shots.length - 1];
  return last ? Math.round((last.endFrame * 1_000_000) / fps) : 0;
}

/** draft_content.json 的骨架（照抄库的 draft_content_template.json）。 */
function contentTemplate() {
  return {
    canvas_config: { height: 1080, ratio: "original", width: 1920 },
    color_space: 0,
    config: {
      adjust_max_index: 1, attachment_info: [], combination_max_index: 1, export_range: null,
      extract_audio_last_index: 1, lyrics_recognition_id: "", lyrics_sync: true, lyrics_taskinfo: [],
      maintrack_adsorb: true, material_save_mode: 0, multi_language_current: "none",
      multi_language_list: [], multi_language_main: "none", multi_language_mode: "none",
      original_sound_last_index: 1, record_audio_last_index: 1, sticker_max_index: 1,
      subtitle_keywords_config: null, subtitle_recognition_id: "", subtitle_sync: true,
      subtitle_taskinfo: [], system_font_list: [], video_mute: false, zoom_info_params: null,
    },
    cover: null,
    create_time: 0,
    duration: 0,
    extra_info: null,
    fps: 30.0,
    free_render_index_mode_on: false,
    group_container: null,
    id: "91E08AC5-22FB-47e2-9AA0-7DC300FAEA2B",
    keyframe_graph_list: [],
    keyframes: { adjusts: [], audios: [], effects: [], filters: [], handwrites: [], stickers: [], texts: [], videos: [] },
    last_modified_platform: { app_id: 3704, app_source: "lv", app_version: "5.9.0", os: "windows" },
    platform: { app_id: 3704, app_source: "lv", app_version: "5.9.0", os: "windows" },
    materials: {} as Record<string, unknown[]>,
    mutable_config: null,
    name: "",
    new_version: "110.0.0",
    relationships: [],
    render_index_track_mode_on: false,
    retouch_cover: null,
    source: "default",
    static_cover_image_path: "",
    time_marks: null,
    tracks: [] as unknown[],
    update_time: 0,
    version: 360000,
  };
}

/** draft_meta_info.json 的骨架（照抄库的 draft_meta_info.json）。 */
function metaTemplate() {
  return {
    cloud_package_completed_time: "",
    draft_cloud_capcut_purchase_info: "",
    draft_cloud_last_action_download: false,
    draft_cloud_materials: [],
    draft_cloud_purchase_info: "",
    draft_cloud_template_id: "",
    draft_cloud_tutorial_info: "",
    draft_cloud_videocut_purchase_info: "",
    draft_cover: "",
    draft_deeplink_url: "",
    draft_enterprise_info: { draft_enterprise_extra: "", draft_enterprise_id: "", draft_enterprise_name: "", enterprise_material: [] },
    draft_fold_path: "",
    draft_id: "",
    draft_is_ai_packaging_used: false,
    draft_is_ai_shorts: false,
    draft_is_ai_translate: false,
    draft_is_article_video_draft: false,
    draft_is_from_deeplink: "false",
    draft_is_invisible: false,
    draft_materials: [] as unknown[],
    draft_materials_copied_info: [],
    draft_name: "",
    draft_new_version: "",
    draft_removable_storage_device: "",
    draft_root_path: "",
    draft_segment_extra_info: [],
    draft_type: "",
    tm_draft_cloud_completed: "",
    tm_draft_cloud_modified: 0,
    tm_draft_removed: 0,
    tm_duration: 0,
  };
}
