const config = window.NOTES_CONFIG || {};
const cloudEnabled = Boolean(config.supabaseUrl && config.supabaseAnonKey);

const $ = (selector) => document.querySelector(selector);
const els = {
  grid: $("#notesGrid"), empty: $("#emptyState"), emptyTitle: $("#emptyTitle"), emptyText: $("#emptyText"),
  advanceSection: $("#advanceSection"), advanceGrid: $("#advanceGrid"),
  tasksSection: $("#tasksSection"), tasksList: $("#tasksList"), tasksProgressText: $("#tasksProgressText"), tasksProgressBar: $("#tasksProgressBar"),
  shoppingSection: $("#shoppingSection"), shoppingList: $("#shoppingList"), shoppingProgressText: $("#shoppingProgressText"), shoppingProgressBar: $("#shoppingProgressBar"),
  todayCount: $("#todayCount"), upcomingCount: $("#upcomingCount"), purchasesCount: $("#purchasesCount"), allCount: $("#allCount"), pinnedCount: $("#pinnedCount"), sync: $("#syncStatus"),
  editor: $("#editor"), backdrop: $("#editorBackdrop"), title: $("#noteTitle"),
  type: $("#itemType"), date: $("#noteDate"), repeat: $("#repeatRule"), repeatInterval: $("#repeatInterval"), remindDays: $("#remindDaysBefore"), amount: $("#itemAmount"),
  content: $("#noteContent"), charCount: $("#charCount"), editedAt: $("#editedAt"), expensesView: $("#expensesView"),
  greeting: $("#greeting"), weekStrip: $("#weekStrip"),
  menuButton: $("#menuButton"), appMenu: $("#appMenu"), menuBackdrop: $("#menuBackdrop"),
  prevWeek: $("#prevWeekButton"), nextWeek: $("#nextWeekButton"),
  pin: $("#pinButton"), auth: $("#authDialog"), authForm: $("#authForm"),
  authMessage: $("#authMessage"), account: $("#accountButton"), signOut: $("#signOutButton"),
  purchaseDialog: $("#purchaseDialog"), purchaseForm: $("#purchaseForm"), purchaseTitle: $("#purchaseTitle"), purchaseDate: $("#purchaseDate"), purchaseQuantity: $("#purchaseQuantity"), purchaseAmount: $("#purchaseAmount"), purchaseFormMessage: $("#purchaseFormMessage"),
  complete: $("#completeButton"), toast: $("#toast"), install: $("#installButton")
};

let notes = loadNotes();
let expenses = loadExpenses();
let activeId = null;
let filter = "today";
let selectedDate = localDateString();
let calendarStart = new Date(`${selectedDate}T12:00:00`);
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
function importPurchaseHistory() {
  const groups = window.PURCHASE_HISTORY || [];
  if (!groups.length) return;
  const owner = session?.user?.id || "local";
  const marker = `quiet-purchase-import:2026-07-v1:${owner}`;
  if (localStorage.getItem(marker)) return;
  const existingIds = new Set(expenses.map((item) => item.id));
  const imported = [];
  let sequence = 0;
  groups.forEach(([date, title, amount, count]) => {
    for (let copy = 0; copy < count; copy += 1) {
      sequence += 1;
      const id = `70000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
      if (existingIds.has(id)) continue;
      const timestamp = `${date}T12:00:00.000Z`;
      imported.push({ id, item_id: null, title, category: "Продукты", amount, occurrence_date: date, spent_at: timestamp, updated_at: timestamp, deleted: false, dirty: true });
    }
  });
  if (imported.length) {
    expenses = [...imported, ...expenses];
    persistExpenses();
  }
  localStorage.setItem(marker, "done");
}
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
function isDueOn(note, date) {
  const today = localDateString();
  if (date === today) return isDueToday(note, today);
  const occurrence = occurrenceForDate(note, date);
  if (!occurrence) return false;
  if ((note.repeat_rule || "none") === "none") return note.due_date === date && !note.completed_at;
  return !isCompletedForOccurrence(note, occurrence);
}
function advanceOccurrenceOn(note, date) {
  const leadDays = Math.max(0, Math.min(365, Number(note.remind_days_before) || 0));
  if (!leadDays || !note.due_date || note.deleted) return null;
  const cursor = new Date(`${date}T12:00:00`);
  for (let offset = 1; offset <= leadDays; offset += 1) {
    cursor.setDate(cursor.getDate() + 1);
    const candidate = localDateString(cursor);
    if (occurrenceForDate(note, candidate) && !isCompletedForOccurrence(note, candidate)) return candidate;
  }
  return null;
}
function daysUntilLabel(from, until) {
  const days = dayDifference(new Date(`${from}T12:00:00`), new Date(`${until}T12:00:00`));
  if (days === 1) return "Завтра";
  const ending = days % 10 === 1 && days % 100 !== 11 ? "день" : [2, 3, 4].includes(days % 10) && ![12, 13, 14].includes(days % 100) ? "дня" : "дней";
  return `Через ${days} ${ending}`;
}
function pluralRu(number, one, few, many) {
  const value = Math.abs(Number(number)) % 100;
  const last = value % 10;
  if (value > 10 && value < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}
function shoppingItemsForDate(date) {
  const today = localDateString();
  return notes.filter((note) => !note.deleted && note.item_type === "product").map((note) => {
    const rule = note.repeat_rule || "none";
    if (rule !== "none") {
      const occurrence = occurrenceForDate(note, date);
      return occurrence ? { note, occurrence, completed: isCompletedForOccurrence(note, occurrence) } : null;
    }
    if (note.completed_at) {
      const purchasedOn = localDateString(new Date(note.completed_at));
      return purchasedOn === date ? { note, occurrence: note.due_date || date, completed: true } : null;
    }
    const scheduled = !note.due_date ? date === today : (date === today ? note.due_date <= date : note.due_date === date);
    return scheduled ? { note, occurrence: note.due_date || date, completed: false } : null;
  }).filter(Boolean).sort((a, b) => Number(a.completed) - Number(b.completed) || (a.note.title || "").localeCompare(b.note.title || "", "ru"));
}
function taskItemsForDate(date) {
  const today = localDateString();
  return notes.filter((note) => !note.deleted && note.item_type === "task").map((note) => {
    const rule = note.repeat_rule || "none";
    if (rule !== "none") {
      const occurrence = occurrenceForDate(note, date);
      return occurrence ? { note, occurrence, completed: isCompletedForOccurrence(note, occurrence) } : null;
    }
    if (note.completed_at) {
      const completedOn = localDateString(new Date(note.completed_at));
      const belongsToDate = note.due_date === date || (completedOn === date && (!note.due_date || note.due_date <= date));
      return belongsToDate ? { note, occurrence: note.due_date || date, completed: true } : null;
    }
    const scheduled = !note.due_date ? date === today : (date === today ? note.due_date <= date : note.due_date === date);
    return scheduled ? { note, occurrence: note.due_date || date, completed: false } : null;
  }).filter(Boolean).sort((a, b) => Number(a.completed) - Number(b.completed) || (a.note.title || "").localeCompare(b.note.title || "", "ru"));
}
function taskDateLabel(note, date) {
  const recurring = repeatLabel(note.repeat_rule, note.repeat_interval);
  if (recurring) return recurring;
  if (note.due_date && note.due_date < date) return "Просрочено";
  return note.due_date ? new Date(`${note.due_date}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) : "Без даты";
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
  return ({ task: "Дело", event: "Событие", birthday: "День рождения", subscription: "Подписка", product: "Продукт" })[type] || "Дело";
}
function isEventItem(note) { return ["event", "birthday", "subscription"].includes(note.item_type); }
function expenseCategory(type) { return type === "subscription" ? "Подписки" : "Продукты"; }
function formatMoney(value) { return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Number(value) || 0)} ₽`; }
function monthExpenses() {
  const prefix = localDateString().slice(0, 7);
  return expenses.filter((item) => !item.deleted && item.spent_at.slice(0, 7) === prefix);
}
function renderCalendarHeader() {
  const hour = new Date().getHours();
  els.greeting.textContent = hour < 6 ? "Доброй ночи!" : hour < 12 ? "Доброе утро! 👋" : hour < 18 ? "Добрый день! 👋" : "Добрый вечер! 👋";
  const names = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  const months = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const today = new Date();
  els.weekStrip.innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(calendarStart); date.setDate(calendarStart.getDate() + index);
    const value = localDateString(date);
    const isToday = value === localDateString(today);
    return `<button class="day-chip ${value === selectedDate ? "active" : ""}" data-calendar-date="${value}" type="button"><span>${isToday ? "Сегодня" : names[date.getDay()]}</span><strong>${date.getDate()}</strong><small>${months[date.getMonth()]}</small></button>`;
  }).join("");
}
function updateViewTitle() {
  return undefined;
}
function setMenu(open) {
  els.appMenu.classList.toggle("open", open);
  els.menuBackdrop.classList.toggle("hidden", !open);
  els.menuButton.setAttribute("aria-expanded", String(open));
}
function selectCalendarView() {
  filter = "today";
  document.querySelectorAll(".filter").forEach((button) => button.classList.toggle("active", button.dataset.filter === "today"));
}
function render() {
  const today = localDateString();
  const inThirtyDays = new Date(`${today}T12:00:00`); inThirtyDays.setDate(inThirtyDays.getDate() + 30);
  const upcomingLimit = localDateString(inThirtyDays);
  const visible = notes
    .filter((n) => !n.deleted)
    .filter((n) => {
      if (filter === "all" || filter === "expenses" || filter === "purchases") return true;
      if (filter === "pinned") return n.pinned;
      if (filter === "upcoming") { const next = nextOccurrence(n, today, 30); return isEventItem(n) && next && next >= today && next <= upcomingLimit; }
      if (n.item_type === "product" || n.item_type === "task") return false;
      return isDueOn(n, selectedDate);
    })
    .sort((a, b) => {
      if (filter === "upcoming") return (nextOccurrence(a, today, 30) || "9999").localeCompare(nextOccurrence(b, today, 30) || "9999");
      return Number(b.pinned) - Number(a.pinned) || new Date(b.updated_at) - new Date(a.updated_at);
    });
  const advanceItems = filter === "today" ? notes
    .filter((n) => !n.deleted)
    .map((note) => ({ note, occurrence: advanceOccurrenceOn(note, selectedDate) }))
    .filter(({ occurrence }) => occurrence)
    .sort((a, b) => a.occurrence.localeCompare(b.occurrence)) : [];
  const advanceCards = advanceItems.map(({ note, occurrence }) => `
    <article class="note-card advance-card" data-id="${note.id}" tabindex="0">
      <div class="advance-card-top"><span class="type-badge">${typeLabel(note.item_type)}</span><strong>${daysUntilLabel(selectedDate, occurrence)}</strong></div>
      <h2>${escapeHtml(note.title || "Без названия")}</h2>
      ${note.content ? `<p>${escapeHtml(note.content)}</p>` : ""}
      <div class="note-meta"><span>Событие ${new Date(`${occurrence}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}</span><time>${note.amount ? formatMoney(note.amount) : `за ${note.remind_days_before} дн.`}</time></div>
    </article>`).join("");
  const taskItems = filter === "today" ? taskItemsForDate(selectedDate) : [];
  const canComplete = selectedDate === today;
  els.tasksList.innerHTML = taskItems.length ? taskItems.map(({ note, completed }) => `
    <div class="task-row ${completed ? "done" : ""}">
      <button class="task-check" data-task-id="${note.id}" type="button" aria-label="${completed ? "Вернуть задачу" : "Выполнено"}" ${canComplete ? "" : "disabled"}>${completed ? "✓" : ""}</button>
      <button class="task-name" data-task-edit="${note.id}" type="button">${escapeHtml(note.title || "Новая задача")}</button>
      <span>${taskDateLabel(note, selectedDate)}</span>
      <button class="task-edit" data-task-edit="${note.id}" type="button" aria-label="Изменить задачу">›</button>
    </div>`).join("") : `<p class="task-empty">Добавьте первую задачу на этот день.</p>`;
  const completedTasks = taskItems.filter((item) => item.completed).length;
  els.tasksProgressText.textContent = taskItems.length ? `${completedTasks} из ${taskItems.length} выполнено` : "Задач нет";
  els.tasksProgressBar.style.width = `${taskItems.length ? Math.round(completedTasks / taskItems.length * 100) : 0}%`;
  const shoppingItems = filter === "today" ? shoppingItemsForDate(selectedDate) : [];
  const canBuy = selectedDate === today;
  els.shoppingList.innerHTML = shoppingItems.length ? shoppingItems.map(({ note, completed }) => `
    <div class="shopping-row ${completed ? "bought" : ""}">
      <button class="shopping-check" data-buy-id="${note.id}" type="button" aria-label="${completed ? "Отменить покупку" : "Куплено"}" ${canBuy ? "" : "disabled"}>${completed ? "✓" : ""}</button>
      <button class="shopping-name" data-shopping-edit="${note.id}" type="button">${escapeHtml(note.title || "Новый продукт")}</button>
      ${note.amount ? `<span>${formatMoney(note.amount)}</span>` : ""}
      <button class="shopping-edit" data-shopping-edit="${note.id}" type="button" aria-label="Изменить">≡</button>
    </div>`).join("") : `<p class="shopping-empty">Добавьте продукты, которые нужно купить.</p>`;
  const boughtCount = shoppingItems.filter((item) => item.completed).length;
  els.shoppingProgressText.textContent = shoppingItems.length ? `${boughtCount} из ${shoppingItems.length} куплено` : "Список пуст";
  els.shoppingProgressBar.style.width = `${shoppingItems.length ? Math.round(boughtCount / shoppingItems.length * 100) : 0}%`;
  const regularCards = visible.map((note) => `
    <article class="note-card ${note.pinned ? "pinned" : ""} ${note.completed_at && (note.repeat_rule || "none") === "none" ? "completed" : ""}" data-id="${note.id}" tabindex="0">
      ${selectedDate === today && isDueToday(note, today) ? `<button class="card-complete" data-complete-id="${note.id}" type="button" aria-label="Выполнено">✓</button>` : ""}
      <span class="type-badge">${typeLabel(note.item_type)}</span>
      <h2>${escapeHtml(note.title || "Без названия")}</h2>
      ${note.content ? `<p>${escapeHtml(note.content)}</p>` : ""}
      <div class="note-meta"><span>${note.pinned ? "закреплено · " : ""}${repeatLabel(note.repeat_rule, note.repeat_interval) || formatDueDate(note.due_date)}</span><time>${note.amount ? formatMoney(note.amount) : formatDate(note.updated_at)}</time></div>
    </article>`).join("");
  els.advanceGrid.innerHTML = filter === "today" ? (advanceCards + regularCards || `<p class="event-empty">Добавьте событие или напоминание на этот день.</p>`) : "";
  els.grid.innerHTML = filter === "today" ? "" : regularCards;
  const alive = notes.filter((n) => !n.deleted);
  const todayItems = alive.filter((n) => isDueToday(n, today));
  const todayAdvanceItems = alive.filter((n) => advanceOccurrenceOn(n, today));
  const upcomingItems = alive.filter((n) => { const next = nextOccurrence(n, today, 30); return isEventItem(n) && next && next >= today && next <= upcomingLimit; });
  const spending = monthExpenses();
  const productPurchases = expenses.filter((item) => !item.deleted && item.category === "Продукты");
  const totalSpend = spending.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  els.todayCount.textContent = todayItems.length + todayAdvanceItems.length;
  els.upcomingCount.textContent = upcomingItems.length;
  els.purchasesCount.textContent = new Set(productPurchases.map((item) => item.title.trim().toLowerCase())).size;
  els.allCount.textContent = alive.length;
  els.pinnedCount.textContent = alive.filter((n) => n.pinned).length;
  const specialMode = filter === "expenses" || filter === "purchases";
  els.advanceSection.classList.toggle("hidden", filter !== "today");
  els.tasksSection.classList.toggle("hidden", filter !== "today");
  els.shoppingSection.classList.toggle("hidden", filter !== "today");
  els.expensesView.classList.toggle("hidden", !specialMode);
  els.grid.classList.toggle("hidden", specialMode || filter === "today" || visible.length === 0);
  els.empty.classList.toggle("hidden", specialMode || filter === "today" || visible.length > 0);
  if (!specialMode && filter !== "today" && visible.length === 0) {
    els.emptyTitle.textContent = filter === "upcoming" ? "Предстоящих событий нет" : selectedDate === today ? "На сегодня всё спокойно" : "На этот день ничего нет";
    els.emptyText.textContent = filter === "upcoming" ? "Здесь появятся ближайшие события, дни рождения и подписки." : `Можно создать новую запись на ${new Date(`${selectedDate}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}.`;
  }
  if (filter === "expenses") renderExpenses(spending, totalSpend);
  if (filter === "purchases") renderPurchases(productPurchases);
}

function renderExpenses(spending, totalSpend) {
  const productSpending = spending.filter((item) => item.category === "Продукты");
  const chronologically = [...productSpending].sort((a, b) => new Date(a.spent_at) - new Date(b.spent_at));
  const grouped = new Map();
  chronologically.forEach((item) => {
    const key = item.title.trim().toLowerCase();
    const amount = Number(item.amount || 0);
    const current = grouped.get(key) || { title: item.title, count: 0, total: 0, firstPrice: amount, lastPrice: amount, minPrice: amount, maxPrice: amount };
    current.count += 1;
    current.total += amount;
    current.lastPrice = amount;
    current.minPrice = Math.min(current.minPrice, amount);
    current.maxPrice = Math.max(current.maxPrice, amount);
    grouped.set(key, current);
  });
  const products = [...grouped.values()].sort((a, b) => b.total - a.total);
  const averagePurchase = productSpending.length ? productSpending.reduce((sum, item) => sum + Number(item.amount || 0), 0) / productSpending.length : 0;
  const topProduct = products[0];
  const productRows = products.map((product, index) => {
    const share = totalSpend ? Math.round(product.total / totalSpend * 100) : 0;
    const average = product.total / product.count;
    const delta = product.lastPrice - product.firstPrice;
    const trendClass = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
    const trendText = delta > 0 ? `▲ ${formatMoney(Math.abs(delta))}` : delta < 0 ? `▼ ${formatMoney(Math.abs(delta))}` : "без изменений";
    return `<article class="product-analytics-row">
      <div class="analytics-rank">${index + 1}</div>
      <div class="analytics-product-main">
        <div class="analytics-product-title"><strong>${escapeHtml(product.title)}</strong><b>${formatMoney(product.total)}</b></div>
        <div class="analytics-share-track"><i style="width:${share}%"></i></div>
        <div class="analytics-product-meta"><span>${product.count} ${pluralRu(product.count, "покупка", "покупки", "покупок")} · ${share}% расходов</span><span>средняя ${formatMoney(average)}</span></div>
      </div>
      <div class="analytics-price"><small>последняя</small><strong>${formatMoney(product.lastPrice)}</strong><span class="trend ${trendClass}">${trendText}</span></div>
    </article>`;
  }).join("");
  const rows = [...spending].sort((a, b) => new Date(b.spent_at) - new Date(a.spent_at)).map((item) => `
    <div class="expense-row"><strong>${escapeHtml(item.title)}</strong><span>${item.category} · ${new Date(item.spent_at).toLocaleDateString("ru-RU")}</span><b>${formatMoney(item.amount)}</b></div>`).join("");
  const monthLabel = new Date(`${localDateString().slice(0, 7)}-01T12:00:00`).toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  els.expensesView.innerHTML = `
    <div class="expense-total"><div><span>${monthLabel}</span><br><strong>${formatMoney(totalSpend)}</strong><small>потрачено за месяц</small></div></div>
    ${spending.length ? `
      <div class="analytics-summary">
        <div><span>Покупок</span><strong>${productSpending.length}</strong></div>
        <div><span>Разных товаров</span><strong>${products.length}</strong></div>
        <div><span>Средняя покупка</span><strong>${formatMoney(averagePurchase)}</strong></div>
        <div><span>Больше всего</span><strong>${topProduct ? escapeHtml(topProduct.title) : "—"}</strong></div>
      </div>
      <section class="product-analytics"><div class="analytics-heading"><div><span>Аналитика</span><h3>Расходы по товарам</h3></div><b>${products.length} ${pluralRu(products.length, "товар", "товара", "товаров")}</b></div>${productRows}</section>
      <details class="expense-history"><summary>Все покупки за месяц <b>${spending.length}</b></summary><div class="expense-list">${rows}</div></details>` : `<div class="empty-expenses">Здесь появятся оплаченные подписки и купленные продукты.</div>`}`;
}

function renderPurchases(productPurchases) {
  const grouped = new Map();
  productPurchases.forEach((item) => {
    const key = item.title.trim().toLowerCase();
    const current = grouped.get(key) || { title: item.title, count: 0, total: 0, last: item.spent_at };
    current.count += 1; current.total += Number(item.amount || 0);
    if (new Date(item.spent_at) > new Date(current.last)) current.last = item.spent_at;
    grouped.set(key, current);
  });
  const cards = [...grouped.values()].sort((a, b) => new Date(b.last) - new Date(a.last)).map((item) => `
    <article class="purchase-item"><strong>${escapeHtml(item.title)}</strong><span>Последняя покупка: ${new Date(item.last).toLocaleDateString("ru-RU")}</span><span>Куплено раз: ${item.count}</span><b>Всего ${formatMoney(item.total)}</b></article>`).join("");
  els.expensesView.innerHTML = `
    <div class="purchase-view-head">
      <div><span>История</span><h2>Купленные товары</h2></div>
      <button class="list-add" data-add-purchase type="button" aria-label="Добавить купленный товар">＋</button>
    </div>
    ${productPurchases.length ? `<div class="purchase-catalog">${cards}</div>` : `<div class="empty-expenses">Добавьте первый купленный товар с помощью кнопки «＋».</div>`}`;
}

function openPurchaseDialog() {
  els.purchaseForm.reset();
  els.purchaseDate.value = localDateString();
  els.purchaseQuantity.value = 1;
  els.purchaseFormMessage.textContent = "";
  els.purchaseDialog.showModal();
  requestAnimationFrame(() => els.purchaseTitle.focus());
}

function addPurchasedProduct(event) {
  event.preventDefault();
  const title = els.purchaseTitle.value.trim();
  const date = els.purchaseDate.value;
  const quantity = Math.max(1, Math.min(99, Number.parseInt(els.purchaseQuantity.value, 10) || 1));
  const amount = Number(els.purchaseAmount.value);
  if (!title || !date || !Number.isFinite(amount) || amount < 0) {
    els.purchaseFormMessage.textContent = "Заполните название, дату и цену.";
    return;
  }
  const now = new Date().toISOString();
  const spentAt = new Date(`${date}T12:00:00`).toISOString();
  const added = Array.from({ length: quantity }, () => ({
    id: crypto.randomUUID(), item_id: null, title, category: "Продукты", amount,
    occurrence_date: date, spent_at: spentAt, updated_at: now, deleted: false, dirty: true
  }));
  expenses = [...added, ...expenses];
  persistExpenses();
  els.purchaseDialog.close();
  render();
  scheduleSync();
  showToast(quantity === 1 ? "Покупка добавлена" : `Добавлено: ${quantity} шт.`);
}

function createNote(initialType = "task") {
  const now = new Date().toISOString();
  const note = { id: crypto.randomUUID(), title: "", content: "", item_type: initialType, amount: null, due_date: selectedDate, repeat_rule: "none", repeat_interval: 1, remind_days_before: 0, completed_at: null, pinned: false, updated_at: now, deleted: false, dirty: true };
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
  els.remindDays.value = note.remind_days_before || 0;
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
  const remindDays = Math.max(0, Math.min(365, Number(els.remindDays.value) || 0));
  if (!note || (note.title === els.title.value && note.content === els.content.value && (note.item_type || "task") === els.type.value && Number(note.amount ?? 0) === Number(amount ?? 0) && (note.due_date || "") === els.date.value && (note.repeat_rule || "none") === els.repeat.value && Number(note.repeat_interval || 1) === interval && Number(note.remind_days_before || 0) === remindDays)) return;
  note.title = els.title.value; note.content = els.content.value; note.item_type = els.type.value; note.amount = amount;
  note.due_date = els.date.value || null; note.repeat_rule = els.repeat.value; note.repeat_interval = interval; note.remind_days_before = remindDays;
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
  if (els.type.value === "task" || els.type.value === "event" || els.type.value === "birthday") { els.amount.value = ""; }
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
  if (note.item_type === "product" || note.item_type === "subscription") {
    if (currentlyCompleted) {
      const expense = expenses.find((item) => item.item_id === note.id && item.occurrence_date === occurrenceDate && !item.deleted);
      if (expense) { expense.deleted = true; expense.dirty = true; expense.updated_at = new Date().toISOString(); }
    } else {
      expenses.unshift({ id: crypto.randomUUID(), item_id: note.id, title: note.title || typeLabel(note.item_type), category: expenseCategory(note.item_type), amount: Number(note.amount) || 0, occurrence_date: occurrenceDate, spent_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted: false, dirty: true });
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
  const calendarDay = event.target.closest("[data-calendar-date]");
  if (calendarDay) {
    selectedDate = calendarDay.dataset.calendarDate; selectCalendarView();
    renderCalendarHeader(); updateViewTitle(); render(); return;
  }
  const complete = event.target.closest("[data-complete-id]");
  if (complete) { event.stopPropagation(); completeNote(complete.dataset.completeId); return; }
  const buy = event.target.closest("[data-buy-id]");
  if (buy) { event.stopPropagation(); completeNote(buy.dataset.buyId); return; }
  const task = event.target.closest("[data-task-id]");
  if (task) { event.stopPropagation(); completeNote(task.dataset.taskId); return; }
  const taskEdit = event.target.closest("[data-task-edit]");
  if (taskEdit) { openEditor(taskEdit.dataset.taskEdit); return; }
  const shoppingEdit = event.target.closest("[data-shopping-edit]");
  if (shoppingEdit) { openEditor(shoppingEdit.dataset.shoppingEdit); return; }
  if (event.target.closest("[data-add-purchase]")) { openPurchaseDialog(); return; }
  const card = event.target.closest(".note-card"); if (card) openEditor(card.dataset.id);
  const filterButton = event.target.closest(".filter");
  if (filterButton) { document.querySelectorAll(".filter").forEach((b) => b.classList.remove("active")); filterButton.classList.add("active"); filter = filterButton.dataset.filter; setMenu(false); updateViewTitle(); render(); }
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && activeId) closeEditor(); });
$("#emptyNewButton").addEventListener("click", () => createNote());
$("#addEventItem").addEventListener("click", () => createNote("event"));
$("#addTaskItem").addEventListener("click", () => createNote("task"));
$("#addShoppingItem").addEventListener("click", () => createNote("product"));
$("#closeEditorButton").addEventListener("click", closeEditor); els.backdrop.addEventListener("click", closeEditor);
els.title.addEventListener("input", debounceSave); els.content.addEventListener("input", debounceSave); els.date.addEventListener("change", flushEditor);
els.repeat.addEventListener("change", flushEditor); els.repeatInterval.addEventListener("change", flushEditor); els.remindDays.addEventListener("input", debounceSave); els.amount.addEventListener("input", debounceSave); els.type.addEventListener("change", applyTypeDefaults);
els.pin.addEventListener("click", togglePin); $("#deleteButton").addEventListener("click", deleteActive);
els.complete.addEventListener("click", () => completeNote(activeId));
els.account.addEventListener("click", () => { updateAccountUI(); els.auth.showModal(); });
$("#closeAuthButton").addEventListener("click", () => els.auth.close());
els.authForm.addEventListener("submit", (event) => { event.preventDefault(); authenticate("signin"); });
$("#signUpButton").addEventListener("click", () => authenticate("signup")); els.signOut.addEventListener("click", signOut);
els.purchaseForm.addEventListener("submit", addPurchasedProduct);
$("#closePurchaseButton").addEventListener("click", () => els.purchaseDialog.close());
els.menuButton.addEventListener("click", () => setMenu(!els.appMenu.classList.contains("open")));
els.menuBackdrop.addEventListener("click", () => setMenu(false));
els.prevWeek.addEventListener("click", () => { calendarStart.setDate(calendarStart.getDate() - 7); selectedDate = localDateString(calendarStart); selectCalendarView(); renderCalendarHeader(); updateViewTitle(); render(); });
els.nextWeek.addEventListener("click", () => { calendarStart.setDate(calendarStart.getDate() + 7); selectedDate = localDateString(calendarStart); selectCalendarView(); renderCalendarHeader(); updateViewTitle(); render(); });
window.addEventListener("online", syncNotes); window.addEventListener("offline", updateSyncStatus);
window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); deferredInstall = event; els.install.classList.remove("hidden"); });
els.install.addEventListener("click", async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; els.install.classList.add("hidden"); });

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
importPurchaseHistory();
renderCalendarHeader(); updateViewTitle(); updateAccountUI(); render(); if (session) syncNotes();
