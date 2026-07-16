const config = window.NOTES_CONFIG || {};
const cloudEnabled = Boolean(config.supabaseUrl && config.supabaseAnonKey);

const $ = (selector) => document.querySelector(selector);
const els = {
  grid: $("#notesGrid"), empty: $("#emptyState"), search: $("#searchInput"),
  allCount: $("#allCount"), pinnedCount: $("#pinnedCount"), sync: $("#syncStatus"),
  editor: $("#editor"), backdrop: $("#editorBackdrop"), title: $("#noteTitle"),
  content: $("#noteContent"), charCount: $("#charCount"), editedAt: $("#editedAt"),
  pin: $("#pinButton"), auth: $("#authDialog"), authForm: $("#authForm"),
  authMessage: $("#authMessage"), account: $("#accountButton"), signOut: $("#signOutButton"),
  toast: $("#toast"), install: $("#installButton")
};

let notes = loadNotes();
let activeId = null;
let filter = "all";
let saveTimer;
let deferredInstall;
let session = loadSession();

function storageKey() { return `quiet-notes:${session?.user?.id || "local"}`; }
function loadNotes() {
  try {
    const localSession = JSON.parse(localStorage.getItem("quiet-notes:session") || "null");
    const key = `quiet-notes:${localSession?.user?.id || "local"}`;
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch { return []; }
}
function persistNotes() { localStorage.setItem(storageKey(), JSON.stringify(notes)); }
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
function render() {
  const query = els.search.value.trim().toLowerCase();
  const visible = notes
    .filter((n) => !n.deleted)
    .filter((n) => filter === "all" || n.pinned)
    .filter((n) => !query || `${n.title} ${n.content}`.toLowerCase().includes(query))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.updated_at) - new Date(a.updated_at));
  els.grid.innerHTML = visible.map((note) => `
    <article class="note-card ${note.pinned ? "pinned" : ""}" data-id="${note.id}" tabindex="0">
      <h2>${escapeHtml(note.title || "Без названия")}</h2>
      <p>${escapeHtml(note.content || "Пустая заметка")}</p>
      <div class="note-meta"><span>${note.pinned ? "закреплено" : "заметка"}</span><time>${formatDate(note.updated_at)}</time></div>
    </article>`).join("");
  const alive = notes.filter((n) => !n.deleted);
  els.allCount.textContent = alive.length;
  els.pinnedCount.textContent = alive.filter((n) => n.pinned).length;
  els.empty.classList.toggle("hidden", visible.length > 0);
  els.grid.classList.toggle("hidden", visible.length === 0);
}

function createNote() {
  const now = new Date().toISOString();
  const note = { id: crypto.randomUUID(), title: "", content: "", pinned: false, updated_at: now, deleted: false, dirty: true };
  notes.unshift(note); persistNotes(); render(); openEditor(note.id); scheduleSync();
  requestAnimationFrame(() => els.title.focus());
}
function openEditor(id) {
  const note = notes.find((n) => n.id === id && !n.deleted);
  if (!note) return;
  activeId = id;
  els.title.value = note.title;
  els.content.value = note.content;
  els.pin.classList.toggle("active", note.pinned);
  els.pin.textContent = note.pinned ? "◆" : "◇";
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
  if (!note || (note.title === els.title.value && note.content === els.content.value)) return;
  note.title = els.title.value; note.content = els.content.value;
  note.updated_at = new Date().toISOString(); note.dirty = true;
  persistNotes(); render(); updateEditorFooter(note); scheduleSync();
}
function updateEditorFooter(note) {
  els.charCount.textContent = `${note.content.length} знаков`;
  els.editedAt.textContent = `Сохранено ${formatDate(note.updated_at)}`;
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
    const localNotes = [...notes]; persistSession(data); notes = JSON.parse(localStorage.getItem(storageKey()) || "[]");
    if (!notes.length && localNotes.length) notes = localNotes.map((n) => ({ ...n, dirty: true }));
    persistNotes(); els.auth.close(); render(); await syncNotes(); showToast("Синхронизация включена");
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
    const response = await api("/rest/v1/notes?select=*&order=updated_at.desc", {}, true);
    if (response.status === 401 && !retried && await refreshSession()) return syncNotes(true);
    if (!response.ok) throw new Error("Не удалось получить заметки");
    const remote = await response.json();
    const merged = new Map(notes.map((n) => [n.id, n]));
    remote.forEach((item) => {
      const local = merged.get(item.id);
      if (!local || new Date(item.updated_at) >= new Date(local.updated_at)) merged.set(item.id, { ...item, dirty: false });
    });
    notes = [...merged.values()]; persistNotes(); render(); els.sync.textContent = "синхронизировано";
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
function signOut() { persistSession(null); notes = loadNotes(); els.auth.close(); render(); showToast("Вы вышли из аккаунта"); }
function showToast(message) { els.toast.textContent = message; els.toast.classList.remove("hidden"); setTimeout(() => els.toast.classList.add("hidden"), 2300); }

document.addEventListener("click", (event) => {
  const card = event.target.closest(".note-card"); if (card) openEditor(card.dataset.id);
  const filterButton = event.target.closest(".filter");
  if (filterButton) { document.querySelectorAll(".filter").forEach((b) => b.classList.remove("active")); filterButton.classList.add("active"); filter = filterButton.dataset.filter; render(); }
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && activeId) closeEditor(); });
$("#newNoteButton").addEventListener("click", createNote); $("#emptyNewButton").addEventListener("click", createNote);
$("#closeEditorButton").addEventListener("click", closeEditor); els.backdrop.addEventListener("click", closeEditor);
els.title.addEventListener("input", debounceSave); els.content.addEventListener("input", debounceSave);
els.pin.addEventListener("click", togglePin); $("#deleteButton").addEventListener("click", deleteActive);
els.search.addEventListener("input", render); els.account.addEventListener("click", () => { updateAccountUI(); els.auth.showModal(); });
$("#closeAuthButton").addEventListener("click", () => els.auth.close());
els.authForm.addEventListener("submit", (event) => { event.preventDefault(); authenticate("signin"); });
$("#signUpButton").addEventListener("click", () => authenticate("signup")); els.signOut.addEventListener("click", signOut);
window.addEventListener("online", syncNotes); window.addEventListener("offline", updateSyncStatus);
window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); deferredInstall = event; els.install.classList.remove("hidden"); });
els.install.addEventListener("click", async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; els.install.classList.add("hidden"); });

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
updateAccountUI(); render(); if (session) syncNotes();
