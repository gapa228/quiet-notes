const config = window.NOTES_CONFIG || {};
const cloudEnabled = Boolean(config.supabaseUrl && config.supabaseAnonKey);

const $ = (selector) => document.querySelector(selector);
const els = {
  grid: $("#notesGrid"), empty: $("#emptyState"), search: $("#searchInput"),
  todayCount: $("#todayCount"), upcomingCount: $("#upcomingCount"), allCount: $("#allCount"), pinnedCount: $("#pinnedCount"), sync: $("#syncStatus"),
  editor: $("#editor"), backdrop: $("#editorBackdrop"), title: $("#noteTitle"),
  type: $("#itemType"), date: $("#noteDate"), repeat: $("#repeatRule"), repeatInterval: $("#repeatInterval"), amount: $("#itemAmount"),
  content: $("#noteContent"), charCount: $("#charCount"), editedAt: $("#editedAt"), expensesView: $("#expensesView"),
  summaryToday: $("#summaryToday"), summarySpend: $("#summarySpend"), summaryTopCategory: $("#summaryTopCategory"), summaryUpcoming: $("#summaryUpcoming"),
  pin: $("#pinButton"), auth: $("#authDialog"), authForm: $("#authForm"),
  authMessage: $("#authMessage"), account: $("#accountButton"), signOut: $("#signOutButton"),
  complete: $("#completeButton"), toast: $("#toast"), install: $("#installButton")
};

let notes = loadNotes();
let expenses = loadExpenses();
let activeId = null;
let filter = "today";
let saveTimer;
let deferredInstall;
let session = loadSession();

function storageKey() { return `quiet-notes:${session?.user?.id || "local"}`; }
function expensesStorageKey() { return `quiet-expenses:${session?.user?.id || "local"}`; }
function loadNotes() {
  try {
    const localSession = JSON.parse(localStorage.getItem("quiet-notes:session") || "null");
    const key = `quiet-notes:${localSession?.user?.id || "local"}`;
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch { return []; }
}
function persistNotes() { localStorage.setItem(storageKey(), JSON.stringify(notes)); }
function loadExpenses() {
  try {
    const localSession = JSON.parse(localStorage.getItem("quiet-notes:session") || "null");
    return JSON.parse(localStorage.getItem(`quiet-expenses:${localSession?.user?.id || "local"}`) || "[]");
  } catch { return []; }
}
function persistExpenses() { localStorage.setItem(expensesStorageKey(), JSON.stringify(expenses)); }
function loadSession() { try { return JSON.parse(localStorage.getItem("quiet-notes:session") || "null"); } catch { return null; } }
function persistSession(value) {
  session = value;
  if (value) localStorage.setItem("quiet-notes:session", JSON.stringify(value));
  else localStorage.removeItem("quiet-notes:session");
  updateAccountUI();
}

function escapeHtml(value = "") {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}
function formatDate(value) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}
function localDateString(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}
function formatDueDate(value) {
  if (!value) return "без даты";
  const today = localDateString();
  if (value === today) return "сегодня";
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  if (value === localDateString(tomorrow)) return "завтра";
  return new Date(`${value}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}
function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }
function dayDifference(a, b) { return Math.round((b - a) / 86400000); }
function occurrenceForDate(note, target = localDateString()) {
  if (!note.due_date || note.due_date > target) return null;
  const rule = note.repeat_rule || "none";
  const interval = Math.max(1, Number(note.repeat_interval) || 1);
  if (rule === "none") return note.due_date;
  const base = new Date(`${note.due_date}T12:00:00`);
  const now = new Date(`${target}T12:00:00`);
  const diff = dayDifference(base, now);
  if (rule === "daily") return diff % interval === 0 ? target : null;
  if (rule === "weekly") return diff % (7 * interval) === 0 ? target : null;
  if (rule === "monthly") {
    const months = (now.getFullYear() - base.getFullYear()) * 12 + now.getMonth() - base.getMonth();
    const expected = Math.min(base.getDate(), daysInMonth(now.getFullYear(), now.getMonth()));
    return months % interval === 0 && now.getDate() === expected ? target : null;
  }
  if (rule === "yearly") {
    const years = now.getFullYear() - base.getFullYear();
    const expectedDay = Math.min(base.getDate(), daysInMonth(now.getFullYear(), base.getMonth()));
    return years % interval === 0 && now.getMonth() === base.getMonth() && now.getDate() === expectedDay ? target : null;
  }
  return null;
}
function occurrenceForToday(note, today = localDateString()) { return occurrenceForDate(note, today); }
function isCompletedForOccurrence(note, occurrence) {
  if (!note.completed_at) return false;
  if ((note.repeat_rule || "none") === "none") return true;
  return localDateString(new Date(note.completed_at)) >= occurrence;
}
function isDueToday(note, today = localDateString()) {
  const occurrence = occurrenceForToday(note, today);
  if (!occurrence) return false;
  if ((note.repeat_rule || "none") === "none") return note.due_date <= today && !note.completed_at;
  return !isCompletedForOccurrence(note, occurrence);
}
function repeatLabel(rule, interval = 1) {
  const number = Math.max(1, Number(interval) || 1);
  if (rule === "none" || !rule) return "";
  const single = ({ daily: "каждый день", weekly: "каждую неделю", monthly: "каждый месяц", yearly: "каждый год" })[rule];
  const units = ({ daily: "дн.", weekly: "нед.", monthly: "мес.", yearly: "г." })[rule];
  return number === 1 ? single : `каждые ${number} ${units}`;
}
function nextOccurrence(note, start = localDateString(), horizon = 365) {
  if (!note.due_date || note.deleted) return null;
  if ((note.repeat_rule || "none") === "none") return !note.completed_at && note.due_date >= start ? note.due_date : null;
  const cursor = new Date(`${start}T12:00:00`);
  for (let i = 0; i <= horizon; i += 1) {
    const candidate = localDateString(cursor);
    if (occurrenceForDate(note, candidate) && !isCompletedForOccurrence(note, candidate)) return candidate;
    cursor.setDate(cursor.getDate() + 1);
  }
  return null;
}
function typeLabel(type) {
  return ({ task: "Дело", birthday: "День рождения", subscription: "Подписка", product: "Продукт" })[type] || "Дело";
}
function expenseCategory(type) { return type === "subscription" ? "Подписки" : "Продукты"; }
function formatMoney(value) { return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Number(value) || 0)} ₽`; }
function monthExpenses() {
  const prefix = localDateString().slice(0, 7);
  return expenses.filter((item) => !item.deleted && item.spent_at.slice(0, 7) === prefix);
}
function render() {
  const query = els.search.value.trim().toLowerCase();
  const today = localDateString();
  const inThirtyDays = new Date(`${today}T12:00:00`); inThirtyDays.setDate(inThirtyDays.getDate() + 30);
  const upcomingLimit = localDateString(inThirtyDays);
  const visible = notes
    .filter((n) => !n.deleted)
    .filter((n) => {
      if (filter === "all" || filter === "expenses") return true;
      if (filter === "pinned") return n.pinned;
      if (filter === "upcoming") { const next = nextOccurrence(n, today, 30); return next && next >= today && next <= upcomingLimit; }
      return isDueToday(n, today);
    })
    .filter((n) => !query || `${n.title} ${n.content}`.toLowerCase().includes(query))
    .sort((a, b) => {
      if (filter === "upcoming") return (nextOccurrence(a, today, 30) || "9999").localeCompare(nextOccurrence(b, today, 30) || "9999");
      return Number(b.pinned) - Number(a.pinned) || new Date(b.updated_at) - new Date(a.updated_at);
    });
  els.grid.innerHTML = visible.map((note) => `
    <article class="note-card ${note.pinned ? "pinned" : ""} ${note.completed_at && (note.repeat_rule || "none") === "none" ? "completed" : ""}" data-id="${note.id}" tabindex="0">
      ${isDueToday(note, today) ? `<button class="card-complete" data-complete-id="${note.id}" type="button" aria-label="Выполнено">✓</button>` : ""}
      <span class="type-badge">${typeLabel(note.item_type)}</span>
      <h2>${escapeHtml(note.title || "Без названия")}</h2>
      <p>${escapeHtml(note.content || "Пустая заметка")}</p>
      <div class="note-meta"><span>${note.pinned ? "закреплено · " : ""}${repeatLabel(note.repeat_rule, note.repeat_interval) || formatDueDate(note.due_date)}</span><time>${note.amount ? formatMoney(note.amount) : formatDate(note.updated_at)}</time></div>
    </article>`).join("");
  const alive = notes.filter((n) => !n.deleted);
  const todayItems = alive.filter((n) => isDueToday(n, today));
  const upcomingItems = alive.filter((n) => { const next = nextOccurrence(n, today, 30); return next && next >= today && next <= upcomingLimit; });
  const spending = monthExpenses();
  const totalSpend = spending.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totals = spending.reduce((acc, item) => { acc[item.category] = (acc[item.category] || 0) + Number(item.amount || 0); return acc; }, {});
  const topCategory = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
  els.todayCount.textContent = todayItems.length;
  els.upcomingCount.textContent = upcomingItems.length;
  els.allCount.textContent = alive.length;
  els.pinnedCount.textContent = alive.filter((n) => n.pinned).length;
  els.summaryToday.textContent = todayItems.length;
  els.summarySpend.textContent = formatMoney(totalSpend);
  els.summaryTopCategory.textContent = topCategory ? `${topCategory[0]}: ${formatMoney(topCategory[1])}` : "пока без покупок";
  els.summaryUpcoming.textContent = upcomingItems.length;
  const expensesMode = filter === "expenses";
  els.expensesView.classList.toggle("hidden", !expensesMode);
  els.grid.classList.toggle("hidden", expensesMode || visible.length === 0);
  els.empty.classList.toggle("hidden", expensesMode || visible.length > 0);
  if (expensesMode) renderExpenses(spending, totals, totalSpend);
}

function renderExpenses(spending, totals, totalSpend) {
  const max = Math.max(...Object.values(totals), 1);
  const bars = Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([name, amount]) => `
    <div><div class="expense-bar-head"><span>${name}</span><b>${formatMoney(amount)}</b></div><div class="expense-bar-track"><div class="expense-bar-fill" style="width:${Math.round(amount / max * 100)}%"></div></div></div>`).join("");
  const rows = [...spending].sort((a, b) => new Date(b.spent_at) - new Date(a.spent_at)).map((item) => `
    <div class="expense-row"><strong>${escapeHtml(item.title)}</strong><span>${item.category} · ${new Date(item.spent_at).toLocaleDateString("ru-RU")}</span><b>${formatMoney(item.amount)}</b></div>`).join("");
  els.expensesView.innerHTML = `
    <div class="expense-total"><div><span>Потрачено за месяц</span><br><strong>${formatMoney(totalSpend)}</strong></div></div>
    ${spending.length ? `<div class="expense-bars">${bars}</div><div class="expense-list">${rows}</div>` : `<div class="empty-expenses">Здесь появятся оплаченные подписки и купленные продукты.</div>`}`;
}

function createNote() {
  const now = new Date().toISOString();
  const note = { id: crypto.randomUUID(), title: "", content: "", item_type: "task", amount: null, due_date: localDateString(), repeat_rule: "none", repeat_interval: 1, completed_at: null, pinned: false, updated_at: now, deleted: false, dirty: true };
  notes.unshift(note); persistNotes(); render(); openEditor(note.id); scheduleSync();
  requestAnimationFrame(() => els.title.focus());
}
function openEditor(id) {
  const note = notes.find((n) => n.id === id && !n.deleted);
  if (!note) return;
  activeId = id;
  els.title.value = note.title;
  els.type.value = note.item_type || "task";
  els.date.value = note.due_date || "";
  els.repeat.value = note.repeat_rule || "none";
  els.repeatInterval.value = note.repeat_interval || 1;
  els.amount.value = note.amount ?? "";
  els.content.value = note.content;
  updateTypeFields();
  els.pin.classList.toggle("active", note.pinned);
  els.pin.textContent = note.pinned ? "◆" : "◇";
  updateCompleteButton(note);
  updateEditorFooter(note);
  els.editor.classList.remove("hidden"); els.backdrop.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
function closeEditor() {
  flushEditor(); activeId = null;
  els.editor.classList.add("hidden"); els.backdrop.classList.add("hidden");
  document.body.style.overflow = "";
}
function flushEditor() {
  if (!activeId) return;
  const note = notes.find((n) => n.id === activeId);
  const amount = els.amount.value === "" ? null : Number(els.amount.value);
  const interval = Math.max(1, Number(els.repeatInterval.value) || 1);
  if (!note || (note.title === els.title.value && note.content === els.content.value && (note.item_type || "task") === els.type.value && Number(note.amount ?? 0) === Number(amount ?? 0) && (note.due_date || "") === els.date.value && (note.repeat_rule || "none") === els.repeat.value && Number(note.repeat_interval || 1) === interval)) return;
  note.title = els.title.value; note.content = els.content.value; note.item_type = els.type.value; note.amount = amount;
  note.due_date = els.date.value || null; note.repeat_rule = els.repeat.value; note.repeat_interval = interval;
  note.updated_at = new Date().toISOString(); note.dirty = true;
  persistNotes(); render(); updateEditorFooter(note); scheduleSync();
}
function updateEditorFooter(note) {
  els.charCount.textContent = `${note.content.length} знаков`;
  els.editedAt.textContent = `Сохранено ${formatDate(note.updated_at)}`;
}
function updateCompleteButton(note) {
  const occurrence = occurrenceForToday(note);
  const completed = Boolean(note.completed_at && ((note.repeat_rule || "none") === "none" || (occurrence && isCompletedForOccurrence(note, occurrence))));
  const action = note.item_type === "product" ? "Куплено" : note.item_type === "subscription" ? "Оплачено" : "Выполнено";
  els.complete.textContent = completed ? "↶ Отменить" : `✓ ${action}`;
  els.complete.classList.toggle("completed", completed);
}
function updateTypeFields() {
  const paid = els.type.value === "product" || els.type.value === "subscription";
  document.querySelector(".price-field").classList.toggle("hidden", !paid);
}
function applyTypeDefaults() {
  if (els.type.value === "birthday") { els.repeat.value = "yearly"; els.repeatInterval.value = 1; }
  if (els.type.value === "subscription") { els.repeat.value = "monthly"; els.repeatInterval.value = 1; }
  if (els.type.value === "product" && els.repeat.value === "none") { els.repeat.value = "weekly"; els.repeatInterval.value = 1; }
  if (els.type.value === "task") { els.amount.value = ""; }
  updateTypeFields(); flushEditor();
}
function debounceSave() { clearTimeout(saveTimer); saveTimer = setTimeout(flushEditor, 350); els.charCount.textContent = `${els.content.value.length} знаков`; }
function togglePin() {
  const note = notes.find((n) => n.id === activeId); if (!note) return;
  note.pinned = !note.pinned; note.updated_at = new Date().toISOString(); note.dirty = true;
  persistNotes(); render(); openEditor(note.id); scheduleSync();
}
function deleteActive() {
  const note = notes.find((n) => n.id === activeId); if (!note) return;
  note.deleted = true; note.updated_at = new Date().toISOString(); note.dirty = true;
  persistNotes(); closeEditor(); render(); scheduleSync(); showToast("Заметка удалена");
}
function completeNote(id) {
  const note = notes.find((n) => n.id === id); if (!note) return;
  const occurrence = occurrenceForToday(note);
  const currentlyCompleted = note.completed_at && ((note.repeat_rule || "none") === "none" || (occurrence && isCompletedForOccurrence(note, occurrence)));
  const occurrenceDate = occurrence || localDateString();
  note.completed_at = currentlyCompleted ? null : new Date().toISOString();
  note.updated_at = new Date().toISOString(); note.dirty = true;
  if ((note.item_type === "product" || note.item_type === "subscription") && Number(note.amount) > 0) {
    if (currentlyCompleted) {
      const expense = expenses.find((item) => item.item_id === note.id && item.occurrence_date === occurrenceDate && !item.deleted);
      if (expense) { expense.deleted = true; expense.dirty = true; expense.updated_at = new Date().toISOString(); }
    } else {
      expenses.unshift({ id: crypto.randomUUID(), item_id: note.id, title: note.title || typeLabel(note.item_type), category: expenseCategory(note.item_type), amount: Number(note.amount), occurrence_date: occurrenceDate, spent_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted: false, dirty: true });
    }
    persistExpenses();
  }
  persistNotes(); render(); if (activeId === id) updateCompleteButton(note); scheduleSync();
  const success = note.item_type === "product" ? "Покупка записана" : note.item_type === "subscription" ? "Оплата записана" : ((note.repeat_rule || "none") === "none" ? "Выполнено" : "Готово до следующего повтора");
  showToast(currentlyCompleted ? "Действие отменено" : success);
}

function api(path, options = {}, withAuth = false) {
  const headers = { apikey: config.supabaseAnonKey, "Content-Type": "application/json", ...options.headers };
  if (withAuth && session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  return fetch(`${config.supabaseUrl}${path}`, { ...options, headers });
}
async function authenticate(mode) {
  if (!cloudEnabled) {
    els.authMessage.textContent = "Сначала подключите облако по инструкции в README.md."; return;
  }
  const email = $("#emailInput").value.trim(); const password = $("#passwordInput").value;
  els.authMessage.textContent = "Подключаемся…";
  try {
    const path = mode === "signup" ? "/auth/v1/signup" : "/auth/v1/token?grant_type=password";
    const response = await api(path, { method: "POST", body: JSON.stringify({ email, password }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.msg || data.error_description || data.message || "Не удалось войти");
    if (!data.access_token) {
      els.authMessage.textContent = "Аккаунт создан. Подтвердите email и затем войдите."; return;
    }
    const localNotes = [...notes]; const localExpenses = [...expenses]; persistSession(data);
    notes = JSON.parse(localStorage.getItem(storageKey()) || "[]");
    expenses = JSON.parse(localStorage.getItem(expensesStorageKey()) || "[]");
    if (!notes.length && localNotes.length) notes = localNotes.map((n) => ({ ...n, dirty: true }));
    if (!expenses.length && localExpenses.length) expenses = localExpenses.map((n) => ({ ...n, dirty: true }));
    persistNotes(); persistExpenses(); els.auth.close(); render(); await syncNotes(); showToast("Синхронизация включена");
  } catch (error) { els.authMessage.textContent = error.message; }
}
async function refreshSession() {
  if (!session?.refresh_token || !cloudEnabled) return false;
  try {
    const response = await api("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: session.refresh_token }) });
    if (!response.ok) return false;
    persistSession(await response.json()); return true;
  } catch { return false; }
}
async function syncNotes(retried = false) {
  if (!cloudEnabled || !session?.access_token || !navigator.onLine) { updateSyncStatus(); return; }
  els.sync.textContent = "синхронизация…";
  try {
    const dirty = notes.filter((n) => n.dirty).map(({ dirty: _, ...n }) => ({ ...n, user_id: session.user.id }));
    if (dirty.length) {
      const pushed = await api("/rest/v1/notes?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(dirty) }, true);
      if (pushed.status === 401 && !retried && await refreshSession()) return syncNotes(true);
      if (!pushed.ok) throw new Error("Не удалось отправить изменения");
      notes.forEach((n) => { if (n.dirty) n.dirty = false; });
    }
    const dirtyExpenses = expenses.filter((n) => n.dirty).map(({ dirty: _, ...n }) => ({ ...n, user_id: session.user.id }));
    if (dirtyExpenses.length) {
      const pushedExpenses = await api("/rest/v1/expenses?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(dirtyExpenses) }, true);
      if (!pushedExpenses.ok) throw new Error("Не удалось отправить расходы");
      expenses.forEach((n) => { if (n.dirty) n.dirty = false; });
    }
    const response = await api("/rest/v1/notes?select=*&order=updated_at.desc", {}, true);
    if (response.status === 401 && !retried && await refreshSession()) return syncNotes(true);
    if (!response.ok) throw new Error("Не удалось получить заметки");
    const remote = await response.json();
    const merged = new Map(notes.map((n) => [n.id, n]));
    remote.forEach((item) => {
      const local = merged.get(item.id);
      if (!local || new Date(item.updated_at) >= new Date(local.updated_at)) merged.set(item.id, { ...item, dirty: false });
    });
    const expenseResponse = await api("/rest/v1/expenses?select=*&order=spent_at.desc", {}, true);
    if (!expenseResponse.ok) throw new Error("Не удалось получить расходы");
    const remoteExpenses = await expenseResponse.json();
    const expenseMerged = new Map(expenses.map((n) => [n.id, n]));
    remoteExpenses.forEach((item) => {
      const local = expenseMerged.get(item.id);
      if (!local || new Date(item.updated_at) >= new Date(local.updated_at)) expenseMerged.set(item.id, { ...item, dirty: false });
    });
    notes = [...merged.values()]; expenses = [...expenseMerged.values()]; persistNotes(); persistExpenses(); render(); els.sync.textContent = "синхронизировано";
  } catch { els.sync.textContent = "нет связи"; }
}
function scheduleSync() { clearTimeout(scheduleSync.timer); scheduleSync.timer = setTimeout(syncNotes, 900); }
function updateSyncStatus() {
  els.sync.textContent = session ? (navigator.onLine ? "готово" : "без сети") : "локально";
}
function updateAccountUI() {
  els.account.textContent = session?.user?.email ? session.user.email.slice(0, 1).toUpperCase() : "Войти";
  els.signOut.classList.toggle("hidden", !session);
  $("#signInButton").classList.toggle("hidden", Boolean(session));
  $("#signUpButton").classList.toggle("hidden", Boolean(session));
  els.authMessage.textContent = session ? `Выполнен вход: ${session.user.email}` : (cloudEnabled ? "" : "Облако ещё не подключено; заметки хранятся локально.");
  updateSyncStatus();
}
function signOut() { persistSession(null); notes = loadNotes(); expenses = loadExpenses(); els.auth.close(); render(); showToast("Вы вышли из аккаунта"); }
function showToast(message) { els.toast.textContent = message; els.toast.classList.remove("hidden"); setTimeout(() => els.toast.classList.add("hidden"), 2300); }

document.addEventListener("click", (event) => {
  const complete = event.target.closest("[data-complete-id]");
  if (complete) { event.stopPropagation(); completeNote(complete.dataset.completeId); return; }
  const card = event.target.closest(".note-card"); if (card) openEditor(card.dataset.id);
  const filterButton = event.target.closest(".filter");
  if (filterButton) { document.querySelectorAll(".filter").forEach((b) => b.classList.remove("active")); filterButton.classList.add("active"); filter = filterButton.dataset.filter; render(); }
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && activeId) closeEditor(); });
$("#newNoteButton").addEventListener("click", createNote); $("#emptyNewButton").addEventListener("click", createNote);
$("#closeEditorButton").addEventListener("click", closeEditor); els.backdrop.addEventListener("click", closeEditor);
els.title.addEventListener("input", debounceSave); els.content.addEventListener("input", debounceSave); els.date.addEventListener("change", flushEditor);
els.repeat.addEventListener("change", flushEditor); els.repeatInterval.addEventListener("change", flushEditor); els.amount.addEventListener("input", debounceSave); els.type.addEventListener("change", applyTypeDefaults);
els.pin.addEventListener("click", togglePin); $("#deleteButton").addEventListener("click", deleteActive);
els.complete.addEventListener("click", () => completeNote(activeId));
els.search.addEventListener("input", render); els.account.addEventListener("click", () => { updateAccountUI(); els.auth.showModal(); });
$("#closeAuthButton").addEventListener("click", () => els.auth.close());
els.authForm.addEventListener("submit", (event) => { event.preventDefault(); authenticate("signin"); });
$("#signUpButton").addEventListener("click", () => authenticate("signup")); els.signOut.addEventListener("click", signOut);
window.addEventListener("online", syncNotes); window.addEventListener("offline", updateSyncStatus);
window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); deferredInstall = event; els.install.classList.remove("hidden"); });
els.install.addEventListener("click", async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; els.install.classList.add("hidden"); });

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
updateAccountUI(); render(); if (session) syncNotes();
