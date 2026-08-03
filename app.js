const STORAGE_KEY = "xzy-tennis-journal-v1";
const SETTINGS_KEY = "xzy-tennis-settings-v1";
const DELETED_KEY = "xzy-tennis-deleted-v1";
const SETTINGS_UPDATED_KEY = "xzy-tennis-settings-updated-v1";

const TYPE_CONFIG = {
  tennis: { label: "网球训练", short: "网球", icon: "circle-dot", colorClass: "tennis" },
  fitness: { label: "体能训练", short: "体能", icon: "dumbbell", colorClass: "fitness" },
  match: { label: "比赛复盘", short: "比赛", icon: "trophy", colorClass: "match" },
  recovery: { label: "拉伸放松", short: "恢复", icon: "activity", colorClass: "recovery" },
  daily: { label: "饮食休息", short: "日常", icon: "moon", colorClass: "daily" },
};

const DEFAULT_SETTINGS = {
  athleteName: "许子越",
  tennisGoal: 4,
  fitnessGoal: 2,
  recoveryGoal: 4,
};

const state = {
  entries: loadJSON(STORAGE_KEY, []),
  settings: { ...DEFAULT_SETTINGS, ...loadJSON(SETTINGS_KEY, {}) },
  activeView: "today",
  activeType: "tennis",
  historyFilter: "all",
  weekOffset: 0,
  parsedDrafts: [],
  deletedIds: loadJSON(DELETED_KEY, []),
  cloud: { client: null, user: null, status: "offline", message: "未登录", syncing: false, syncRequested: false, timer: null },
};

function loadJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function persist({ sync = true } = {}) {
  state.entries.sort((a, b) => `${b.date}${b.createdAt || ""}`.localeCompare(`${a.date}${a.createdAt || ""}`));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.entries));
  localStorage.setItem(DELETED_KEY, JSON.stringify(state.deletedIds));
  if (sync) scheduleCloudSync();
}

function persistSettings({ touch = true, sync = true } = {}) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  if (touch) localStorage.setItem(SETTINGS_UPDATED_KEY, new Date().toISOString());
  if (sync) scheduleCloudSync();
}

function localISO(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function parseISO(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date) {
  const result = new Date(date);
  const day = result.getDay() || 7;
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - day + 1);
  return result;
}

function formatDate(value, options = {}) {
  return parseISO(value).toLocaleDateString("zh-CN", options);
}

function escapeHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function numberValue(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons({ attrs: { "aria-hidden": "true" } });
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function entryTitle(entry) {
  if (entry.title) return entry.title;
  const details = entry.details || {};
  if (entry.type === "tennis") return details.focus?.length ? details.focus.join(" · ") : "网球训练";
  if (entry.type === "fitness") return details.focus?.length ? details.focus.join(" · ") : "体能训练";
  if (entry.type === "match") return details.opponent ? `对阵 ${details.opponent}` : "比赛复盘";
  if (entry.type === "recovery") return details.methods?.length ? details.methods.join(" · ") : "拉伸放松";
  if (entry.type === "daily") return "饮食与休息";
  return TYPE_CONFIG[entry.type]?.label || "记录";
}

function entrySummary(entry) {
  const d = entry.details || {};
  const parts = [];
  if (entry.type === "match" && d.result) parts.push(d.result === "win" ? "胜" : d.result === "loss" ? "负" : "未完赛");
  if (entry.type === "match" && d.score) parts.push(d.score);
  if (entry.duration) parts.push(`${entry.duration} 分钟`);
  if (entry.rpe) parts.push(`RPE ${entry.rpe}`);
  if (entry.type === "daily" && d.sleepHours) parts.push(`睡眠 ${d.sleepHours} 小时`);
  if (entry.type === "daily" && d.hydration) parts.push(`饮水 ${d.hydration} ml`);
  if (d.feeling) parts.push(d.feeling);
  if (entry.notes) parts.push(entry.notes);
  return parts.join(" · ") || "已完成记录";
}

function createEmptyState(title, message, icon = "clipboard") {
  return `<div class="empty-state"><i data-lucide="${icon}"></i><strong>${escapeHTML(title)}</strong><p>${escapeHTML(message)}</p></div>`;
}

function renderHeader() {
  const now = new Date();
  document.querySelector("#todayLabel").textContent = now.toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
  document.querySelector(".brand strong").textContent = `${state.settings.athleteName}训练记录`;
}

function renderToday() {
  const today = localISO();
  const entries = state.entries.filter((entry) => entry.date === today);
  const trainingMinutes = entries
    .filter((entry) => ["tennis", "fitness", "match"].includes(entry.type))
    .reduce((sum, entry) => sum + (Number(entry.duration) || 0), 0);
  const recoveryMinutes = entries
    .filter((entry) => entry.type === "recovery")
    .reduce((sum, entry) => sum + (Number(entry.duration) || 0), 0);
  const daily = entries.find((entry) => entry.type === "daily");
  const matches = entries.filter((entry) => entry.type === "match");

  document.querySelector("#todayStatus").innerHTML = [
    [trainingMinutes || "—", "训练分钟"],
    [recoveryMinutes || "—", "恢复分钟"],
    [daily?.details?.sleepHours || "—", "睡眠小时"],
    [matches.length || "—", "比赛场次"],
  ].map(([value, label]) => `<div class="status-item"><strong>${value}</strong><span>${label}</span></div>`).join("");

  document.querySelector("#todayCount").textContent = `${entries.length} 条`;
  document.querySelector("#todayEntries").innerHTML = entries.length
    ? entries.map(renderEntryRow).join("")
    : createEmptyState("今天还没有记录", "训练结束后写一句话，或从“记录”页填写。", "calendar-plus");
}

function renderEntryRow(entry) {
  const config = TYPE_CONFIG[entry.type];
  return `
    <button class="timeline-item entry-button" type="button" data-edit-id="${escapeHTML(entry.id)}">
      <span class="type-dot ${config.colorClass}"><i data-lucide="${config.icon}"></i></span>
      <span class="entry-main"><strong>${escapeHTML(entryTitle(entry))}</strong><p>${escapeHTML(entrySummary(entry))}</p></span>
      <span class="entry-meta">${escapeHTML(config.short)}</span>
    </button>`;
}

function renderRecordTypeGrid() {
  document.querySelector("#recordTypeGrid").innerHTML = Object.entries(TYPE_CONFIG).map(([key, config]) => `
    <button type="button" class="record-type-button ${state.activeType === key ? "active" : ""}" data-record-type="${key}">
      <i data-lucide="${config.icon}"></i>${config.short}
    </button>`).join("");
}

function optionTags(options, selected = "") {
  return options.map(([value, label]) => `<option value="${escapeHTML(value)}" ${String(selected) === String(value) ? "selected" : ""}>${escapeHTML(label)}</option>`).join("");
}

function checkPills(name, options, selected = []) {
  return `<div class="checkbox-grid">${options.map((value) => `
    <label class="check-pill"><input type="checkbox" name="${name}" value="${escapeHTML(value)}" ${selected.includes(value) ? "checked" : ""}><span>${escapeHTML(value)}</span></label>`).join("")}</div>`;
}

function commonFields(entry = {}) {
  return `
    <label class="field"><span>日期</span><input name="date" type="date" required value="${escapeHTML(entry.date || localISO())}"></label>
    <label class="field"><span>时长（分钟）</span><input name="duration" type="number" min="0" max="600" inputmode="numeric" value="${entry.duration ?? ""}" placeholder="例如 90"></label>
    <label class="field"><span>训练强度 RPE（1-10）</span><input name="rpe" type="number" min="1" max="10" inputmode="numeric" value="${entry.rpe ?? ""}" placeholder="例如 7"></label>
    <label class="field"><span>自定义标题</span><input name="title" type="text" maxlength="40" value="${escapeHTML(entry.title || "")}" placeholder="可不填"></label>`;
}

function formFieldsFor(type, entry = {}) {
  const d = entry.details || {};
  const notes = `<label class="field full"><span>笔记</span><textarea name="notes" placeholder="今天做得好的、需要改进的、身体感受……">${escapeHTML(entry.notes || "")}</textarea></label>`;
  if (type === "tennis") return `
    ${commonFields(entry)}
    <div class="field full"><span>训练内容</span>${checkPills("focus", ["发球", "接发", "正手", "反手", "截击", "步法", "多球", "对抗"], d.focus || [])}</div>
    <label class="field"><span>教练</span><input name="coach" type="text" value="${escapeHTML(d.coach || "")}" placeholder="教练姓名"></label>
    <label class="field"><span>完成感受</span><select name="feeling">${optionTags([["", "请选择"], ["状态很好", "状态很好"], ["基本完成", "基本完成"], ["比较吃力", "比较吃力"]], d.feeling)}</select></label>
    ${notes}`;
  if (type === "fitness") return `
    ${commonFields(entry)}
    <div class="field full"><span>训练内容</span>${checkPills("focus", ["速度", "敏捷", "力量", "爆发力", "耐力", "核心", "协调", "平衡"], d.focus || [])}</div>
    <label class="field full"><span>训练明细</span><textarea name="content" placeholder="动作、组数、次数、重量或距离">${escapeHTML(d.content || "")}</textarea></label>
    ${notes}`;
  if (type === "match") return `
    ${commonFields(entry)}
    <label class="field"><span>赛事</span><input name="competition" type="text" value="${escapeHTML(d.competition || "")}" placeholder="赛事名称 / 轮次"></label>
    <label class="field"><span>对手</span><input name="opponent" type="text" value="${escapeHTML(d.opponent || "")}" placeholder="对手姓名"></label>
    <div class="field full"><span>结果</span><div class="segmented">
      ${[["win", "胜"], ["loss", "负"], ["unfinished", "未完赛"]].map(([value, label]) => `<label><input type="radio" name="result" value="${value}" ${d.result === value ? "checked" : ""}><span>${label}</span></label>`).join("")}
    </div></div>
    <label class="field"><span>比分</span><input name="score" type="text" value="${escapeHTML(d.score || "")}" placeholder="例如 6-4 3-6 10-7"></label>
    <label class="field"><span>场地</span><select name="surface">${optionTags([["", "请选择"], ["硬地", "硬地"], ["红土", "红土"], ["草地", "草地"], ["室内", "室内"]], d.surface)}</select></label>
    <label class="field full"><span>关键分与复盘</span><textarea name="review" placeholder="比赛计划、关键分处理、有效战术、下次调整">${escapeHTML(d.review || "")}</textarea></label>
    ${notes}`;
  if (type === "recovery") return `
    ${commonFields(entry)}
    <div class="field full"><span>恢复方式</span>${checkPills("methods", ["动态拉伸", "静态拉伸", "泡沫轴", "按摩", "热敷", "冰敷", "散步", "呼吸放松"], d.methods || [])}</div>
    <div class="field full"><span>身体部位</span>${checkPills("bodyParts", ["肩颈", "手臂", "背部", "腰髋", "大腿", "膝盖", "小腿", "脚踝"], d.bodyParts || [])}</div>
    <label class="field"><span>恢复前酸痛（0-10）</span><input name="sorenessBefore" type="number" min="0" max="10" value="${d.sorenessBefore ?? ""}"></label>
    <label class="field"><span>恢复后酸痛（0-10）</span><input name="sorenessAfter" type="number" min="0" max="10" value="${d.sorenessAfter ?? ""}"></label>
    ${notes}`;
  return `
    <label class="field"><span>日期</span><input name="date" type="date" required value="${escapeHTML(entry.date || localISO())}"></label>
    <label class="field"><span>睡眠时长（小时）</span><input name="sleepHours" type="number" min="0" max="16" step="0.5" value="${d.sleepHours ?? ""}" placeholder="例如 9"></label>
    <label class="field"><span>入睡时间</span><input name="bedtime" type="time" value="${escapeHTML(d.bedtime || "")}"></label>
    <label class="field"><span>起床时间</span><input name="wakeTime" type="time" value="${escapeHTML(d.wakeTime || "")}"></label>
    <label class="field"><span>睡眠质量（1-5）</span><input name="sleepQuality" type="number" min="1" max="5" value="${d.sleepQuality ?? ""}"></label>
    <label class="field"><span>饮水量（ml）</span><input name="hydration" type="number" min="0" max="8000" step="100" value="${d.hydration ?? ""}" placeholder="例如 1800"></label>
    <label class="field"><span>精力（1-5）</span><input name="energy" type="number" min="1" max="5" value="${d.energy ?? ""}"></label>
    <label class="field"><span>疲劳（1-5）</span><input name="fatigue" type="number" min="1" max="5" value="${d.fatigue ?? ""}"></label>
    <label class="field"><span>体重（kg）</span><input name="weight" type="number" min="10" max="200" step="0.1" value="${d.weight ?? ""}"></label>
    <label class="field"><span>饮食完成度</span><select name="mealQuality">${optionTags([["", "请选择"], ["规律均衡", "规律均衡"], ["基本正常", "基本正常"], ["需要改善", "需要改善"]], d.mealQuality)}</select></label>
    <label class="field full"><span>饮食记录</span><textarea name="meals" placeholder="早餐、午餐、晚餐、加餐">${escapeHTML(d.meals || "")}</textarea></label>
    ${notes}`;
}

function recordFormHTML(type, entry = null, dialog = false) {
  const config = TYPE_CONFIG[type];
  return `
    ${dialog ? `<div class="dialog-heading"><div><span class="eyebrow">编辑记录</span><h2>${config.label}</h2></div><button class="icon-button subtle" type="button" data-close-dialog title="关闭" aria-label="关闭"><i data-lucide="x"></i></button></div>` : `<h2 class="form-title">${config.label}</h2>`}
    <form data-entry-form data-type="${type}" data-id="${entry?.id || ""}">
      <div class="form-grid">${formFieldsFor(type, entry || {})}</div>
      <div class="form-actions">
        ${entry ? `<button class="danger-button" type="button" data-delete-id="${entry.id}"><i data-lucide="trash-2"></i>删除</button>` : ""}
        <button class="primary-button" type="submit"><i data-lucide="save"></i>${entry ? "保存修改" : "保存记录"}</button>
      </div>
    </form>`;
}

function renderRecordForm() {
  renderRecordTypeGrid();
  document.querySelector("#recordFormPanel").innerHTML = recordFormHTML(state.activeType);
}

function formToEntry(form) {
  const data = new FormData(form);
  const type = form.dataset.type;
  const existing = state.entries.find((entry) => entry.id === form.dataset.id);
  const entry = {
    id: existing?.id || uid(),
    type,
    date: data.get("date") || localISO(),
    duration: type === "daily" ? null : numberValue(data.get("duration")),
    rpe: type === "daily" ? null : numberValue(data.get("rpe")),
    title: type === "daily" ? "" : String(data.get("title") || "").trim(),
    notes: String(data.get("notes") || "").trim(),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    details: {},
  };
  const d = entry.details;
  if (type === "tennis") {
    d.focus = data.getAll("focus"); d.coach = data.get("coach"); d.feeling = data.get("feeling");
  } else if (type === "fitness") {
    d.focus = data.getAll("focus"); d.content = data.get("content");
  } else if (type === "match") {
    d.competition = data.get("competition"); d.opponent = data.get("opponent"); d.result = data.get("result");
    d.score = data.get("score"); d.surface = data.get("surface"); d.review = data.get("review");
  } else if (type === "recovery") {
    d.methods = data.getAll("methods"); d.bodyParts = data.getAll("bodyParts");
    d.sorenessBefore = numberValue(data.get("sorenessBefore")); d.sorenessAfter = numberValue(data.get("sorenessAfter"));
  } else {
    ["sleepHours", "sleepQuality", "hydration", "energy", "fatigue", "weight"].forEach((key) => { d[key] = numberValue(data.get(key)); });
    ["bedtime", "wakeTime", "mealQuality", "meals"].forEach((key) => { d[key] = data.get(key); });
  }
  return entry;
}

function saveEntry(entry) {
  const index = state.entries.findIndex((item) => item.id === entry.id);
  if (index >= 0) state.entries[index] = entry;
  else state.entries.push(entry);
  persist();
  renderAll();
}

function markEntryDeleted(id) {
  if (!state.deletedIds.includes(id)) state.deletedIds.push(id);
}

function renderHistoryFilters() {
  const filters = [["all", "全部"], ...Object.entries(TYPE_CONFIG).map(([key, value]) => [key, value.short])];
  document.querySelector("#historyFilters").innerHTML = filters.map(([key, label]) => `
    <button class="filter-button ${state.historyFilter === key ? "active" : ""}" type="button" data-history-filter="${key}">${label}</button>`).join("");
}

function renderHistory() {
  renderHistoryFilters();
  const entries = state.historyFilter === "all" ? state.entries : state.entries.filter((entry) => entry.type === state.historyFilter);
  if (!entries.length) {
    document.querySelector("#historyList").innerHTML = createEmptyState("没有符合条件的记录", "新的训练记录会按日期出现在这里。", "search");
    return;
  }
  const groups = Object.groupBy ? Object.groupBy(entries, (entry) => entry.date) : entries.reduce((acc, entry) => {
    (acc[entry.date] ||= []).push(entry); return acc;
  }, {});
  document.querySelector("#historyList").innerHTML = Object.entries(groups).map(([date, items]) => `
    <div class="history-date">${formatDate(date, { year: "numeric", month: "long", day: "numeric", weekday: "short" })}</div>
    ${items.map(renderEntryRow).join("")}`).join("");
}

function detectDate(text) {
  const now = new Date();
  if (/前天/.test(text)) return localISO(addDays(now, -2));
  if (/昨天|昨晚/.test(text)) return localISO(addDays(now, -1));
  const full = text.match(/(20\d{2})[年\-/\.]\s*(\d{1,2})[月\-/\.]\s*(\d{1,2})日?/);
  if (full) return `${full[1]}-${String(full[2]).padStart(2, "0")}-${String(full[3]).padStart(2, "0")}`;
  const short = text.match(/(\d{1,2})月(\d{1,2})日?/);
  if (short) return `${now.getFullYear()}-${String(short[1]).padStart(2, "0")}-${String(short[2]).padStart(2, "0")}`;
  return localISO(now);
}

function extractDuration(text) {
  const hourMinute = text.match(/(\d+(?:\.\d+)?)\s*(?:个)?小时(?:\s*(\d+)\s*分钟?)?/);
  if (hourMinute) return Math.round(Number(hourMinute[1]) * 60 + Number(hourMinute[2] || 0));
  const minute = text.match(/(\d+)\s*分钟/);
  return minute ? Number(minute[1]) : null;
}

function extractRPE(text) {
  const result = text.match(/(?:RPE|强度|体感强度)\s*[:：]?\s*(10|[1-9])/i);
  return result ? Number(result[1]) : null;
}

function relevantText(sentences, keywords, fallback) {
  const matched = sentences.filter((sentence) => keywords.some((keyword) => sentence.includes(keyword)));
  return matched.length ? matched.join("。") : fallback;
}

function parseNaturalText(text) {
  const clean = text.trim();
  if (!clean) return [];
  const sentences = clean.split(/[。！？!\n；;]/).map((item) => item.trim()).filter(Boolean);
  const categories = [
    ["match", ["比赛", "对阵", "比分", "赛事", "赢了", "输了", "获胜", "失利"]],
    ["tennis", ["网球", "发球", "接发", "正手", "反手", "截击", "多球", "底线", "教练"]],
    ["fitness", ["体能", "力量", "敏捷", "速度", "核心", "耐力", "爆发", "跑步", "跳绳"]],
    ["recovery", ["拉伸", "放松", "泡沫轴", "按摩", "热敷", "冰敷", "恢复"]],
    ["daily", ["睡", "起床", "饮食", "早餐", "午餐", "晚餐", "加餐", "饮水", "喝水", "疲劳", "精力", "体重"]],
  ];
  const present = categories.filter(([, keywords]) => keywords.some((keyword) => clean.includes(keyword)));
  const hasMatch = present.some(([type]) => type === "match");
  const tennisIndex = present.findIndex(([type]) => type === "tennis");
  if (hasMatch && tennisIndex >= 0 && !clean.includes("训练")) present.splice(tennisIndex, 1);
  if (!present.length) present.push(["tennis", []]);

  return present.map(([type, keywords]) => {
    const snippet = relevantText(sentences, keywords, clean);
    const entry = {
      id: uid(), type, date: detectDate(snippet), title: "", notes: snippet,
      duration: type === "daily" ? null : extractDuration(snippet),
      rpe: type === "daily" ? null : extractRPE(snippet),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), details: {},
    };
    const d = entry.details;
    if (type === "tennis") {
      d.focus = ["发球", "接发", "正手", "反手", "截击", "步法", "多球", "对抗"].filter((item) => snippet.includes(item));
      d.feeling = /很好|不错|顺利/.test(snippet) ? "状态很好" : /累|吃力|不好/.test(snippet) ? "比较吃力" : "";
    } else if (type === "fitness") {
      d.focus = ["速度", "敏捷", "力量", "爆发力", "耐力", "核心", "协调", "平衡"].filter((item) => snippet.includes(item.replace("力", "")) || snippet.includes(item));
      d.content = snippet;
    } else if (type === "match") {
      d.result = /赢|胜/.test(snippet) ? "win" : /输|负|失利/.test(snippet) ? "loss" : "";
      const score = snippet.match(/\b\d{1,2}\s*[-:：]\s*\d{1,2}(?:\s+\d{1,2}\s*[-:：]\s*\d{1,2})*/g);
      d.score = score ? score.join(" ").replaceAll(/\s*[:：]\s*/g, "-") : "";
      const opponent = snippet.match(/(?:对阵|对手(?:是|叫)?)[：:\s]*([\u4e00-\u9fa5A-Za-z·]{2,20})/);
      d.opponent = opponent?.[1] || "";
      d.review = snippet;
    } else if (type === "recovery") {
      d.methods = ["泡沫轴", "按摩", "热敷", "冰敷", "散步", "呼吸放松"].filter((item) => snippet.includes(item));
      if (snippet.includes("动态拉伸")) d.methods.unshift("动态拉伸");
      else if (snippet.includes("拉伸")) d.methods.unshift("静态拉伸");
      d.bodyParts = ["肩颈", "手臂", "背部", "腰髋", "大腿", "膝盖", "小腿", "脚踝"].filter((item) => snippet.includes(item));
    } else {
      const sleep = snippet.match(/(?:睡(?:了|眠)?|睡眠)\s*(\d+(?:\.\d+)?)\s*(?:个)?小时/);
      const waterMl = snippet.match(/(?:饮水|喝水)?\s*(\d{3,4})\s*(?:毫升|ml)/i);
      const waterL = snippet.match(/(?:饮水|喝水)?\s*(\d(?:\.\d+)?)\s*(?:升|L)\b/i);
      const weight = snippet.match(/体重\s*(\d+(?:\.\d+)?)\s*(?:公斤|kg)?/i);
      d.sleepHours = sleep ? Number(sleep[1]) : null;
      d.hydration = waterMl ? Number(waterMl[1]) : waterL ? Number(waterL[1]) * 1000 : null;
      d.weight = weight ? Number(weight[1]) : null;
      d.mealQuality = /均衡|规律|蔬菜|蛋白/.test(snippet) ? "规律均衡" : /没吃|漏了|不规律/.test(snippet) ? "需要改善" : "";
      d.meals = relevantText(sentences, ["早餐", "午餐", "晚餐", "加餐", "饮食"], "");
    }
    return entry;
  });
}

function renderParsePreview() {
  const panel = document.querySelector("#parsePreview");
  if (!state.parsedDrafts.length) {
    panel.classList.add("hidden"); panel.innerHTML = ""; return;
  }
  panel.classList.remove("hidden");
  panel.innerHTML = `
    <div class="preview-heading"><strong>识别出 ${state.parsedDrafts.length} 条记录</strong><span class="input-hint">保存后可继续编辑</span></div>
    <div class="preview-list">${state.parsedDrafts.map((entry) => {
      const config = TYPE_CONFIG[entry.type];
      return `<div class="preview-item"><span class="type-dot ${config.colorClass}"><i data-lucide="${config.icon}"></i></span><div><strong>${config.label} · ${formatDate(entry.date, { month: "numeric", day: "numeric" })}</strong><p>${escapeHTML(entrySummary(entry))}</p></div></div>`;
    }).join("")}</div>
    <div class="preview-actions"><button class="secondary-button" type="button" data-cancel-parse>重新输入</button><button class="primary-button" type="button" data-save-parsed><i data-lucide="save"></i>全部保存</button></div>`;
  refreshIcons();
}

function entriesForWeek(offset = state.weekOffset) {
  const monday = addDays(startOfWeek(new Date()), offset * 7);
  const sunday = addDays(monday, 6);
  const start = localISO(monday);
  const end = localISO(sunday);
  return { monday, sunday, start, end, entries: state.entries.filter((entry) => entry.date >= start && entry.date <= end) };
}

function weeklyStats(entries) {
  const byType = Object.fromEntries(Object.keys(TYPE_CONFIG).map((type) => [type, entries.filter((entry) => entry.type === type)]));
  const training = entries.filter((entry) => ["tennis", "fitness", "match"].includes(entry.type));
  const minutes = training.reduce((sum, entry) => sum + (Number(entry.duration) || 0), 0);
  const load = training.reduce((sum, entry) => sum + (Number(entry.duration) || 0) * (Number(entry.rpe) || 0), 0);
  const sleepValues = byType.daily.map((entry) => Number(entry.details?.sleepHours)).filter(Boolean);
  const avgSleep = sleepValues.length ? sleepValues.reduce((sum, value) => sum + value, 0) / sleepValues.length : null;
  const wins = byType.match.filter((entry) => entry.details?.result === "win").length;
  const losses = byType.match.filter((entry) => entry.details?.result === "loss").length;
  return { byType, training, minutes, load, avgSleep, sleepCount: sleepValues.length, wins, losses };
}

function buildInsights(stats, previousStats) {
  const insights = [];
  const goals = state.settings;
  if (stats.byType.tennis.length < goals.tennisGoal) {
    insights.push({ tone: "warning", icon: "circle-alert", title: "网球训练未达到周目标", text: `已记录 ${stats.byType.tennis.length} 次，目标 ${goals.tennisGoal} 次。先确认是否漏记，再安排剩余训练。` });
  }
  if (stats.byType.fitness.length < goals.fitnessGoal) {
    insights.push({ tone: "warning", icon: "dumbbell", title: "体能训练偏少", text: `本周记录 ${stats.byType.fitness.length} 次。建议把体能拆成更容易完成的速度敏捷和核心力量单元。` });
  }
  if (stats.byType.recovery.length < goals.recoveryGoal) {
    insights.push({ tone: "alert", icon: "activity", title: "恢复记录不足", text: `本周仅 ${stats.byType.recovery.length} 次恢复记录。训练后优先补 10-15 分钟拉伸或泡沫轴。` });
  }
  if (stats.sleepCount < 5) {
    insights.push({ tone: "warning", icon: "moon", title: "休息数据不完整", text: `只有 ${stats.sleepCount} 天填写了睡眠，暂时无法可靠判断恢复趋势。下周尽量记录 5 天以上。` });
  } else if (stats.avgSleep < 8) {
    insights.push({ tone: "alert", icon: "moon-star", title: "平均睡眠偏少", text: `本周平均 ${stats.avgSleep.toFixed(1)} 小时。建议优先固定入睡时间，并结合白天精力和疲劳记录观察。` });
  }
  if (previousStats.load > 0 && stats.load > previousStats.load * 1.4) {
    insights.push({ tone: "alert", icon: "trending-up", title: "训练负荷增长较快", text: `训练负荷比上周增加 ${Math.round((stats.load / previousStats.load - 1) * 100)}%。下周不宜继续大幅加量，注意疲劳和局部酸痛。` });
  }
  const reviewedMatches = stats.byType.match.filter((entry) => entry.details?.review || entry.notes).length;
  if (stats.byType.match.length && reviewedMatches < stats.byType.match.length) {
    insights.push({ tone: "warning", icon: "file-question", title: "比赛复盘有缺失", text: `本周 ${stats.byType.match.length} 场比赛中有 ${stats.byType.match.length - reviewedMatches} 场未完成复盘。至少补上关键分和下次调整。` });
  }
  if (!insights.length) {
    insights.push({ tone: "good", icon: "badge-check", title: "本周记录完整度良好", text: "主要训练、恢复和休息数据均达到设定目标。下周保持节奏，并选择一个技术主题重点推进。" });
  }
  return insights;
}

function planningAdvice(stats) {
  const advice = [];
  const tennisFocus = stats.byType.tennis.flatMap((entry) => entry.details?.focus || []);
  const counts = tennisFocus.reduce((acc, item) => { acc[item] = (acc[item] || 0) + 1; return acc; }, {});
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (top) advice.push(`技术训练：延续“${top}”主题，同时安排一次对抗检验训练迁移。`);
  else advice.push("技术训练：下周为每次网球训练设定一个明确主题，并在笔记里记录完成质量。");
  advice.push(stats.byType.fitness.length < state.settings.fitnessGoal
    ? "体能训练：安排 2 次短单元，一次速度敏捷、一次核心与下肢稳定。"
    : "体能训练：保持当前频率，避免把高强度体能紧接在高负荷比赛之后。");
  advice.push(stats.byType.recovery.length < state.settings.recoveryGoal
    ? "恢复安排：每次训练后固定 10-15 分钟，并在睡前补一次重点部位放松。"
    : "恢复安排：继续记录酸痛前后变化，用数据判断哪些方法更有效。");
  return advice;
}

function renderWeeklyReport() {
  const week = entriesForWeek();
  const stats = weeklyStats(week.entries);
  const previousStats = weeklyStats(entriesForWeek(state.weekOffset - 1).entries);
  const insights = buildInsights(stats, previousStats);
  const advice = planningAdvice(stats);
  document.querySelector("#currentWeekButton").textContent = `${week.monday.getMonth() + 1}.${week.monday.getDate()} - ${week.sunday.getMonth() + 1}.${week.sunday.getDate()}`;
  document.querySelector("#nextWeek").disabled = state.weekOffset >= 0;
  const dayNames = ["一", "二", "三", "四", "五", "六", "日"];
  const progress = [
    ["网球", stats.byType.tennis.length, state.settings.tennisGoal],
    ["体能", stats.byType.fitness.length, state.settings.fitnessGoal],
    ["恢复", stats.byType.recovery.length, state.settings.recoveryGoal],
    ["日常", stats.byType.daily.length, 7],
  ];
  document.querySelector("#weeklyReport").innerHTML = `
    <div class="report-body">
      <div class="metric-grid">
        <div class="metric"><strong>${stats.minutes}</strong><span>训练分钟</span></div>
        <div class="metric"><strong>${stats.training.length}</strong><span>训练 / 比赛</span></div>
        <div class="metric"><strong>${stats.avgSleep ? stats.avgSleep.toFixed(1) : "—"}</strong><span>平均睡眠</span></div>
        <div class="metric"><strong>${stats.wins}-${stats.losses}</strong><span>比赛胜负</span></div>
      </div>
      <section class="report-section">
        <h2>每天记录</h2>
        <div class="day-strip">${dayNames.map((name, index) => {
          const date = localISO(addDays(week.monday, index));
          const items = week.entries.filter((entry) => entry.date === date);
          return `<div class="day-cell ${date === localISO() ? "today" : ""}"><span>周${name}</span><strong>${parseISO(date).getDate()}</strong><div class="day-dots">${items.slice(0, 4).map(() => "<i></i>").join("")}</div></div>`;
        }).join("")}</div>
      </section>
      <section class="report-section">
        <h2>目标完成</h2>
        <div class="progress-list">${progress.map(([label, value, goal]) => `
          <div class="progress-row"><span>${label}</span><div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, goal ? value / goal * 100 : 100)}%"></div></div><span class="progress-value">${value} / ${goal}</span></div>`).join("")}</div>
      </section>
      <section class="report-section">
        <h2>不足与缺失</h2>
        <div class="insight-list">${insights.map((item) => `<div class="insight ${item.tone}"><i data-lucide="${item.icon}"></i><div><strong>${item.title}</strong><p>${item.text}</p></div></div>`).join("")}</div>
      </section>
      <section class="report-section">
        <h2>下周建议</h2>
        <div class="insight-list">${advice.map((text, index) => `<div class="insight"><i data-lucide="${["target", "dumbbell", "heart-pulse"][index]}"></i><div><p>${text}</p></div></div>`).join("")}</div>
      </section>
    </div>`;
}

function renderSettings() {
  document.querySelector("#athleteNameInput").value = state.settings.athleteName;
  document.querySelector("#tennisGoalInput").value = state.settings.tennisGoal;
  document.querySelector("#fitnessGoalInput").value = state.settings.fitnessGoal;
  document.querySelector("#recoveryGoalInput").value = state.settings.recoveryGoal;
  renderCloudSettings();
}

function cloudStatusMeta() {
  if (state.cloud.status === "connected") return { icon: "cloud-check", className: "connected" };
  if (state.cloud.status === "syncing") return { icon: "cloud-upload", className: "syncing" };
  if (state.cloud.status === "error") return { icon: "cloud-alert", className: "error" };
  return { icon: "cloud-off", className: "" };
}

function signedInAccountName() {
  return state.cloud.user?.user_metadata?.account_name || state.cloud.user?.email?.split("@")[0] || "当前账号";
}

function renderCloudSettings() {
  const status = document.querySelector("#cloudStatus");
  if (!status) return;
  const signedIn = Boolean(state.cloud.user);
  const meta = cloudStatusMeta();
  status.className = `cloud-status ${meta.className}`.trim();
  status.innerHTML = `<i data-lucide="${meta.icon}"></i><span>${escapeHTML(state.cloud.message)}</span>`;
  document.querySelector("#cloudDescription").textContent = signedIn
    ? `已登录 ${signedInAccountName()}，记录会自动同步。`
    : "登录后，手机和电脑会自动使用同一份记录。";
  document.querySelector("#cloudCredentials").hidden = signedIn;
  document.querySelector("#loginAccountButton").hidden = signedIn;
  document.querySelector("#createAccountButton").hidden = signedIn;
  document.querySelector("#syncNowButton").hidden = !signedIn;
  document.querySelector("#logoutButton").hidden = !signedIn;
  document.querySelector("#syncNowButton").disabled = state.cloud.syncing;
  refreshIcons();
}

function setCloudStatus(status, message) {
  state.cloud.status = status;
  state.cloud.message = message;
  renderCloudSettings();
}

function entryToRow(entry) {
  return {
    id: entry.id,
    user_id: state.cloud.user.id,
    type: entry.type,
    date: entry.date,
    duration: entry.duration ?? null,
    rpe: entry.rpe ?? null,
    title: entry.title || "",
    notes: entry.notes || "",
    details: entry.details || {},
    created_at: entry.createdAt || new Date().toISOString(),
    updated_at: entry.updatedAt || entry.createdAt || new Date().toISOString(),
  };
}

function rowToEntry(row) {
  return {
    id: row.id,
    type: row.type,
    date: row.date,
    duration: row.duration,
    rpe: row.rpe,
    title: row.title || "",
    notes: row.notes || "",
    details: row.details || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function newerEntry(first, second) {
  const firstTime = Date.parse(first.updatedAt || first.createdAt || 0) || 0;
  const secondTime = Date.parse(second.updatedAt || second.createdAt || 0) || 0;
  return secondTime > firstTime ? second : first;
}

function scheduleCloudSync(delay = 500) {
  if (!state.cloud.user || !state.cloud.client) return;
  clearTimeout(state.cloud.timer);
  state.cloud.timer = setTimeout(() => syncCloudData(), delay);
}

async function syncCloudData() {
  if (!state.cloud.user || !state.cloud.client) return;
  if (state.cloud.syncing) {
    state.cloud.syncRequested = true;
    return;
  }
  state.cloud.syncing = true;
  setCloudStatus("syncing", "正在同步");
  try {
    if (state.deletedIds.length) {
      const { error: deleteError } = await state.cloud.client.from("entries").delete().in("id", state.deletedIds);
      if (deleteError) throw deleteError;
      state.deletedIds = [];
      persist({ sync: false });
    }

    const { data: remoteRows, error: readError } = await state.cloud.client.from("entries").select("*");
    if (readError) throw readError;
    const deleted = new Set(state.deletedIds);
    const merged = new Map(state.entries.filter((entry) => !deleted.has(entry.id)).map((entry) => [entry.id, entry]));
    (remoteRows || []).map(rowToEntry).forEach((remoteEntry) => {
      if (deleted.has(remoteEntry.id)) return;
      const localEntry = merged.get(remoteEntry.id);
      merged.set(remoteEntry.id, localEntry ? newerEntry(localEntry, remoteEntry) : remoteEntry);
    });
    state.entries = [...merged.values()];
    persist({ sync: false });
    if (state.entries.length) {
      const { error: writeError } = await state.cloud.client.from("entries").upsert(state.entries.map(entryToRow), { onConflict: "id" });
      if (writeError) throw writeError;
    }

    const { data: remoteSettings, error: settingsReadError } = await state.cloud.client
      .from("user_settings").select("settings, updated_at").maybeSingle();
    if (settingsReadError) throw settingsReadError;
    const localSettingsUpdatedAt = localStorage.getItem(SETTINGS_UPDATED_KEY) || "1970-01-01T00:00:00.000Z";
    if (remoteSettings && Date.parse(remoteSettings.updated_at) > Date.parse(localSettingsUpdatedAt)) {
      state.settings = { ...DEFAULT_SETTINGS, ...(remoteSettings.settings || {}) };
      localStorage.setItem(SETTINGS_UPDATED_KEY, remoteSettings.updated_at);
      persistSettings({ touch: false, sync: false });
    } else {
      const updatedAt = remoteSettings ? localSettingsUpdatedAt : new Date().toISOString();
      const { error: settingsWriteError } = await state.cloud.client.from("user_settings").upsert({
        user_id: state.cloud.user.id,
        settings: state.settings,
        updated_at: updatedAt,
      });
      if (settingsWriteError) throw settingsWriteError;
      localStorage.setItem(SETTINGS_UPDATED_KEY, updatedAt);
    }

    renderAll();
    renderSettings();
    setCloudStatus("connected", "已同步");
  } catch (error) {
    console.error("Cloud sync failed", error);
    setCloudStatus("error", navigator.onLine ? "同步失败" : "等待联网");
  } finally {
    state.cloud.syncing = false;
    if (state.cloud.syncRequested) {
      state.cloud.syncRequested = false;
      scheduleCloudSync(100);
    }
  }
}

function accountEmail(accountName) {
  const normalized = accountName.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, "");
  let hash = 2166136261;
  for (const character of normalized) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `account-${(hash >>> 0).toString(36)}@xzy-tennis.app`;
}

function cloudCredentials() {
  const accountName = document.querySelector("#cloudAccountInput").value.trim();
  const password = document.querySelector("#cloudPasswordInput").value;
  if (accountName.length < 2) {
    showToast("账号至少需要 2 个字");
    return null;
  }
  if (password.length < 6) {
    showToast("密码至少需要 6 位");
    return null;
  }
  return { accountName, password, email: accountEmail(accountName) };
}

async function loginWithPassword() {
  const credentials = cloudCredentials();
  if (!credentials) return;
  if (!state.cloud.client) {
    showToast("云端服务暂时没有加载，请稍后重试");
    return;
  }
  setCloudStatus("syncing", "正在登录");
  const { error } = await state.cloud.client.auth.signInWithPassword({
    email: credentials.email,
    password: credentials.password,
  });
  if (error) {
    console.error("Password login failed", error);
    setCloudStatus("error", "登录失败");
    showToast("账号或密码不正确");
    return;
  }
  document.querySelector("#cloudPasswordInput").value = "";
  showToast("登录成功");
}

async function createPasswordAccount() {
  const credentials = cloudCredentials();
  if (!credentials) return;
  if (!state.cloud.client) {
    showToast("云端服务暂时没有加载，请稍后重试");
    return;
  }
  setCloudStatus("syncing", "正在创建账号");
  const { data, error } = await state.cloud.client.auth.signUp({
    email: credentials.email,
    password: credentials.password,
    options: { data: { account_name: credentials.accountName } },
  });
  if (error || !data.session) {
    console.error("Account creation failed", error);
    setCloudStatus("error", "创建失败");
    showToast(error?.message?.toLowerCase().includes("already") ? "账号已存在，请直接登录" : "创建失败，请换一个账号重试");
    return;
  }
  document.querySelector("#cloudPasswordInput").value = "";
  showToast("账号已创建并登录");
}

async function initializeCloudSync() {
  const config = window.APP_CONFIG || {};
  if (!window.supabase || !config.supabaseUrl || !config.supabaseAnonKey) {
    setCloudStatus("error", "云端服务未加载");
    return;
  }
  state.cloud.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, detectSessionInUrl: false },
  });
  const { data, error } = await state.cloud.client.auth.getSession();
  if (error) console.error("Session restore failed", error);
  state.cloud.user = data?.session?.user || null;
  if (state.cloud.user) await syncCloudData();
  else setCloudStatus("offline", "未登录");

  state.cloud.client.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => {
      state.cloud.user = session?.user || null;
      if (state.cloud.user) syncCloudData();
      else setCloudStatus("offline", "未登录");
    }, 0);
  });
}

function renderAll() {
  renderHeader(); renderToday(); renderRecordForm(); renderHistory(); renderWeeklyReport(); renderParsePreview(); refreshIcons();
}

function navigate(target) {
  state.activeView = target;
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.dataset.view === target));
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.target === target));
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (target === "report") renderWeeklyReport();
  refreshIcons();
}

function openEditor(id) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;
  const dialog = document.querySelector("#editDialog");
  document.querySelector("#editDialogContent").innerHTML = recordFormHTML(entry.type, entry, true);
  dialog.showModal(); refreshIcons();
}

function exportData() {
  const data = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), settings: state.settings, entries: state.entries }, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = `许子越训练记录-${localISO()}.json`; link.click();
  URL.revokeObjectURL(url); showToast("数据已导出");
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.entries)) throw new Error("invalid");
      state.entries = data.entries;
      state.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
      persist(); persistSettings(); renderAll(); renderSettings(); showToast("备份已导入");
    } catch {
      showToast("无法读取这个备份文件");
    }
  };
  reader.readAsText(file);
}

function loadDemoData() {
  const monday = startOfWeek(new Date());
  const dates = Array.from({ length: 6 }, (_, index) => localISO(addDays(monday, index)));
  const demo = [
    { type: "tennis", date: dates[0], duration: 90, rpe: 6, details: { focus: ["正手", "步法"], feeling: "基本完成" }, notes: "正手击球点更稳定，移动中还容易靠得太近。" },
    { type: "recovery", date: dates[0], duration: 15, rpe: null, details: { methods: ["静态拉伸"], bodyParts: ["大腿", "小腿"], sorenessBefore: 4, sorenessAfter: 2 }, notes: "" },
    { type: "daily", date: dates[0], details: { sleepHours: 9, sleepQuality: 4, hydration: 1800, energy: 4, fatigue: 2, mealQuality: "规律均衡", meals: "三餐正常" }, notes: "" },
    { type: "fitness", date: dates[1], duration: 45, rpe: 7, details: { focus: ["敏捷", "核心"], content: "绳梯 4 组，折返跑 6 组，核心循环 3 组" }, notes: "后两组折返跑脚步变慢。" },
    { type: "daily", date: dates[1], details: { sleepHours: 8.5, sleepQuality: 4, hydration: 1600, energy: 4, fatigue: 3, mealQuality: "基本正常", meals: "" }, notes: "" },
    { type: "tennis", date: dates[2], duration: 120, rpe: 8, details: { focus: ["发球", "接发", "对抗"], feeling: "比较吃力" }, notes: "一区外角发球成功率不错，二发偏保守。" },
    { type: "recovery", date: dates[2], duration: 20, rpe: null, details: { methods: ["泡沫轴", "静态拉伸"], bodyParts: ["腰髋", "大腿"] }, notes: "" },
    { type: "daily", date: dates[2], details: { sleepHours: 8, sleepQuality: 3, hydration: 2000, energy: 3, fatigue: 4, mealQuality: "规律均衡", meals: "训练后补充牛奶和香蕉" }, notes: "" },
    { type: "match", date: dates[4], duration: 95, rpe: 8, details: { competition: "周末积分赛", opponent: "示例对手", result: "win", score: "6-4 6-3", surface: "硬地", review: "领先时一发更果断；4-3 的破发点通过连续压反手得分。" }, notes: "下一场需要减少接发抢攻失误。" },
    { type: "daily", date: dates[4], details: { sleepHours: 9.5, sleepQuality: 5, hydration: 2100, energy: 5, fatigue: 3, mealQuality: "规律均衡", meals: "赛前正常进餐，赛后补充碳水和蛋白质" }, notes: "" },
  ].map((entry, index) => ({ id: uid(), title: "", notes: "", duration: null, rpe: null, createdAt: new Date(Date.now() - index * 1000).toISOString(), updatedAt: new Date().toISOString(), ...entry }));
  state.entries = [...demo, ...state.entries]; persist(); renderAll(); showToast("示例记录已载入");
}

function setupSpeechRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const button = document.querySelector("#voiceButton");
  if (!Recognition) {
    button.addEventListener("click", () => showToast("当前浏览器不支持语音识别，可使用手机键盘的语音输入"));
    return;
  }
  const recognition = new Recognition();
  recognition.lang = "zh-CN"; recognition.continuous = false; recognition.interimResults = true;
  recognition.onstart = () => { document.querySelector("#voiceStatus").textContent = "正在听…"; button.style.color = "var(--red)"; };
  recognition.onresult = (event) => {
    const transcript = Array.from(event.results).map((result) => result[0].transcript).join("");
    document.querySelector("#naturalInput").value = transcript;
  };
  recognition.onend = () => { document.querySelector("#voiceStatus").textContent = "可一次记录多个项目"; button.style.color = ""; };
  button.addEventListener("click", () => recognition.start());
}

document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-target]");
  if (nav) navigate(nav.dataset.target);
  const typeButton = event.target.closest("[data-record-type]");
  if (typeButton) { state.activeType = typeButton.dataset.recordType; renderRecordForm(); refreshIcons(); }
  const editButton = event.target.closest("[data-edit-id]");
  if (editButton) openEditor(editButton.dataset.editId);
  const filterButton = event.target.closest("[data-history-filter]");
  if (filterButton) { state.historyFilter = filterButton.dataset.historyFilter; renderHistory(); refreshIcons(); }
  if (event.target.closest("[data-close-dialog]")) document.querySelector("#editDialog").close();
  if (event.target.closest("[data-cancel-parse]")) {
    state.parsedDrafts = []; renderParsePreview(); document.querySelector("#naturalInput").focus();
  }
  if (event.target.closest("[data-save-parsed]")) {
    state.entries.push(...state.parsedDrafts); state.parsedDrafts = []; persist();
    document.querySelector("#naturalInput").value = ""; renderAll(); showToast("记录已保存");
  }
  const deleteButton = event.target.closest("[data-delete-id]");
  if (deleteButton && confirm("确定删除这条记录吗？")) {
    markEntryDeleted(deleteButton.dataset.deleteId);
    state.entries = state.entries.filter((entry) => entry.id !== deleteButton.dataset.deleteId); persist();
    document.querySelector("#editDialog").close(); renderAll(); showToast("记录已删除");
  }
});

document.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-entry-form]");
  if (!form) return;
  event.preventDefault(); saveEntry(formToEntry(form));
  if (form.dataset.id) document.querySelector("#editDialog").close();
  else form.reset();
  showToast(form.dataset.id ? "修改已保存" : "记录已保存");
});

document.querySelector("#parseButton").addEventListener("click", () => {
  state.parsedDrafts = parseNaturalText(document.querySelector("#naturalInput").value);
  if (!state.parsedDrafts.length) showToast("请先输入记录内容");
  renderParsePreview();
});

document.querySelector("#settingsButton").addEventListener("click", () => { renderSettings(); document.querySelector("#settingsDialog").showModal(); refreshIcons(); });
document.querySelector("#saveSettingsButton").addEventListener("click", () => {
  state.settings = {
    athleteName: document.querySelector("#athleteNameInput").value.trim() || "许子越",
    tennisGoal: numberValue(document.querySelector("#tennisGoalInput").value) ?? 4,
    fitnessGoal: numberValue(document.querySelector("#fitnessGoalInput").value) ?? 2,
    recoveryGoal: numberValue(document.querySelector("#recoveryGoalInput").value) ?? 4,
  };
  persistSettings(); renderAll(); showToast("设置已保存");
});
document.querySelector("#exportButton").addEventListener("click", exportData);
document.querySelector("#importButton").addEventListener("click", () => document.querySelector("#importInput").click());
document.querySelector("#importInput").addEventListener("change", (event) => { if (event.target.files[0]) importData(event.target.files[0]); });
document.querySelector("#loadDemoButton").addEventListener("click", loadDemoData);
document.querySelector("#loginAccountButton").addEventListener("click", loginWithPassword);
document.querySelector("#createAccountButton").addEventListener("click", createPasswordAccount);
document.querySelector("#syncNowButton").addEventListener("click", syncCloudData);
document.querySelector("#logoutButton").addEventListener("click", async () => {
  if (state.cloud.client) await state.cloud.client.auth.signOut();
  state.cloud.user = null;
  setCloudStatus("offline", "未登录");
  showToast("已退出云端登录");
});
document.querySelector("#previousWeek").addEventListener("click", () => { state.weekOffset -= 1; renderWeeklyReport(); refreshIcons(); });
document.querySelector("#nextWeek").addEventListener("click", () => { if (state.weekOffset < 0) state.weekOffset += 1; renderWeeklyReport(); refreshIcons(); });
document.querySelector("#currentWeekButton").addEventListener("click", () => { state.weekOffset = 0; renderWeeklyReport(); refreshIcons(); });

window.addEventListener("online", () => scheduleCloudSync(100));
setupSpeechRecognition(); renderAll(); initializeCloudSync();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
