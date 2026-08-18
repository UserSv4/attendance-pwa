import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const browserUrl = process.env.CDP_URL ?? "http://127.0.0.1:9222";
const appUrl = process.env.APP_URL ?? "http://127.0.0.1:4173/";
const appScopePath = new URL("./", appUrl).pathname;
const artifactsDirectory = fileURLToPath(new URL("../test-artifacts/", import.meta.url));

class CdpConnection {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of [...this.listeners]) listener(message);
    });
  }

  static async open(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new CdpConnection(socket);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 20_000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  once(method, sessionId, timeout = 20_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`Waiting for ${method} timed out`));
      }, timeout);
      const listener = (message) => {
        if (message.method !== method || (sessionId && message.sessionId !== sessionId)) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve(message.params);
      };
      this.listeners.add(listener);
    });
  }

  close() {
    this.socket.close();
  }
}

const version = await fetch(new URL("/json/version", browserUrl)).then((response) => response.json());
const connection = await CdpConnection.open(version.webSocketDebuggerUrl);
const errors = [];
let targetId;

try {
  ({ targetId } = await connection.send("Target.createTarget", { url: "about:blank", hidden: true }));
  const { sessionId } = await connection.send("Target.attachToTarget", { targetId, flatten: true });
  await connection.send("Page.enable", {}, sessionId);
  await connection.send("Runtime.enable", {}, sessionId);
  await connection.send("Network.enable", {}, sessionId);
  await connection.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
    screenWidth: 390,
    screenHeight: 844
  }, sessionId);
  await connection.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, sessionId);

  connection.listeners.add((message) => {
    if (message.sessionId !== sessionId) return;
    if (message.method === "Runtime.exceptionThrown") {
      errors.push(message.params.exceptionDetails?.text ?? "Unhandled browser exception");
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      errors.push(message.params.args?.map((argument) => argument.value ?? argument.description).join(" "));
    }
  });

  const evaluate = async (expression) => {
    const response = await connection.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    }, sessionId);
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result.value;
  };

  const navigate = async (url) => {
    const result = await connection.send("Page.navigate", { url }, sessionId);
    if (result.errorText) throw new Error(`Navigation failed: ${result.errorText}`);
    const startedAt = Date.now();
    while (Date.now() - startedAt < 20_000) {
      try {
        const ready = await evaluate(`location.href.startsWith(${JSON.stringify(url)}) && document.readyState === "complete"`);
        if (ready) return;
      } catch {
        // A navigation can temporarily destroy the previous execution context.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Navigation did not finish: ${url}`);
  };

  const reload = async () => {
    await connection.send("Page.reload", { ignoreCache: true }, sessionId);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const startedAt = Date.now();
    while (Date.now() - startedAt < 20_000) {
      try {
        if (await evaluate(`document.readyState === "complete"`)) return;
      } catch {
        // A navigation can temporarily destroy the previous execution context.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Reload did not finish");
  };

  const waitFor = async (expression, timeout = 12_000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Condition timed out: ${expression}. Browser errors: ${errors.join(" | ") || "none"}`);
  };

  await navigate(appUrl);
  await evaluate(`(async () => {
    localStorage.removeItem("attendance-pwa.state.v1");
    await Promise.all(
      (await caches.keys())
        .filter((key) => key.startsWith("otmetka-attendance-pwa-"))
        .map((key) => caches.delete(key))
    );
    await Promise.all(
      (await navigator.serviceWorker.getRegistrations())
        .filter((registration) => new URL(registration.scope).pathname === ${JSON.stringify(appScopePath)})
        .map((registration) => registration.unregister())
    );
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase("attendance-pwa");
      request.onsuccess = request.onerror = request.onblocked = resolve;
    });
    return true;
  })()`);
  await reload();
  await waitFor(`document.querySelectorAll(".date-button").length === 7`);

  const initial = await evaluate(`({
    language: document.documentElement.lang,
    dates: document.querySelectorAll(".date-button").length,
    emptyVisible: !document.querySelector("#emptyState").hidden,
    manifest: document.querySelector('link[rel="manifest"]')?.href
  })`);
  if (initial.language !== "ru" || initial.dates !== 7 || !initial.emptyVisible || !initial.manifest) {
    throw new Error(`Unexpected initial UI: ${JSON.stringify(initial)}`);
  }

  await evaluate(`(() => {
    document.querySelector("#manageButton").click();
    document.querySelector("#peopleInput").value = "Анна Смирнова\\nБорис Петров\\nВиктор Соколов\\nГалина Орлова";
    document.querySelector("#addPeopleForm").requestSubmit();
    return true;
  })()`);
  await waitFor(`document.querySelectorAll(".person-card").length === 4`);
  await evaluate(`(() => {
    document.querySelectorAll(".person-card")[1].querySelector('[data-status="sick"]').click();
    document.querySelectorAll(".person-card")[2].querySelector('[data-status="drunk"]').click();
    document.querySelectorAll(".person-card")[3].querySelector('[data-status="absent"]').click();
    return true;
  })()`);
  await waitFor(`!document.querySelector("#shareButton").disabled`);
  try {
    await waitFor(`document.querySelector("#readinessText").textContent.includes("Готово офлайн")`, 20_000);
  } catch (error) {
    const offlineDiagnostics = await evaluate(`(async () => ({
      readiness: document.querySelector("#readinessText")?.textContent,
      secureContext: window.isSecureContext,
      controller: navigator.serviceWorker.controller?.scriptURL ?? null,
      registrations: (await navigator.serviceWorker.getRegistrations()).map((registration) => ({ scope: registration.scope, active: registration.active?.scriptURL ?? null })),
      caches: await Promise.all((await caches.keys()).map(async (key) => ({ key, entries: (await (await caches.open(key)).keys()).length })))
    }))()`);
    throw new Error(`${error.message}. Offline diagnostics: ${JSON.stringify(offlineDiagnostics)}`);
  }

  const marked = await evaluate(`(async () => ({
    names: [...document.querySelectorAll(".person-name")].map((item) => item.textContent),
    statuses: [...document.querySelectorAll(".person-card")].map((card) => card.dataset.status),
    shareReady: !document.querySelector("#shareButton").disabled,
    shareFilesSupported: Boolean(navigator.share && navigator.canShare?.({ files: [new File(["x"], "x.png", { type: "image/png" })] })),
    offlineAssets: await caches.open((await caches.keys()).find((key) => key.startsWith("otmetka-attendance-pwa-"))).then((cache) => cache.keys()).then((keys) => keys.length)
  }))()`);
  if (JSON.stringify(marked.statuses) !== JSON.stringify(["present", "sick", "drunk", "absent"])) {
    throw new Error(`Status marking failed: ${JSON.stringify(marked)}`);
  }
  if (!marked.shareReady || marked.offlineAssets < 15) throw new Error(`App did not become ready: ${JSON.stringify(marked)}`);

  const layout = await evaluate(`(() => {
    const statusButtons = [...document.querySelectorAll(".status-button")].map((button) => button.getBoundingClientRect());
    const shareButton = document.querySelector("#shareButton").getBoundingClientRect();
    return {
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      minimumStatusWidth: Math.min(...statusButtons.map((rect) => rect.width)),
      minimumStatusHeight: Math.min(...statusButtons.map((rect) => rect.height)),
      shareTop: shareButton.top,
      shareBottom: shareButton.bottom,
      dateButtons: document.querySelectorAll(".date-button").length,
      statusButtonsPerPerson: Math.min(...[...document.querySelectorAll(".person-card")].map((card) => card.querySelectorAll(".status-button").length))
    };
  })()`);
  if (layout.scrollWidth > layout.viewportWidth || layout.minimumStatusHeight < 44 || layout.minimumStatusWidth < 64 || layout.statusButtonsPerPerson !== 4) {
    throw new Error(`Mobile layout check failed: ${JSON.stringify(layout)}`);
  }

  await connection.send("Emulation.setDeviceMetricsOverride", {
    width: 320,
    height: 700,
    deviceScaleFactor: 2,
    mobile: true,
    screenWidth: 320,
    screenHeight: 700
  }, sessionId);
  const compactLayout = await evaluate(`(() => {
    const statusButtons = [...document.querySelectorAll(".status-button")].map((button) => button.getBoundingClientRect());
    return {
      viewportWidth: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      minimumStatusWidth: Math.min(...statusButtons.map((rect) => rect.width)),
      minimumStatusHeight: Math.min(...statusButtons.map((rect) => rect.height))
    };
  })()`);
  if (compactLayout.scrollWidth > compactLayout.viewportWidth || compactLayout.minimumStatusHeight < 44 || compactLayout.minimumStatusWidth < 56) {
    throw new Error(`Compact mobile layout check failed: ${JSON.stringify(compactLayout)}`);
  }
  await connection.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
    screenWidth: 390,
    screenHeight: 844
  }, sessionId);

  await mkdir(artifactsDirectory, { recursive: true });

  const overview = await evaluate(`(async () => {
    const { generateOverviewFiles } = await import("./src/overview.js");
    const { getDateWindow, toDateKey } = await import("./src/dates.js");
    const state = JSON.parse(localStorage.getItem("attendance-pwa.state.v1"));
    const files = await generateOverviewFiles(state, getDateWindow(toDateKey(), 7));
    const image = new Image();
    const objectUrl = URL.createObjectURL(files[0]);
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = objectUrl; });
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(files[0]);
    });
    URL.revokeObjectURL(objectUrl);
    return { name: files[0].name, type: files[0].type, size: files[0].size, width: image.naturalWidth, height: image.naturalHeight, dataUrl };
  })()`);
  await writeFile(`${artifactsDirectory}/overview.png`, Buffer.from(overview.dataUrl.split(",")[1], "base64"));
  delete overview.dataUrl;
  if (overview.type !== "image/png" || overview.width !== 1400 || overview.height < 700) {
    throw new Error(`Overview image is invalid: ${JSON.stringify(overview)}`);
  }

  await reload();
  await waitFor(`document.querySelectorAll(".person-card").length === 4`);
  const persisted = await evaluate(`({
    names: [...document.querySelectorAll(".person-name")].map((item) => item.textContent),
    statuses: [...document.querySelectorAll(".person-card")].map((card) => card.dataset.status)
  })`);
  if (JSON.stringify(persisted) !== JSON.stringify({ names: marked.names, statuses: marked.statuses })) {
    throw new Error(`Reload persistence failed: ${JSON.stringify(persisted)}`);
  }

  await evaluate(`document.querySelectorAll(".date-button")[5].click()`);
  await waitFor(`document.querySelector(".summary-chip-missing")?.textContent.includes("4")`);
  await evaluate(`document.querySelector("#fillDefaultsButton").click()`);
  const inherited = await evaluate(`[...document.querySelectorAll(".person-card")].map((card) => card.dataset.status)`);
  if (JSON.stringify(inherited) !== JSON.stringify(["present", "sick", "drunk", "absent"])) {
    throw new Error(`Sticky defaults failed: ${JSON.stringify(inherited)}`);
  }

  await connection.send("Network.emulateNetworkConditions", {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0
  }, sessionId);
  await reload();
  await waitFor(`document.querySelectorAll(".person-card").length === 4`);
  const offline = await evaluate(`({ title: document.title, people: document.querySelectorAll(".person-card").length, ready: document.querySelector("#readinessText").textContent })`);
  if (offline.people !== 4 || offline.title !== "Отметка") throw new Error(`Offline reload failed: ${JSON.stringify(offline)}`);

  await connection.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1
  }, sessionId);

  if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);
  process.stdout.write(`${JSON.stringify({ initial, marked, layout, compactLayout, overview, persisted, inherited, offline }, null, 2)}\n`);

  if (process.env.CLEANUP_AFTER === "1") {
    await evaluate(`(async () => {
      localStorage.removeItem("attendance-pwa.state.v1");
      await Promise.all(
        (await caches.keys())
          .filter((key) => key.startsWith("otmetka-attendance-pwa-"))
          .map((key) => caches.delete(key))
      );
      await Promise.all(
        (await navigator.serviceWorker.getRegistrations())
          .filter((registration) => new URL(registration.scope).pathname === ${JSON.stringify(appScopePath)})
          .map((registration) => registration.unregister())
      );
      await new Promise((resolve) => {
        const request = indexedDB.deleteDatabase("attendance-pwa");
        request.onsuccess = request.onerror = request.onblocked = resolve;
      });
      return true;
    })()`);
  }
} finally {
  if (targetId) await connection.send("Target.closeTarget", { targetId }).catch(() => undefined);
  connection.close();
}
