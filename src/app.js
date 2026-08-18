import { HISTORY_WINDOW_DAYS, STATUS_KEYS, STATUS_META } from "./constants.js";
import {
  getDateButtonParts,
  getDateWindow,
  getSelectedDateCopy,
  toDateKey
} from "./dates.js";
import {
  addPeople,
  archivePerson,
  createBackupPayload,
  fillMissingFromDefaults,
  getActivePeople,
  getArchivedPeople,
  getDailyCounts,
  getEntry,
  getOverviewPeople,
  initializeDay,
  movePerson,
  normalizeState,
  renamePerson,
  restoreBackupPayload,
  restoreBulkSnapshot,
  restorePerson,
  setAllActivePeopleStatus,
  setPersonStatus
} from "./model.js";
import { generateOverviewFiles } from "./overview.js";
import { loadState, requestPersistentStorage, saveState } from "./storage.js";

const elements = Object.fromEntries([
  "peopleCount",
  "manageButton",
  "installCard",
  "installHelpButton",
  "readinessCard",
  "readinessText",
  "selectedDateLabel",
  "selectedDateTitle",
  "todayButton",
  "dateStrip",
  "dailyPanel",
  "dailySummary",
  "quickActions",
  "markAllPresentButton",
  "fillDefaultsButton",
  "emptyState",
  "emptyAddButton",
  "attendanceList",
  "addInlineButton",
  "shareButton",
  "shareButtonLabel",
  "rosterDialog",
  "addPeopleForm",
  "peopleInput",
  "manageList",
  "activeRosterCount",
  "archivedSection",
  "archivedCount",
  "archivedList",
  "backupButton",
  "restoreButton",
  "restoreInput",
  "installDialog",
  "nativeInstallButton",
  "previewDialog",
  "previewPages",
  "shareFallbackText",
  "downloadOverviewLinks",
  "toast",
  "toastText",
  "toastAction"
].map((id) => [id, document.getElementById(id)]));

let state;
let todayKey = toDateKey();
let selectedDate = todayKey;
let dateWindow = getDateWindow(todayKey, HISTORY_WINDOW_DAYS);
let stateRevision = 0;
let overviewFiles = [];
let overviewReadyRevision = -1;
let overviewGenerationToken = 0;
let overviewTimer = null;
let previewObjectUrls = [];
let toastTimer = null;
let toastActionHandler = null;
let offlineReady = false;
let deferredInstallPrompt = null;

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  elements.installCard.hidden = isStandalone();
  elements.nativeInstallButton.hidden = false;
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  elements.installCard.hidden = true;
  closeDialog(elements.installDialog);
  showToast("Приложение установлено");
  void requestPersistentStorage();
});

function createSvg(pathData, viewBox = "0 0 24 24") {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("aria-hidden", "true");
  const paths = Array.isArray(pathData) ? pathData : [pathData];
  for (const data of paths) {
    const path = document.createElementNS(namespace, "path");
    path.setAttribute("d", data);
    svg.append(path);
  }
  return svg;
}

function openDialog(dialog) {
  if (!dialog || dialog.open) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeDialog(dialog) {
  if (!dialog?.open) return;
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function clearToast() {
  window.clearTimeout(toastTimer);
  toastTimer = null;
  toastActionHandler = null;
  elements.toast.hidden = true;
  elements.toastAction.hidden = true;
  elements.toastAction.onclick = null;
}

function showToast(message, options = {}) {
  clearToast();
  elements.toastText.textContent = message;

  if (options.actionLabel && options.onAction) {
    toastActionHandler = options.onAction;
    elements.toastAction.textContent = options.actionLabel;
    elements.toastAction.hidden = false;
    elements.toastAction.onclick = () => {
      const handler = toastActionHandler;
      clearToast();
      handler?.();
    };
  }

  elements.toast.hidden = false;
  toastTimer = window.setTimeout(clearToast, options.duration ?? 4600);
}

function reportStorageError() {
  showToast("Не удалось сохранить данные. Сделайте резервную копию.", { duration: 7000 });
}

function commitState({ renderRoster = false, changedPersonId = null } = {}) {
  stateRevision += 1;
  void saveState(state).catch(reportStorageError);
  renderMain(changedPersonId);
  if (renderRoster) renderRosterEditor();
  scheduleOverview();
}

function renderDateStrip() {
  const fragment = document.createDocumentFragment();
  const activePeople = getActivePeople(state);

  for (const dateKey of dateWindow) {
    const parts = getDateButtonParts(dateKey, todayKey);
    const counts = getDailyCounts(state, dateKey);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "date-button";
    button.dataset.date = dateKey;
    let dataLabel = "Нет отметок";
    if (counts.total - counts.missing > 0) dataLabel = "Есть отметки";
    if (activePeople.length > 0 && counts.missing === 0) dataLabel = "Все отмечены";
    button.setAttribute("aria-label", `${parts.ariaLabel}. ${dataLabel}.`);
    if (dateKey === selectedDate) button.setAttribute("aria-current", "date");
    if (counts.total - counts.missing > 0) button.classList.add("has-data");
    if (activePeople.length > 0 && counts.missing === 0) button.classList.add("is-complete");

    const weekday = document.createElement("span");
    weekday.className = "date-button-day";
    weekday.textContent = parts.weekday;
    const number = document.createElement("span");
    number.className = "date-button-number";
    number.textContent = parts.dayNumber;
    const stateDot = document.createElement("span");
    stateDot.className = "date-button-state";
    stateDot.setAttribute("aria-hidden", "true");
    button.append(weekday, number, stateDot);
    fragment.append(button);
  }

  elements.dateStrip.replaceChildren(fragment);
}

function renderSummary() {
  const counts = getDailyCounts(state, selectedDate);
  const chips = [
    ["present", `Здесь ${counts.present}`],
    ["sick", `Болеют ${counts.sick}`],
    ["drunk", `Забухали ${counts.drunk}`]
  ];
  if (counts.missing > 0) chips.unshift(["missing", `Не отмечено ${counts.missing}`]);

  const fragment = document.createDocumentFragment();
  for (const [kind, label] of chips) {
    const chip = document.createElement("span");
    chip.className = `summary-chip summary-chip-${kind}`;
    chip.textContent = label;
    fragment.append(chip);
  }
  elements.dailySummary.replaceChildren(fragment);
  elements.markAllPresentButton.disabled = counts.total === 0;
  elements.fillDefaultsButton.disabled = counts.total === 0 || counts.missing === 0;
}

function createStatusButton(person, status, selectedStatus) {
  const meta = STATUS_META[status];
  const button = document.createElement("button");
  button.type = "button";
  button.className = "status-button";
  button.dataset.personId = person.id;
  button.dataset.status = status;
  button.setAttribute("aria-pressed", String(selectedStatus === status));
  button.setAttribute("aria-label", `${person.name}: ${meta.label}`);
  button.title = meta.label;

  const mark = document.createElement("span");
  mark.className = "status-button-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = meta.mark;
  const label = document.createElement("span");
  label.textContent = meta.compactLabel;
  button.append(mark, label);
  return button;
}

function renderAttendanceList(changedPersonId = null) {
  const fragment = document.createDocumentFragment();

  for (const person of getActivePeople(state)) {
    const entry = getEntry(state, selectedDate, person.id);
    const card = document.createElement("article");
    card.className = "person-card";
    card.dataset.personId = person.id;
    if (entry?.status) card.dataset.status = entry.status;
    if (person.id === changedPersonId) card.classList.add("just-changed");

    const nameRow = document.createElement("div");
    nameRow.className = "person-name-row";
    const name = document.createElement("h3");
    name.className = "person-name";
    name.textContent = person.name;
    name.title = person.name;
    const note = document.createElement("span");
    note.className = "default-note";
    if (!entry) note.textContent = "не отмечен";
    else if (entry.source === "default") note.textContent = "по умолчанию";
    nameRow.append(name, note);

    const options = document.createElement("div");
    options.className = "status-options";
    options.setAttribute("role", "group");
    options.setAttribute("aria-label", `Статус: ${person.name}`);
    for (const status of STATUS_KEYS) {
      options.append(createStatusButton(person, status, entry?.status));
    }

    card.append(nameRow, options);
    fragment.append(card);
  }

  elements.attendanceList.replaceChildren(fragment);
}

function updateShareButton() {
  const hasOverviewPeople = getOverviewPeople(state, dateWindow).length > 0;
  const isReady = overviewFiles.length > 0 && overviewReadyRevision === stateRevision;
  elements.shareButton.disabled = !hasOverviewPeople || !isReady;

  if (!hasOverviewPeople) elements.shareButtonLabel.textContent = "Сначала добавьте людей";
  else if (!isReady) elements.shareButtonLabel.textContent = "Готовим сводку…";
  else elements.shareButtonLabel.textContent = "Поделиться сводкой";
}

function renderMain(changedPersonId = null) {
  const people = getActivePeople(state);
  const selectedCopy = getSelectedDateCopy(selectedDate, todayKey);
  elements.peopleCount.textContent = String(people.length);
  elements.selectedDateLabel.textContent = selectedCopy.kicker;
  elements.selectedDateTitle.textContent = selectedCopy.title;
  elements.todayButton.hidden = selectedDate === todayKey;
  elements.emptyState.hidden = people.length > 0;
  elements.dailyPanel.hidden = people.length === 0;
  elements.addInlineButton.hidden = people.length === 0;
  renderDateStrip();
  renderSummary();
  renderAttendanceList(changedPersonId);
  updateShareButton();
}

function createManageControl(label, pathData, options = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `manage-control${options.remove ? " is-remove" : ""}`;
  button.setAttribute("aria-label", label);
  if (options.action) button.dataset.action = options.action;
  if (options.personId) button.dataset.personId = options.personId;
  if (options.direction) button.dataset.direction = String(options.direction);
  if (options.disabled) button.disabled = true;
  button.append(createSvg(pathData));
  return button;
}

function renderRosterEditor() {
  const activePeople = getActivePeople(state);
  const archivedPeople = getArchivedPeople(state);
  elements.activeRosterCount.textContent = String(activePeople.length);
  elements.archivedCount.textContent = String(archivedPeople.length);
  elements.archivedSection.hidden = archivedPeople.length === 0;

  const activeFragment = document.createDocumentFragment();
  if (!activePeople.length) {
    const empty = document.createElement("div");
    empty.className = "manage-empty";
    empty.textContent = "Пока никого нет";
    activeFragment.append(empty);
  }

  activePeople.forEach((person, index) => {
    const row = document.createElement("div");
    row.className = "manage-row";
    const input = document.createElement("input");
    input.className = "manage-name-input";
    input.type = "text";
    input.maxLength = 80;
    input.value = person.name;
    input.dataset.personId = person.id;
    input.dataset.originalName = person.name;
    input.setAttribute("aria-label", `Имя: ${person.name}`);

    const controls = document.createElement("div");
    controls.className = "manage-controls";
    controls.append(
      createManageControl("Поднять выше", "m18 15-6-6-6 6", {
        action: "move",
        personId: person.id,
        direction: -1,
        disabled: index === 0
      }),
      createManageControl("Опустить ниже", "m6 9 6 6 6-6", {
        action: "move",
        personId: person.id,
        direction: 1,
        disabled: index === activePeople.length - 1
      }),
      createManageControl("Убрать из списка", ["M3 6h18", "M8 6V4h8v2", "m19 6-1 14H6L5 6", "M10 11v5M14 11v5"], {
        action: "archive",
        personId: person.id,
        remove: true
      })
    );
    row.append(input, controls);
    activeFragment.append(row);
  });
  elements.manageList.replaceChildren(activeFragment);

  const archivedFragment = document.createDocumentFragment();
  for (const person of archivedPeople) {
    const row = document.createElement("div");
    row.className = "manage-row";
    const name = document.createElement("span");
    name.className = "archived-name";
    name.textContent = person.name;
    const restoreButton = document.createElement("button");
    restoreButton.type = "button";
    restoreButton.className = "restore-person-button";
    restoreButton.dataset.action = "restore";
    restoreButton.dataset.personId = person.id;
    restoreButton.textContent = "Вернуть";
    row.append(name, restoreButton);
    archivedFragment.append(row);
  }
  elements.archivedList.replaceChildren(archivedFragment);
}

function scheduleOverview() {
  window.clearTimeout(overviewTimer);
  overviewGenerationToken += 1;
  const generationToken = overviewGenerationToken;
  overviewReadyRevision = -1;
  overviewFiles = [];
  updateShareButton();

  if (getOverviewPeople(state, dateWindow).length === 0) return;

  overviewTimer = window.setTimeout(async () => {
    const targetRevision = stateRevision;
    const stateSnapshot = normalizeState(state);
    const datesSnapshot = [...dateWindow];

    try {
      const files = await generateOverviewFiles(stateSnapshot, datesSnapshot);
      if (generationToken !== overviewGenerationToken || targetRevision !== stateRevision) return;
      overviewFiles = files;
      overviewReadyRevision = targetRevision;
      updateShareButton();
    } catch (error) {
      console.error("Overview generation failed", error);
      if (generationToken !== overviewGenerationToken) return;
      elements.shareButtonLabel.textContent = "Не удалось создать сводку";
      elements.shareButton.disabled = true;
    }
  }, 80);
}

function selectDate(dateKey) {
  if (!dateWindow.includes(dateKey) || dateKey === selectedDate) return;
  selectedDate = dateKey;
  clearToast();
  renderMain();
}

function handleStatusSelection(personId, status, restoreFocus = false) {
  clearToast();
  if (!setPersonStatus(state, selectedDate, personId, status)) return;
  commitState({ changedPersonId: personId });
  if (restoreFocus) {
    elements.attendanceList
      .querySelector(`button[data-person-id="${CSS.escape(personId)}"][data-status="${CSS.escape(status)}"]`)
      ?.focus({ preventScroll: true });
  }
}

function handleMarkAllPresent() {
  clearToast();
  const snapshot = setAllActivePeopleStatus(state, selectedDate, "present");
  if (!snapshot.length) return;
  commitState();
  showToast("Все отмечены как «Присутствует»", {
    actionLabel: "Отменить",
    onAction: () => {
      restoreBulkSnapshot(state, selectedDate, snapshot);
      commitState();
    }
  });
}

function handleFillDefaults() {
  const filled = fillMissingFromDefaults(state, selectedDate);
  if (!filled) return;
  commitState();
  showToast(`Заполнено по привычке: ${filled}`);
}

function showRosterDialog() {
  renderRosterEditor();
  openDialog(elements.rosterDialog);
}

function showRosterDialogForAdding() {
  showRosterDialog();
  window.setTimeout(() => elements.peopleInput.focus(), 180);
}

function handleAddPeople(event) {
  event.preventDefault();
  const rawNames = elements.peopleInput.value;
  const people = addPeople(state, rawNames, todayKey);
  if (!people.length) {
    elements.peopleInput.focus();
    return;
  }

  elements.peopleInput.value = "";
  closeDialog(elements.rosterDialog);
  commitState({ renderRoster: true });
  showToast(people.length === 1 ? "Человек добавлен" : `Добавлено людей: ${people.length}`);
}

function handleManageListChange(event) {
  const input = event.target.closest(".manage-name-input");
  if (!input) return;
  const nextName = input.value.trim();
  if (!nextName) {
    input.value = input.dataset.originalName;
    showToast("Имя не может быть пустым");
    return;
  }
  if (renamePerson(state, input.dataset.personId, nextName)) {
    input.dataset.originalName = nextName;
    commitState();
    showToast("Имя изменено");
  }
}

function handleManageListClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const personId = button.dataset.personId;

  if (button.dataset.action === "move") {
    if (movePerson(state, personId, Number(button.dataset.direction))) {
      commitState({ renderRoster: true });
      elements.manageList
        .querySelector(`button[data-action="move"][data-person-id="${CSS.escape(personId)}"][data-direction="${button.dataset.direction}"]`)
        ?.focus({ preventScroll: true });
    }
    return;
  }

  if (button.dataset.action === "archive") {
    const person = state.people.find((candidate) => candidate.id === personId);
    if (!person || !archivePerson(state, personId)) return;
    commitState({ renderRoster: true });
    showToast(`${person.name} убран из списка`, {
      actionLabel: "Вернуть",
      onAction: () => {
        restorePerson(state, personId);
        commitState({ renderRoster: true });
      }
    });
    return;
  }

  if (button.dataset.action === "restore" && restorePerson(state, personId)) {
    commitState({ renderRoster: true });
    showToast("Человек возвращён в список");
  }
}

function triggerDownload(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function handleBackup() {
  const payload = createBackupPayload(state);
  const body = JSON.stringify(payload, null, 2);
  const file = new File([body], `otmetka-backup-${todayKey}.json`, { type: "application/json" });

  try {
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
    } else {
      triggerDownload(file);
      showToast("Резервная копия сохранена");
    }
  } catch (error) {
    if (error?.name !== "AbortError") {
      triggerDownload(file);
      showToast("Резервная копия сохранена");
    }
  }
}

async function handleRestoreFile(event) {
  const [file] = event.target.files;
  event.target.value = "";
  if (!file) return;

  try {
    const payload = JSON.parse(await file.text());
    const restoredState = restoreBackupPayload(payload);
    const accepted = window.confirm("Заменить текущий список и историю данными из резервной копии?");
    if (!accepted) return;
    state = restoredState;
    todayKey = toDateKey();
    selectedDate = todayKey;
    dateWindow = getDateWindow(todayKey, HISTORY_WINDOW_DAYS);
    initializeDay(state, todayKey, { seedDefaults: true });
    commitState({ renderRoster: true });
    closeDialog(elements.rosterDialog);
    showToast("Резервная копия восстановлена");
  } catch (error) {
    console.error("Backup restore failed", error);
    showToast("Не удалось прочитать резервную копию", { duration: 6500 });
  }
}

function showOverviewFallback(message) {
  if (!overviewFiles.length) return;
  previewObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  previewObjectUrls = overviewFiles.map((file) => URL.createObjectURL(file));
  const pageFragment = document.createDocumentFragment();
  const linkFragment = document.createDocumentFragment();

  overviewFiles.forEach((file, index) => {
    const figure = document.createElement("figure");
    const image = document.createElement("img");
    image.src = previewObjectUrls[index];
    image.alt = overviewFiles.length > 1
      ? `Сводка посещаемости, страница ${index + 1} из ${overviewFiles.length}`
      : "Сводка посещаемости за 7 дней";
    figure.append(image);
    if (overviewFiles.length > 1) {
      const caption = document.createElement("figcaption");
      caption.textContent = `Страница ${index + 1} из ${overviewFiles.length}`;
      figure.append(caption);
    }
    pageFragment.append(figure);

    const link = document.createElement("a");
    link.className = "primary-button download-link";
    link.href = previewObjectUrls[index];
    link.download = file.name;
    link.textContent = overviewFiles.length > 1
      ? `Сохранить страницу ${index + 1}`
      : "Сохранить изображение";
    linkFragment.append(link);
  });

  elements.previewPages.replaceChildren(pageFragment);
  elements.downloadOverviewLinks.replaceChildren(linkFragment);
  elements.shareFallbackText.textContent = overviewFiles.length > 1
    ? `${message} Сводка разделена на ${overviewFiles.length} изображения.`
    : message;
  openDialog(elements.previewDialog);
}

async function handleShareOverview() {
  if (overviewReadyRevision !== stateRevision || !overviewFiles.length) return;
  const files = overviewFiles;

  try {
    if (navigator.share && navigator.canShare?.({ files })) {
      await navigator.share({ files });
      return;
    }
    showOverviewFallback("Это устройство не поддерживает отправку изображения напрямую.");
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.error("Native overview sharing failed", error);
    showOverviewFallback("Не получилось открыть меню «Поделиться».");
  }
}

function updateReadiness() {
  elements.readinessCard.className = "readiness-card";
  if (offlineReady) {
    elements.readinessCard.classList.add(navigator.onLine ? "is-ready" : "is-offline");
    elements.readinessText.textContent = navigator.onLine
      ? "Готово офлайн · интернет больше не нужен"
      : "Без интернета · всё работает";
    return;
  }

  if (!navigator.onLine) {
    elements.readinessCard.classList.add("is-error");
    elements.readinessText.textContent = "Подключитесь один раз, чтобы завершить установку";
    return;
  }

  elements.readinessCard.classList.add("is-working");
  elements.readinessText.textContent = "Готовим приложение для работы офлайн…";
}

function verifyServiceWorkerCache(registration) {
  return new Promise((resolve) => {
    const worker = registration.active ?? registration.waiting ?? registration.installing;
    if (!worker || typeof MessageChannel === "undefined") {
      resolve(false);
      return;
    }

    const channel = new MessageChannel();
    const timer = window.setTimeout(() => resolve(false), 6000);
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timer);
      resolve(Boolean(event.data?.ok));
    };
    worker.postMessage({ type: "VERIFY_OFFLINE_CACHE" }, [channel.port2]);
  });
}

async function initializeServiceWorker() {
  updateReadiness();
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    elements.readinessCard.className = "readiness-card is-error";
    elements.readinessText.textContent = "Офлайн-режим доступен после установки с защищённого сайта";
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    await navigator.serviceWorker.ready;
    offlineReady = await verifyServiceWorkerCache(registration);
    updateReadiness();
    if (offlineReady && isStandalone()) void requestPersistentStorage();
  } catch (error) {
    console.error("Service worker setup failed", error);
    offlineReady = false;
    elements.readinessCard.className = "readiness-card is-error";
    elements.readinessText.textContent = "Не удалось подготовить офлайн-режим. Обновите страницу с интернетом.";
  }
}

function initializeInstallExperience() {
  if (isStandalone()) {
    elements.installCard.hidden = true;
    return;
  }

  if (isIos()) {
    elements.installCard.hidden = false;
    try {
      if (!sessionStorage.getItem("attendance-install-help-seen")) {
        sessionStorage.setItem("attendance-install-help-seen", "1");
        window.setTimeout(() => openDialog(elements.installDialog), 550);
      }
    } catch {
      // The compact install card remains visible if session storage is unavailable.
    }
  }
}

function checkForNewDay() {
  const currentToday = toDateKey();
  if (currentToday === todayKey) return;
  const previousToday = todayKey;
  const wasViewingToday = selectedDate === previousToday;
  todayKey = currentToday;
  dateWindow = getDateWindow(todayKey, HISTORY_WINDOW_DAYS);
  if (wasViewingToday || !dateWindow.includes(selectedDate)) selectedDate = todayKey;
  initializeDay(state, todayKey, { seedDefaults: true });
  commitState();
  if (selectedDate === todayKey) {
    showToast("Наступил новый день · открыто сегодня", { duration: 6000 });
  } else {
    showToast("Наступил новый день", {
      actionLabel: "К сегодня",
      duration: 12000,
      onAction: () => {
        selectedDate = todayKey;
        renderMain();
      }
    });
  }
}

function bindEvents() {
  elements.manageButton.addEventListener("click", showRosterDialog);
  elements.emptyAddButton.addEventListener("click", showRosterDialogForAdding);
  elements.addInlineButton.addEventListener("click", showRosterDialogForAdding);
  elements.addPeopleForm.addEventListener("submit", handleAddPeople);
  elements.markAllPresentButton.addEventListener("click", handleMarkAllPresent);
  elements.fillDefaultsButton.addEventListener("click", handleFillDefaults);
  elements.shareButton.addEventListener("click", handleShareOverview);
  elements.todayButton.addEventListener("click", () => selectDate(todayKey));
  elements.installHelpButton.addEventListener("click", () => openDialog(elements.installDialog));

  elements.dateStrip.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-date]");
    if (button) selectDate(button.dataset.date);
  });

  elements.attendanceList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-person-id][data-status]");
    if (button) {
      const restoreFocus = document.activeElement === button || event.detail === 0;
      handleStatusSelection(button.dataset.personId, button.dataset.status, restoreFocus);
    }
  });

  elements.manageList.addEventListener("change", handleManageListChange);
  elements.manageList.addEventListener("click", handleManageListClick);
  elements.archivedList.addEventListener("click", handleManageListClick);
  elements.backupButton.addEventListener("click", handleBackup);
  elements.restoreButton.addEventListener("click", () => elements.restoreInput.click());
  elements.restoreInput.addEventListener("change", handleRestoreFile);

  elements.nativeInstallButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    elements.nativeInstallButton.hidden = true;
  });

  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => closeDialog(document.getElementById(button.dataset.closeDialog)));
  });

  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });
  });

  window.addEventListener("online", updateReadiness);
  window.addEventListener("offline", updateReadiness);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForNewDay();
  });
}

async function initializeApp() {
  state = await loadState();
  todayKey = toDateKey();
  selectedDate = todayKey;
  dateWindow = getDateWindow(todayKey, HISTORY_WINDOW_DAYS);
  const initializedToday = initializeDay(state, todayKey, { seedDefaults: true });
  if (initializedToday) await saveState(state).catch(reportStorageError);
  renderMain();
  renderRosterEditor();
  scheduleOverview();
  bindEvents();
  initializeInstallExperience();
  void initializeServiceWorker();
  window.setInterval(checkForNewDay, 60_000);
}

void initializeApp();
