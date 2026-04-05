// ==UserScript==
// @name         EasySMS Browser Runtime
// @namespace    local.easysms.runtime
// @version      0.2.0
// @description  Browser-native EasySMS runtime: fetch public phone numbers, read SMS inboxes, extract OTP, and fill forms.
// @match        *://*/*
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @connect      *
// ==/UserScript==

(function () {
  "use strict";

  const STORAGE_PREFIX = "easysms.runtime.";
  const ROOT_ID = "esms-root";
  const PANEL_ID = "esms-panel";
  const MINI_BAR_ID = "esms-mini-bar";
  const MAX_HISTORY = 20;
  const DEFAULTS = {
    providerMode: "auto",
    explicitProviderKey: "freephonenum",
    selectedProvidersCsv: "freephonenum,temp_number,temporary_phone_number,receive_sms_free_cc,yunduanxin,sms24",
    countryName: "",
    countryCode: "",
    overallLimit: "8",
    pollSeconds: "5",
    timeoutSeconds: "180",
    senderContains: "",
    codeRegex: "(?:^|[^\\d])(\\d{4,8})(?!\\d)",
    newestFirst: "true",
    autoFillPhoneOnAcquire: "false",
    autoFillCodeOnRead: "false",
    forceFillNonEmpty: "false",
    highlightTargets: "false",
  };

  const COUNTRY_CODE_HINTS = [
    { names: ["united states", "usa", "美国"], code: "+1" },
    { names: ["canada", "加拿大"], code: "+1" },
    { names: ["united kingdom", "great britain", "英国"], code: "+44" },
    { names: ["finland", "芬兰"], code: "+358" },
    { names: ["netherlands", "荷兰"], code: "+31" },
    { names: ["slovenia", "斯洛文尼亚"], code: "+386" },
    { names: ["germany", "德国"], code: "+49" },
    { names: ["france", "法国"], code: "+33" },
    { names: ["sweden", "瑞典"], code: "+46" },
    { names: ["spain", "西班牙"], code: "+34" },
    { names: ["china", "中国"], code: "+86" },
    { names: ["hong kong", "香港"], code: "+852" },
    { names: ["puerto rico"], code: "+1" },
    { names: ["south africa"], code: "+27" },
  ];

  const state = {
    busy: false,
    polling: false,
    stopRequested: false,
    panelCollapsed: true,
    statusMessage: "就绪。先点右侧“号”，再点“码”。",
    statusTone: "info",
    currentNumber: null,
    availableNumbers: [],
    currentMessages: [],
    lastCode: "",
    history: [],
    providerStats: {},
    detectedTargets: {
      phone: null,
      code: [],
      kind: "single",
    },
  };

  let menuBound = false;
  let dockTimer = 0;

  function sk(key) {
    return `${STORAGE_PREFIX}${key}`;
  }

  function loadSetting(key) {
    try {
      const value = GM_getValue(sk(key), DEFAULTS[key]);
      return value === undefined ? DEFAULTS[key] : value;
    } catch {
      return DEFAULTS[key];
    }
  }

  function saveSetting(key, value) {
    GM_setValue(sk(key), value);
  }

  function loadJson(key, fallback) {
    try {
      const raw = GM_getValue(sk(key), "");
      if (!raw || typeof raw !== "string") return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    GM_setValue(sk(key), JSON.stringify(value));
  }

  function boolSetting(key) {
    return String(loadSetting(key)) === "true";
  }

  function intSetting(key, fallback) {
    const value = Number.parseInt(String(loadSetting(key) || ""), 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function currentSettings() {
    const out = {};
    Object.keys(DEFAULTS).forEach((key) => {
      out[key] = loadSetting(key);
    });
    return out;
  }

  function splitCsv(value) {
    return String(value || "")
      .split(/[\s,;\r\n]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function clipText(value, max = 180) {
    const text = normalizeText(value);
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function formatDateTime(value) {
    if (!value) return "未记录";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("zh-CN", { hour12: false });
  }

  function toArray(list) {
    return Array.from(list || []);
  }

  function textOf(node) {
    return normalizeText(node?.textContent || "");
  }

  function absoluteUrl(base, href) {
    try {
      return new URL(href, base).toString();
    } catch {
      return "";
    }
  }

  function padBase64(value) {
    const padding = (4 - (value.length % 4)) % 4;
    return value + "=".repeat(padding);
  }

  function encodeRef(payload) {
    const binary = Array.from(new TextEncoder().encode(JSON.stringify(payload)), (byte) => String.fromCharCode(byte)).join("");
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function decodeRef(value) {
    const binary = atob(padBase64(String(value || "").replace(/-/g, "+").replace(/_/g, "/")));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function inferCountryCode(countryName, phoneNumber) {
    const normalizedName = normalizeText(countryName).toLowerCase();
    const matched = COUNTRY_CODE_HINTS.find((entry) => entry.names.some((name) => normalizedName.includes(name)));
    if (matched) return matched.code;

    const phone = normalizeText(phoneNumber).replace(/\s+/g, "");
    const prefixes = ["+852", "+358", "+386", "+86", "+49", "+46", "+44", "+34", "+33", "+31", "+27", "+1"];
    return prefixes.find((prefix) => phone.startsWith(prefix)) || undefined;
  }

  function matchesCountryFilter(countryCode, countryName, filterCode, filterName) {
    const wantedCode = normalizeText(filterCode).replace(/\s+/g, "");
    const wantedName = normalizeText(filterName).toLowerCase();
    const currentCode = normalizeText(countryCode).replace(/\s+/g, "");
    const currentName = normalizeText(countryName).toLowerCase();

    if (wantedCode && currentCode && currentCode !== wantedCode) return false;
    if (wantedName && currentName && !currentName.includes(wantedName) && !wantedName.includes(currentName)) return false;
    if (wantedName && !currentName) return false;
    return true;
  }

  function dedupeNumbers(items, limit) {
    const seen = new Set();
    const output = [];
    for (const item of items) {
      const key = item.sourceUrl || item.numberId;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(item);
    }
    return output.slice(0, limit);
  }

  function setStatus(message, tone = "info") {
    state.statusMessage = String(message || "").trim() || "就绪。";
    state.statusTone = tone;
    const logger = tone === "error" ? console.error : tone === "warn" ? console.warn : console.log;
    logger("[EasySMS]", state.statusMessage);
    render();
  }

  function persistRuntime() {
    saveJson("history", state.history);
    saveJson("currentNumber", state.currentNumber);
    saveJson("providerStats", state.providerStats);
    saveSetting("panelCollapsed", state.panelCollapsed ? "true" : "false");
  }

  function restoreRuntime() {
    const storedCollapsed = GM_getValue(sk("panelCollapsed"), "");
    state.panelCollapsed = storedCollapsed === "" ? true : String(storedCollapsed) === "true";
    state.history = Array.isArray(loadJson("history", [])) ? loadJson("history", []) : [];
    state.currentNumber = loadJson("currentNumber", null);
    state.providerStats = loadJson("providerStats", {}) || {};
    if (state.currentNumber?.lastCode) {
      state.lastCode = String(state.currentNumber.lastCode || "");
    }
  }

  function providerStat(key) {
    if (!state.providerStats[key] || typeof state.providerStats[key] !== "object") {
      state.providerStats[key] = {
        failures: 0,
        cooldownUntil: 0,
        lastError: "",
        lastErrorKind: "",
        lastSuccessAt: "",
        lastFailureAt: "",
      };
    }
    return state.providerStats[key];
  }

  function classifyProviderError(error) {
    const message = normalizeText(error?.message || error);
    if (/cloudflare|challenge|captcha|verification|attention required|just a moment/i.test(message)) {
      return { kind: "challenge", cooldownMs: 15 * 60 * 1000 };
    }
    if (/timeout|network|failed|unable to load|http 5/i.test(message)) {
      return { kind: "network", cooldownMs: 5 * 60 * 1000 };
    }
    if (/empty|no available|not found|暂无|没有/i.test(message)) {
      return { kind: "empty", cooldownMs: 2 * 60 * 1000 };
    }
    return { kind: "generic", cooldownMs: 8 * 60 * 1000 };
  }

  function providerCoolingRemainingMs(key) {
    return Math.max(0, Number(providerStat(key).cooldownUntil || 0) - Date.now());
  }

  function providerIsCooling(key) {
    return providerCoolingRemainingMs(key) > 0;
  }

  function providerScore(key) {
    const stat = providerStat(key);
    let score = 120 - Number(stat.failures || 0) * 15;
    if (providerIsCooling(key)) score -= 1000;
    if (stat.lastErrorKind === "challenge") score -= 20;
    if (stat.lastErrorKind === "network") score -= 10;
    if (stat.lastErrorKind === "empty") score -= 6;
    return score;
  }

  function recordProviderSuccess(key) {
    const stat = providerStat(key);
    stat.failures = 0;
    stat.cooldownUntil = 0;
    stat.lastError = "";
    stat.lastErrorKind = "";
    stat.lastSuccessAt = new Date().toISOString();
    persistRuntime();
  }

  function recordProviderFailure(key, error) {
    const stat = providerStat(key);
    const info = classifyProviderError(error);
    stat.failures = Number(stat.failures || 0) + 1;
    stat.cooldownUntil = Date.now() + info.cooldownMs;
    stat.lastError = clipText(error?.message || error, 160);
    stat.lastErrorKind = info.kind;
    stat.lastFailureAt = new Date().toISOString();
    persistRuntime();
  }

  function requestText(url, options = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: options.method || "GET",
        url,
        headers: Object.assign({
          Accept: options.accept || "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        }, options.headers || {}),
        timeout: options.timeoutMs || 30000,
        onload(response) {
          resolve({
            status: response.status,
            text: response.responseText || "",
            finalUrl: response.finalUrl || url,
          });
        },
        onerror() {
          reject(new Error(`Network request failed for ${url}`));
        },
        ontimeout() {
          reject(new Error(`Request timed out for ${url}`));
        },
      });
    });
  }

  async function requestDocument(url, options = {}) {
    const response = await requestText(url, options);
    if (response.status < 200 || response.status >= 400) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return {
      document: new DOMParser().parseFromString(response.text, "text/html"),
      finalUrl: response.finalUrl,
      text: response.text,
    };
  }

  function buildPublicNumber(provider, fields) {
    const countryCode = fields.countryCode || inferCountryCode(fields.countryName, fields.phoneNumber);
    return {
      providerKey: provider.key,
      providerDisplayName: provider.displayName,
      numberId: encodeRef({
        providerKey: provider.key,
        sourceUrl: fields.sourceUrl,
        phoneNumber: fields.phoneNumber,
        countryName: fields.countryName || "",
        countryCode: countryCode || "",
      }),
      sourceUrl: fields.sourceUrl,
      phoneNumber: fields.phoneNumber,
      countryName: fields.countryName || "",
      countryCode: countryCode || "",
      latestActivityText: fields.latestActivityText || "",
    };
  }

  function buildInboxMessage(phoneNumber, idPart, fields) {
    return {
      id: `${phoneNumber}-${idPart}`,
      sender: fields.sender || "",
      receivedAtText: fields.receivedAtText || "",
      receivedAtIso: fields.receivedAtIso || "",
      content: fields.content || "",
      sourceUrl: fields.sourceUrl,
    };
  }

  function parseTempLikeDirectory(document, provider, listUrl, linkMatcher, filters) {
    const results = [];
    toArray(document.querySelectorAll("a[href]")).forEach((anchor) => {
      const href = anchor.getAttribute("href");
      if (!href || !linkMatcher.test(href)) return;

      const sourceUrl = absoluteUrl(listUrl, href);
      const raw = normalizeText(anchor.textContent);
      const phoneMatch = raw.match(/\+\d[\d\s]+/);
      const phoneNumber = normalizeText(phoneMatch?.[0] || "");
      if (!phoneNumber) return;

      const countryName = normalizeText(raw.replace(phoneNumber, "").replace(/Latest:.+$/i, "").replace(/Online.+$/i, ""));
      const countryCode = inferCountryCode(countryName, phoneNumber);
      if (!matchesCountryFilter(countryCode, countryName, filters.countryCode, filters.countryName)) return;

      results.push(buildPublicNumber(provider, {
        sourceUrl,
        phoneNumber,
        countryName,
        countryCode,
        latestActivityText: normalizeText(raw.replace(`${countryName} ${phoneNumber}`, "")),
      }));
    });

    return dedupeNumbers(results, filters.limit);
  }

  function parseDirectChatMessages(document, sourceUrl, phoneNumber) {
    return toArray(document.querySelectorAll(".direct-chat-msg")).map((node, index) => {
      const content = textOf(node.querySelector(".direct-chat-text"));
      if (!content) return null;
      const senderRaw = textOf(node.querySelector(".direct-chat-info .pull-right"));
      const sender = senderRaw.replace(/^From\s+/i, "") || textOf(node.querySelector(".direct-chat-name"));
      return buildInboxMessage(phoneNumber, `direct-${index}`, {
        sender,
        receivedAtText: textOf(node.querySelector(".direct-chat-timestamp")),
        content,
        sourceUrl,
      });
    }).filter(Boolean);
  }

  function parseCardMessages(document, sourceUrl, phoneNumber) {
    return toArray(document.querySelectorAll(".sms-item")).map((node, index) => {
      const content = textOf(node.querySelector(".sms-content"));
      if (!content) return null;
      return buildInboxMessage(phoneNumber, `card-${index}`, {
        sender: textOf(node.querySelector(".sender-badge")),
        receivedAtText: textOf(node.querySelector(".time-text")),
        content,
        sourceUrl,
      });
    }).filter(Boolean);
  }

  function formatDigitsAsPhone(value) {
    const digits = normalizeText(value).replace(/[^\d]/g, "");
    return digits ? `+${digits}` : "";
  }

  function humanizeSlug(value) {
    return String(value || "")
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function parseTempNumberCards(document, provider) {
    const results = [];

    toArray(document.querySelectorAll("article.number-card")).forEach((card) => {
      const href = card.querySelector("a.number-card__link")?.getAttribute("href");
      const sourceUrl = href ? absoluteUrl("https://temp-number.com/temporary-numbers", href) : "";
      const phoneNumber = formatDigitsAsPhone(textOf(card.querySelector(".number-card__number")));
      if (!sourceUrl || !phoneNumber) return;
      results.push(buildPublicNumber(provider, {
        sourceUrl,
        phoneNumber,
        countryName: textOf(card.querySelector(".number-card__country-name")),
        latestActivityText: normalizeText(`${textOf(card.querySelector(".number-card__date"))} ${textOf(card.querySelector(".number-card__msgs"))}`),
      }));
    });

    toArray(document.querySelectorAll(".country-box.number-card")).forEach((card) => {
      const link = card.querySelector("a.country-link");
      const href = link?.getAttribute("href");
      const sourceUrl = href ? absoluteUrl("https://temp-number.com/temporary-numbers", href) : "";
      const phoneNumber = formatDigitsAsPhone(textOf(link?.querySelector(".card-title")));
      if (!sourceUrl || !phoneNumber) return;
      const slug = new URL(sourceUrl).pathname.split("/").filter(Boolean)[1] || "";
      results.push(buildPublicNumber(provider, {
        sourceUrl,
        phoneNumber,
        countryName: humanizeSlug(slug),
        latestActivityText: normalizeText(`${textOf(card.querySelector(".ribbon-green"))} ${textOf(card.querySelector(".add_time-top"))}`),
      }));
    });

    return dedupeNumbers(results, Number.MAX_SAFE_INTEGER);
  }

  function parseTempNumberCountryCatalog(document) {
    return dedupeNumbers(toArray(document.querySelectorAll("a[href*='/countries/']")).map((anchor) => {
      const href = anchor.getAttribute("href");
      if (!href) return null;
      const sourceUrl = absoluteUrl("https://temp-number.com/countries", href);
      const parts = new URL(sourceUrl).pathname.split("/").filter(Boolean);
      if (parts.length !== 2 || parts[0] !== "countries") return null;
      const countryName = humanizeSlug(parts[1]);
      return {
        sourceUrl,
        countryName,
        countryCode: inferCountryCode(countryName),
      };
    }).filter(Boolean), Number.MAX_SAFE_INTEGER);
  }

  const PROVIDERS = {
    freephonenum: {
      key: "freephonenum",
      displayName: "FreePhoneNum",
      async listNumbers(filters) {
        const pages = [
          { url: "https://freephonenum.com/us", countryName: "United States", countryCode: "+1" },
          { url: "https://freephonenum.com/ca", countryName: "Canada", countryCode: "+1" },
        ];
        const results = [];

        for (const page of pages) {
          if (!matchesCountryFilter(page.countryCode, page.countryName, filters.countryCode, filters.countryName)) {
            continue;
          }

          const { document } = await requestDocument(page.url);
          toArray(document.querySelectorAll(".numbers-btn[href*='/receive-sms/']")).forEach((button) => {
            const href = button.getAttribute("href");
            const label = normalizeText(button.textContent);
            if (!href || /register to view/i.test(label)) return;

            const phoneNumber = normalizeText(button.querySelector("div")?.textContent || label);
            if (!phoneNumber) return;
            results.push(buildPublicNumber(this, {
              sourceUrl: absoluteUrl(page.url, href),
              phoneNumber,
              countryName: page.countryName,
              countryCode: page.countryCode,
              latestActivityText: textOf(button.querySelector(".sms-count")),
            }));
          });
        }

        return dedupeNumbers(results, filters.limit);
      },
      async readInbox(reference) {
        const { document } = await requestDocument(reference.sourceUrl);
        return toArray(document.querySelectorAll("table.table tbody tr")).map((row, index) => {
          const cells = toArray(row.querySelectorAll("td"));
          const content = textOf(cells[2]);
          if (!content) return null;
          return buildInboxMessage(reference.phoneNumber, index, {
            sender: textOf(cells[1]),
            receivedAtText: textOf(cells[0]),
            content,
            sourceUrl: reference.sourceUrl,
          });
        }).filter(Boolean);
      },
    },
    temporary_phone_number: {
      key: "temporary_phone_number",
      displayName: "Temporary Phone Number",
      async listNumbers(filters) {
        const { document } = await requestDocument("https://temporary-phone-number.com/US-Phone-Number/");
        return parseTempLikeDirectory(document, this, "https://temporary-phone-number.com/US-Phone-Number/", /\/[A-Za-z-]+-Phone-Number\/\d+$/i, filters);
      },
      async readInbox(reference) {
        const { document } = await requestDocument(reference.sourceUrl);
        return [
          ...parseDirectChatMessages(document, reference.sourceUrl, reference.phoneNumber),
          ...parseCardMessages(document, reference.sourceUrl, reference.phoneNumber),
        ];
      },
    },
    receive_sms_free_cc: {
      key: "receive_sms_free_cc",
      displayName: "Receive SMS Free",
      async listNumbers(filters) {
        const { document } = await requestDocument("https://receive-sms-free.cc/Free-USA-Phone-Number/");
        return parseTempLikeDirectory(document, this, "https://receive-sms-free.cc/Free-USA-Phone-Number/", /\/[A-Za-z-]+-Phone-Number\/\d+\/$/i, filters);
      },
      async readInbox(reference) {
        const { document } = await requestDocument(reference.sourceUrl);
        return [
          ...parseDirectChatMessages(document, reference.sourceUrl, reference.phoneNumber),
          ...parseCardMessages(document, reference.sourceUrl, reference.phoneNumber),
        ];
      },
    },
    temp_number: {
      key: "temp_number",
      displayName: "Temp Number",
      async listNumbers(filters) {
        const limit = filters.limit || 8;
        const output = [];
        const hasCountryFilter = Boolean(filters.countryCode || filters.countryName);

        if (hasCountryFilter) {
          const { document: countriesDoc } = await requestDocument("https://temp-number.com/countries");
          const targets = parseTempNumberCountryCatalog(countriesDoc).filter((target) =>
            matchesCountryFilter(target.countryCode, target.countryName, filters.countryCode, filters.countryName),
          );
          for (const target of targets) {
            const { document } = await requestDocument(target.sourceUrl);
            output.push(...parseTempNumberCards(document, this).filter((item) =>
              matchesCountryFilter(item.countryCode, item.countryName, filters.countryCode, filters.countryName),
            ));
            if (output.length >= limit) break;
          }
        } else {
          const { document } = await requestDocument("https://temp-number.com/temporary-numbers");
          output.push(...parseTempNumberCards(document, this));
        }

        return dedupeNumbers(output, limit);
      },
      async readInbox(reference) {
        const { document } = await requestDocument(reference.sourceUrl);
        return toArray(document.querySelectorAll(".msg-card")).map((card, index) => {
          const content = textOf(card.querySelector(".msg-body"));
          if (!content) return null;
          return buildInboxMessage(reference.phoneNumber, index, {
            sender: textOf(card.querySelector(".msg-from")).replace(/^(business|phone)\s+/i, ""),
            receivedAtText: textOf(card.querySelector(".msg-time")),
            content,
            sourceUrl: reference.sourceUrl,
          });
        }).filter(Boolean);
      },
    },
    yunduanxin: {
      key: "yunduanxin",
      displayName: "云短信",
      async listNumbers(filters) {
        const { document } = await requestDocument("https://yunduanxin.net/");
        const results = [];
        toArray(document.querySelectorAll(".number-boxes-item")).forEach((card) => {
          const href = card.querySelector("a[href*='/info/']")?.getAttribute("href");
          const phoneNumber = textOf(card.querySelector(".number-boxes-item-number"));
          const countryName = textOf(card.querySelector(".number-boxes-item-country"));
          const countryCode = inferCountryCode(countryName, phoneNumber);
          if (!href || !phoneNumber) return;
          if (!matchesCountryFilter(countryCode, countryName, filters.countryCode, filters.countryName)) return;
          results.push(buildPublicNumber(this, {
            sourceUrl: absoluteUrl("https://yunduanxin.net/", href),
            phoneNumber,
            countryName,
            countryCode,
          }));
        });
        return dedupeNumbers(results, filters.limit);
      },
      async readInbox(reference) {
        const { document } = await requestDocument(reference.sourceUrl);
        return toArray(document.querySelectorAll(".row.border-bottom.table-hover")).map((row, index) => {
          const columns = toArray(row.children);
          const content = textOf(columns[2]);
          if (!content) return null;
          return buildInboxMessage(reference.phoneNumber, index, {
            sender: textOf(columns[0]?.querySelector(".mobile_hide")),
            receivedAtText: textOf(columns[1]),
            content,
            sourceUrl: reference.sourceUrl,
          });
        }).filter(Boolean);
      },
    },
    sms24: {
      key: "sms24",
      displayName: "SMS24",
      async listNumbers(filters) {
        const { document } = await requestDocument("https://sms24.me/en/numbers");
        const results = [];
        toArray(document.querySelectorAll("a[href*='/en/numbers/']")).forEach((anchor) => {
          const href = anchor.getAttribute("href");
          const raw = normalizeText(anchor.textContent);
          const phoneNumber = normalizeText(raw.match(/\+\d[\d\s]*/)?.[0] || "");
          const countryName = normalizeText(raw.replace(phoneNumber, ""));
          const countryCode = inferCountryCode(countryName, phoneNumber);
          if (!href || !phoneNumber) return;
          if (!matchesCountryFilter(countryCode, countryName, filters.countryCode, filters.countryName)) return;
          results.push(buildPublicNumber(this, {
            sourceUrl: absoluteUrl("https://sms24.me/en", href),
            phoneNumber,
            countryName,
            countryCode,
          }));
        });
        return dedupeNumbers(results, filters.limit);
      },
      async readInbox(reference) {
        const { document } = await requestDocument(reference.sourceUrl);
        const messages = [];
        toArray(document.querySelectorAll("dt")).forEach((dt, index) => {
          const dd = dt.nextElementSibling;
          if (!dd || dd.tagName.toLowerCase() !== "dd") return;
          const content = textOf(dd.querySelector(".text-break"));
          if (!content || /messages not yet received/i.test(content)) return;
          messages.push(buildInboxMessage(reference.phoneNumber, index, {
            sender: textOf(dd.querySelector("a[title^='SMS From']")).replace(/^From:\s*/i, ""),
            receivedAtIso: dd.querySelector("[data-created]")?.getAttribute("data-created") || "",
            content,
            sourceUrl: reference.sourceUrl,
          }));
        });
        return messages;
      },
    },
  };

  function orderedProviderKeys(settings) {
    const explicit = String(settings.explicitProviderKey || "").trim();
    const selected = splitCsv(settings.selectedProvidersCsv || DEFAULTS.selectedProvidersCsv).filter((key) => PROVIDERS[key]);
    const pool = settings.providerMode === "explicit" && explicit
      ? [explicit]
      : (selected.length ? selected : Object.keys(PROVIDERS));

    return [...new Set(pool)].sort((left, right) => providerScore(right) - providerScore(left));
  }

  function currentNumberKey(item) {
    return item ? `${item.providerKey}:${item.numberId}` : "";
  }

  function upsertHistory(entry) {
    const key = currentNumberKey(entry);
    state.history = state.history.filter((item) => currentNumberKey(item) !== key);
    state.history.unshift(entry);
    state.history = state.history.slice(0, MAX_HISTORY);
    persistRuntime();
  }

  function setCurrentNumber(item, source = "available") {
    if (!item) return;
    state.currentNumber = {
      providerKey: item.providerKey,
      providerDisplayName: item.providerDisplayName || PROVIDERS[item.providerKey]?.displayName || item.providerKey,
      numberId: item.numberId,
      sourceUrl: item.sourceUrl,
      phoneNumber: item.phoneNumber,
      countryName: item.countryName || "",
      countryCode: item.countryCode || "",
      selectedAtIso: new Date().toISOString(),
      selectedFrom: source,
      messageCount: 0,
      lastCode: "",
      lastFetchedAtIso: "",
    };
    state.currentMessages = [];
    state.lastCode = "";
    upsertHistory(state.currentNumber);
    render();
  }

  function updateCurrentNumber(patch) {
    if (!state.currentNumber) return;
    state.currentNumber = Object.assign({}, state.currentNumber, patch || {});
    upsertHistory(state.currentNumber);
  }

  async function loadAvailableNumbers(options = {}) {
    if (state.busy) return null;
    state.busy = true;
    render();

    const settings = currentSettings();
    const filters = {
      countryName: String(settings.countryName || "").trim(),
      countryCode: String(settings.countryCode || "").trim(),
      limit: intSetting("overallLimit", 8),
    };

    try {
      const ordered = orderedProviderKeys(settings);
      const output = [];
      const errors = [];

      for (const key of ordered) {
        const provider = PROVIDERS[key];
        if (!provider) continue;
        if (providerIsCooling(key)) {
          const seconds = Math.ceil(providerCoolingRemainingMs(key) / 1000);
          errors.push(`${provider.displayName} 冷却中，约 ${seconds} 秒后恢复。`);
          continue;
        }

        try {
          const items = await provider.listNumbers(filters);
          recordProviderSuccess(key);
          output.push(...items);
          if (output.length >= filters.limit) break;
        } catch (error) {
          recordProviderFailure(key, error);
          errors.push(`${provider.displayName}：${error.message}`);
          if (settings.providerMode === "explicit") break;
        }
      }

      state.availableNumbers = dedupeNumbers(output, filters.limit);
      if (!state.availableNumbers.length) {
        setStatus(errors[0] || "当前没有可用手机号。", "warn");
        return null;
      }

      if (options.selectFirst !== false) {
        setCurrentNumber(state.availableNumbers[0], "fetch");
        setStatus(`已获取手机号：${state.availableNumbers[0].phoneNumber}`, "success");
        if (options.fillPhone || boolSetting("autoFillPhoneOnAcquire")) {
          await fillPhoneIntoPage(state.availableNumbers[0].phoneNumber);
        }
      } else {
        setStatus(`已获取 ${state.availableNumbers.length} 个候选手机号。`, "success");
        render();
      }

      return state.availableNumbers[0] || null;
    } finally {
      state.busy = false;
      render();
    }
  }

  function compileCodeRegex() {
    const pattern = String(loadSetting("codeRegex") || DEFAULTS.codeRegex).trim() || DEFAULTS.codeRegex;
    try {
      return new RegExp(pattern, "g");
    } catch {
      return new RegExp(DEFAULTS.codeRegex, "g");
    }
  }

  function extractCodeCandidates(text) {
    const regex = compileCodeRegex();
    const content = String(text || "");
    const found = [];
    let match;

    while ((match = regex.exec(content)) !== null) {
      const candidate = String(match[1] || match[0] || "").replace(/[^\da-zA-Z]/g, "");
      if (!candidate) continue;
      if (!found.includes(candidate)) found.push(candidate);
      if (!regex.global || found.length >= 8) break;
    }

    return found;
  }

  function sortMessages(messages) {
    const newestFirst = boolSetting("newestFirst");
    return [...messages].sort((left, right) => {
      const leftTime = Date.parse(left.receivedAtIso || left.receivedAtText || "") || 0;
      const rightTime = Date.parse(right.receivedAtIso || right.receivedAtText || "") || 0;
      return newestFirst ? (rightTime - leftTime) : (leftTime - rightTime);
    });
  }

  function selectOtpMessage(messages, current) {
    const sorted = sortMessages(messages);
    const senderNeedle = normalizeText(loadSetting("senderContains")).toLowerCase();
    const selectedAtMs = Date.parse(current?.selectedAtIso || "") || 0;
    let historicalOnly = false;

    for (const message of sorted) {
      const haystack = `${message.sender || ""}\n${message.content || ""}`.toLowerCase();
      if (senderNeedle && !haystack.includes(senderNeedle)) continue;

      const codes = extractCodeCandidates(message.content || "");
      if (!codes.length) continue;

      const messageMs = Date.parse(message.receivedAtIso || message.receivedAtText || "") || 0;
      if (selectedAtMs && messageMs && messageMs + 30000 < selectedAtMs) {
        historicalOnly = true;
        continue;
      }

      return {
        code: codes[0],
        message,
      };
    }

    return historicalOnly ? { code: "", message: null, historicalOnly: true } : null;
  }

  async function readCurrentInbox(options = {}) {
    if (!state.currentNumber) {
      setStatus("当前还没有活动手机号，请先获取一个手机号。", "warn");
      return null;
    }

    const provider = PROVIDERS[state.currentNumber.providerKey];
    if (!provider) {
      setStatus("当前号码对应的 provider 不存在。", "error");
      return null;
    }

    if (!state.polling) {
      state.busy = true;
      render();
    }

    try {
      const reference = decodeRef(state.currentNumber.numberId);
      const messages = await provider.readInbox(reference);
      recordProviderSuccess(provider.key);
      state.currentMessages = sortMessages(messages);
      updateCurrentNumber({
        lastFetchedAtIso: new Date().toISOString(),
        messageCount: state.currentMessages.length,
      });

      const selected = selectOtpMessage(state.currentMessages, state.currentNumber);
      if (selected?.code) {
        state.lastCode = selected.code;
        updateCurrentNumber({
          lastCode: selected.code,
        });
        setStatus(`已读到验证码：${selected.code}`, "success");
        if (options.fillCode || boolSetting("autoFillCodeOnRead")) {
          await fillCodeIntoPage(selected.code);
        } else {
          render();
        }
        return selected;
      }

      if (selected?.historicalOnly) {
        setStatus("当前只找到旧短信里的验证码，已忽略。", "warn");
      } else if (!options.silentNoCode) {
        setStatus("当前还没有读到验证码。", "info");
      }
      render();
      return null;
    } catch (error) {
      recordProviderFailure(provider.key, error);
      setStatus(`读取短信失败：${error.message}`, "error");
      return null;
    } finally {
      if (!state.polling) {
        state.busy = false;
      }
      render();
    }
  }

  async function pollForCode(fillCode) {
    if (state.polling) return;
    if (!state.currentNumber) {
      setStatus("当前还没有活动手机号，请先获取一个手机号。", "warn");
      return;
    }

    state.polling = true;
    state.stopRequested = false;
    render();

    const timeoutMs = intSetting("timeoutSeconds", 180) * 1000;
    const intervalMs = intSetting("pollSeconds", 5) * 1000;
    const deadline = Date.now() + timeoutMs;
    setStatus(`开始轮询：${state.currentNumber.phoneNumber}`, "info");

    try {
      while (!state.stopRequested && Date.now() < deadline) {
        const result = await readCurrentInbox({ fillCode, silentNoCode: true });
        if (result?.code) return result;
        if (state.stopRequested) break;

        const waitSeconds = Math.ceil(Math.min(intervalMs, deadline - Date.now()) / 1000);
        if (waitSeconds > 0) {
          setStatus(`未读到验证码，${waitSeconds} 秒后继续轮询。`, "info");
          await sleep(waitSeconds * 1000);
        }
      }

      if (state.stopRequested) {
        setStatus("轮询已停止。", "warn");
      } else {
        setStatus("轮询超时，未读到新的验证码。", "warn");
      }
    } finally {
      state.polling = false;
      state.stopRequested = false;
      render();
    }
  }

  function stopPolling() {
    if (!state.polling) return;
    state.stopRequested = true;
    setStatus("已请求停止轮询。", "warn");
    render();
  }

  function editableFields() {
    return toArray(document.querySelectorAll("input, textarea")).filter((node) => {
      if (!(node instanceof HTMLElement)) return false;
      if (node.closest(`#${ROOT_ID}`)) return false;
      if (!document.contains(node)) return false;
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (node.disabled || node.readOnly) return false;
      return true;
    });
  }

  function scorePhoneField(node) {
    const text = [
      node.type,
      node.name,
      node.id,
      node.placeholder,
      node.getAttribute("aria-label"),
      node.getAttribute("autocomplete"),
      node.getAttribute("inputmode"),
    ].join(" ").toLowerCase();

    let score = 0;
    if (node.type === "tel") score += 7;
    if ((node.getAttribute("autocomplete") || "").toLowerCase().includes("tel")) score += 6;
    if ((node.getAttribute("inputmode") || "").toLowerCase() === "tel") score += 3;
    ["phone", "mobile", "tel", "手机号", "手机", "电话", "联系号码"].forEach((keyword) => {
      if (text.includes(keyword)) score += 4;
    });
    if (text.includes("email")) score -= 8;
    if (text.includes("code") || text.includes("otp") || text.includes("验证码")) score -= 10;
    return score;
  }

  function scoreCodeField(node) {
    const text = [
      node.type,
      node.name,
      node.id,
      node.placeholder,
      node.getAttribute("aria-label"),
      node.getAttribute("autocomplete"),
      node.getAttribute("inputmode"),
    ].join(" ").toLowerCase();

    let score = 0;
    if ((node.getAttribute("autocomplete") || "").toLowerCase() === "one-time-code") score += 10;
    if ((node.getAttribute("inputmode") || "").toLowerCase() === "numeric") score += 4;
    ["code", "otp", "pin", "验证码", "短信码", "校验码", "动态码"].forEach((keyword) => {
      if (text.includes(keyword)) score += 5;
    });
    if (String(node.maxLength || "") === "1") score += 3;
    if (text.includes("email") || text.includes("phone")) score -= 6;
    return score;
  }

  function detectPhoneField() {
    const candidates = editableFields()
      .map((node) => ({ node, score: scorePhoneField(node) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score);
    return candidates[0]?.node || null;
  }

  function detectCodeFields() {
    const fields = editableFields();
    const bestSingle = fields
      .map((node) => ({ node, score: scoreCodeField(node) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score);

    const segmented = fields
      .filter((node) => scoreCodeField(node) > 0)
      .filter((node) => String(node.maxLength || "") === "1" || (node.getAttribute("inputmode") || "").toLowerCase() === "numeric");

    const grouped = new Map();
    segmented.forEach((node) => {
      const container = node.closest("form, [role='dialog'], section, main, div") || node.parentElement;
      if (!container) return;
      const key = `${container.tagName}:${container.className}:${container.id}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(node);
    });

    let bestGroup = [];
    grouped.forEach((nodes) => {
      if (nodes.length >= 4 && nodes.length <= 8 && nodes.length > bestGroup.length) {
        bestGroup = nodes;
      }
    });

    if (bestGroup.length >= 4) {
      return { kind: "segmented", nodes: bestGroup };
    }

    return { kind: "single", nodes: bestSingle[0] ? [bestSingle[0].node] : [] };
  }

  function clearHighlights() {
    document.querySelectorAll(".esms-highlight-phone, .esms-highlight-code").forEach((node) => {
      node.classList.remove("esms-highlight-phone", "esms-highlight-code");
    });
  }

  function applyHighlights() {
    clearHighlights();
    if (!boolSetting("highlightTargets")) return;
    if (state.detectedTargets.phone && document.contains(state.detectedTargets.phone)) {
      state.detectedTargets.phone.classList.add("esms-highlight-phone");
    }
    state.detectedTargets.code.forEach((node) => {
      if (node && document.contains(node)) {
        node.classList.add("esms-highlight-code");
      }
    });
  }

  function describeElement(node) {
    if (!node) return "未找到";
    const bits = [
      node.tagName?.toLowerCase?.() || "element",
      node.id ? `#${node.id}` : "",
      node.name ? `[name="${node.name}"]` : "",
      node.placeholder ? `placeholder="${node.placeholder}"` : "",
    ].filter(Boolean);
    return bits.join(" ");
  }

  function refreshDetectedTargets() {
    state.detectedTargets.phone = detectPhoneField();
    const code = detectCodeFields();
    state.detectedTargets.code = code.nodes;
    state.detectedTargets.kind = code.kind;
    applyHighlights();
    setStatus(`已刷新字段检测：手机号 -> ${describeElement(state.detectedTargets.phone)}；验证码 -> ${state.detectedTargets.code.length ? state.detectedTargets.code.map(describeElement).join(" / ") : "未找到"}`, "info");
  }

  function canOverwrite(node) {
    if (boolSetting("forceFillNonEmpty")) return true;
    return !String(node.value || "").trim();
  }

  function setControlValue(node, value) {
    const setter = Object.getOwnPropertyDescriptor(node.constructor.prototype, "value")?.set;
    if (setter) {
      setter.call(node, value);
    } else {
      node.value = value;
    }
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function fillPhoneIntoPage(phoneOverride) {
    const phone = String(phoneOverride || state.currentNumber?.phoneNumber || "").trim();
    if (!phone) {
      setStatus("当前没有可填入的手机号。", "warn");
      return false;
    }

    let target = state.detectedTargets.phone;
    if (!target || !document.contains(target)) {
      target = detectPhoneField();
      state.detectedTargets.phone = target;
      applyHighlights();
    }

    if (!target) {
      setStatus("当前页面没有检测到可写的手机号输入框。", "warn");
      return false;
    }
    if (!canOverwrite(target)) {
      setStatus("手机号输入框已有内容，当前未开启覆盖模式。", "warn");
      return false;
    }

    target.focus();
    setControlValue(target, phone);
    setStatus(`已填入手机号：${describeElement(target)}`, "success");
    return true;
  }

  async function fillCodeIntoPage(codeOverride) {
    const code = String(codeOverride || state.lastCode || state.currentNumber?.lastCode || "").trim();
    if (!code) {
      setStatus("当前没有可填入的验证码。", "warn");
      return false;
    }

    let targets = state.detectedTargets.code.filter((node) => document.contains(node));
    let kind = state.detectedTargets.kind;

    if (!targets.length) {
      const detected = detectCodeFields();
      targets = detected.nodes;
      kind = detected.kind;
      state.detectedTargets.code = targets;
      state.detectedTargets.kind = kind;
      applyHighlights();
    }

    if (!targets.length) {
      setStatus("当前页面没有检测到可写的验证码输入框。", "warn");
      return false;
    }

    if (kind === "segmented" && targets.length >= 4) {
      const chars = code.split("");
      let filled = 0;
      targets.forEach((node, index) => {
        if (!canOverwrite(node)) return;
        setControlValue(node, chars[index] || "");
        filled += 1;
      });
      setStatus(`已把验证码拆分填入 ${filled} 个格子。`, "success");
      return true;
    }

    const target = targets[0];
    if (!canOverwrite(target)) {
      setStatus("验证码输入框已有内容，当前未开启覆盖模式。", "warn");
      return false;
    }

    target.focus();
    setControlValue(target, code);
    setStatus(`已填入验证码：${describeElement(target)}`, "success");
    return true;
  }

  async function copyText(value) {
    const text = String(value || "").trim();
    if (!text) return false;
    try {
      if (typeof GM_setClipboard === "function") {
        GM_setClipboard(text, "text");
        return true;
      }
    } catch {}
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    return false;
  }

  function renderProviderOptions() {
    const current = String(loadSetting("explicitProviderKey") || "");
    return Object.keys(PROVIDERS).map((key) => `
      <option value="${escapeHtml(key)}"${key === current ? " selected" : ""}>${escapeHtml(PROVIDERS[key].displayName)}</option>
    `).join("");
  }

  function renderMiniBar() {
    const currentPhone = String(state.currentNumber?.phoneNumber || "").trim();
    const currentCode = String(state.lastCode || state.currentNumber?.lastCode || "").trim();

    return `
      <div id="${MINI_BAR_ID}">
        <div class="esms-side-row">
          <button type="button" class="esms-side-btn" data-action="toggle-panel" title="${state.panelCollapsed ? "展开面板" : "收起面板"}">设</button>
        </div>
        <div class="esms-side-row">
          ${currentPhone ? `<button type="button" class="esms-mini-chip" data-action="copy-phone" title="复制手机号">${escapeHtml(currentPhone)}</button>` : ""}
          <button type="button" class="esms-side-btn" data-action="acquire-fill-phone" title="获取并填手机号"${state.busy ? " disabled" : ""}>号</button>
        </div>
        <div class="esms-side-row">
          ${currentCode ? `<button type="button" class="esms-mini-chip" data-action="copy-code" title="复制验证码">${escapeHtml(currentCode)}</button>` : ""}
          <button type="button" class="esms-side-btn" data-action="${state.polling ? "stop-polling" : "poll-fill"}" title="${state.polling ? "停止轮询" : "轮询并填码"}"${state.currentNumber || state.polling ? "" : " disabled"}>${state.polling ? "停" : "码"}</button>
        </div>
      </div>
    `;
  }

  function renderSummary() {
    const current = state.currentNumber;
    return `
      <div class="esms-summary-card">
        <div class="esms-summary-top">
          <div>
            <div class="esms-card-title">当前手机号</div>
            <div class="esms-current-phone">${escapeHtml(current?.phoneNumber || "未选择")}</div>
          </div>
          <div class="esms-code-box">
            <span>验证码</span>
            <strong>${escapeHtml(state.lastCode || current?.lastCode || "暂无")}</strong>
          </div>
        </div>
        <div class="esms-current-meta">
          <span>${escapeHtml(current?.providerDisplayName || "暂无服务商")}</span>
          <span>${escapeHtml(current?.countryName || current?.countryCode || "地区未知")}</span>
          <span>短信 ${escapeHtml(String(current?.messageCount || 0))}</span>
        </div>
        <div class="esms-current-meta">
          <span>取号：${escapeHtml(formatDateTime(current?.selectedAtIso || ""))}</span>
          <span>最近读取：${escapeHtml(formatDateTime(current?.lastFetchedAtIso || ""))}</span>
        </div>
        <div class="esms-mini-actions">
          <button type="button" data-action="fill-phone"${current?.phoneNumber ? "" : " disabled"}>填手机号</button>
          <button type="button" data-action="fill-code"${state.lastCode || current?.lastCode ? "" : " disabled"}>填验证码</button>
          <button type="button" data-action="copy-phone"${current?.phoneNumber ? "" : " disabled"}>复制手机号</button>
          <button type="button" data-action="copy-code"${state.lastCode || current?.lastCode ? "" : " disabled"}>复制验证码</button>
          <button type="button" data-action="detect-targets">刷新定位</button>
        </div>
      </div>
    `;
  }

  function renderActionGrid() {
    return `
      <div class="esms-action-grid">
        <button type="button" data-action="acquire-number"${state.busy ? " disabled" : ""}>获取手机号</button>
        <button type="button" data-action="acquire-fill-phone"${state.busy ? " disabled" : ""}>获取并填手机号</button>
        <button type="button" data-action="read-once"${state.currentNumber ? "" : " disabled"}>读取一次</button>
        <button type="button" data-action="${state.polling ? "stop-polling" : "poll-fill"}"${state.currentNumber || state.polling ? "" : " disabled"}>${state.polling ? "停止轮询" : "轮询并填码"}</button>
      </div>
    `;
  }

  function renderAvailableNumbers() {
    if (!state.availableNumbers.length) {
      return `<div class="esms-empty">暂无候选号码。点击“获取手机号”开始抓取。</div>`;
    }

    const currentKey = currentNumberKey(state.currentNumber);
    return state.availableNumbers.slice(0, 6).map((item, index) => {
      const active = currentNumberKey(item) === currentKey;
      return `
        <div class="esms-list-card${active ? " is-active" : ""}">
          <div class="esms-list-main">
            <div class="esms-list-title">${escapeHtml(item.phoneNumber || "未知号码")}</div>
            <div class="esms-list-meta">
              <span>${escapeHtml(item.providerDisplayName || item.providerKey)}</span>
              <span>${escapeHtml(item.countryName || item.countryCode || "地区未知")}</span>
              <span>${escapeHtml(item.latestActivityText || "暂无活动时间")}</span>
            </div>
          </div>
          <div class="esms-list-actions">
            <button type="button" data-action="use-available" data-index="${index}">设为当前</button>
            <button type="button" data-action="read-available" data-index="${index}">读取</button>
            <button type="button" data-action="poll-available" data-index="${index}">轮询</button>
            <a href="${escapeHtml(item.sourceUrl || "#")}" target="_blank" rel="noreferrer">源站</a>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderMessages() {
    if (!state.currentMessages.length) {
      return `<div class="esms-empty">暂无短信。先选择号码，再点击“读取一次”或“轮询并填码”。</div>`;
    }

    return state.currentMessages.slice(0, 6).map((message) => {
      const codes = extractCodeCandidates(message.content || "");
      return `
        <div class="esms-message-card">
          <div class="esms-message-head">
            <strong>${escapeHtml(message.sender || "未知发送方")}</strong>
            <span>${escapeHtml(message.receivedAtText || formatDateTime(message.receivedAtIso || ""))}</span>
          </div>
          <div class="esms-message-codes">
            ${codes.length
              ? codes.map((code) => `<span class="esms-code-pill">${escapeHtml(code)}</span>`).join("")
              : `<span class="esms-code-pill is-muted">未识别到验证码</span>`}
          </div>
          <div class="esms-message-preview">${escapeHtml(clipText(message.content || "", 180))}</div>
          <div class="esms-message-foot">
            <a href="${escapeHtml(message.sourceUrl || "#")}" target="_blank" rel="noreferrer">查看源短信</a>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderHistory() {
    if (!state.history.length) {
      return `<div class="esms-empty">暂无历史记录。</div>`;
    }

    const currentKey = currentNumberKey(state.currentNumber);
    return state.history.slice(0, 6).map((item, index) => {
      const active = currentNumberKey(item) === currentKey;
      return `
        <div class="esms-list-card${active ? " is-active" : ""}">
          <div class="esms-list-main">
            <div class="esms-list-title">${escapeHtml(item.phoneNumber || "未知号码")}</div>
            <div class="esms-list-meta">
              <span>${escapeHtml(item.providerDisplayName || item.providerKey)}</span>
              <span>${escapeHtml(item.countryName || item.countryCode || "地区未知")}</span>
              <span>验证码：${escapeHtml(item.lastCode || "暂无")}</span>
              <span>${escapeHtml(formatDateTime(item.selectedAtIso || ""))}</span>
            </div>
          </div>
          <div class="esms-list-actions">
            <button type="button" data-action="use-history" data-index="${index}">设为当前</button>
            <button type="button" data-action="history-fill-phone" data-index="${index}">填手机号</button>
            <button type="button" data-action="history-read" data-index="${index}">读取</button>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderSettings() {
    const settings = currentSettings();
    return `
      <details class="esms-block">
        <summary>设置</summary>
        <div class="esms-form-grid">
          <label class="esms-field">
            <span>运行模式</span>
            <select data-setting="providerMode">
              <option value="auto"${settings.providerMode === "auto" ? " selected" : ""}>自动</option>
              <option value="explicit"${settings.providerMode === "explicit" ? " selected" : ""}>指定</option>
            </select>
          </label>
          <label class="esms-field">
            <span>指定服务商</span>
            <select data-setting="explicitProviderKey"${settings.providerMode === "explicit" ? "" : " disabled"}>
              ${renderProviderOptions()}
            </select>
          </label>
          <label class="esms-field">
            <span>国家名称</span>
            <input type="text" data-setting="countryName" value="${escapeHtml(settings.countryName || "")}" placeholder="如 United States / 香港" />
          </label>
          <label class="esms-field">
            <span>国家区号</span>
            <input type="text" data-setting="countryCode" value="${escapeHtml(settings.countryCode || "")}" placeholder="如 +1 / +44" />
          </label>
          <label class="esms-field">
            <span>候选数量</span>
            <input type="number" min="1" data-setting="overallLimit" value="${escapeHtml(settings.overallLimit || "")}" />
          </label>
          <label class="esms-field">
            <span>轮询间隔（秒）</span>
            <input type="number" min="1" data-setting="pollSeconds" value="${escapeHtml(settings.pollSeconds || "")}" />
          </label>
          <label class="esms-field">
            <span>轮询超时（秒）</span>
            <input type="number" min="1" data-setting="timeoutSeconds" value="${escapeHtml(settings.timeoutSeconds || "")}" />
          </label>
          <label class="esms-field">
            <span>发送方过滤</span>
            <input type="text" data-setting="senderContains" value="${escapeHtml(settings.senderContains || "")}" placeholder="如 Google / Telegram" />
          </label>
          <label class="esms-field esms-field-wide">
            <span>验证码正则</span>
            <input type="text" data-setting="codeRegex" value="${escapeHtml(settings.codeRegex || "")}" />
          </label>
        </div>
        <div class="esms-toggle-grid">
          <label><input type="checkbox" data-setting="newestFirst"${boolSetting("newestFirst") ? " checked" : ""} /> 优先看最新</label>
          <label><input type="checkbox" data-setting="autoFillPhoneOnAcquire"${boolSetting("autoFillPhoneOnAcquire") ? " checked" : ""} /> 获取手机号后自动填入</label>
          <label><input type="checkbox" data-setting="autoFillCodeOnRead"${boolSetting("autoFillCodeOnRead") ? " checked" : ""} /> 读到验证码后自动填入</label>
          <label><input type="checkbox" data-setting="forceFillNonEmpty"${boolSetting("forceFillNonEmpty") ? " checked" : ""} /> 允许覆盖已有内容</label>
          <label><input type="checkbox" data-setting="highlightTargets"${boolSetting("highlightTargets") ? " checked" : ""} /> 高亮检测到的输入框</label>
        </div>
      </details>
    `;
  }

  function renderPanel() {
    if (state.panelCollapsed) return "";
    return `
      <section id="${PANEL_ID}">
        <div class="esms-header">
          <div>
            <div class="esms-title">EasySMS</div>
            <div class="esms-subtitle">${escapeHtml(state.statusMessage)}</div>
          </div>
          <div class="esms-header-actions">
            <span class="esms-runtime-pill is-${escapeHtml(state.statusTone)}">${state.polling ? "轮询中" : state.busy ? "处理中" : "就绪"}</span>
            <button type="button" data-action="toggle-panel">收起</button>
          </div>
        </div>
        ${renderSummary()}
        ${renderActionGrid()}
        <details class="esms-block" open>
          <summary>候选号码</summary>
          ${renderAvailableNumbers()}
        </details>
        <details class="esms-block"${state.currentMessages.length ? " open" : ""}>
          <summary>最新短信</summary>
          ${renderMessages()}
        </details>
        ${renderSettings()}
        <details class="esms-block">
          <summary>历史</summary>
          ${renderHistory()}
        </details>
      </section>
    `;
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;

    root = document.createElement("div");
    root.id = ROOT_ID;
    root.addEventListener("click", onClick);
    root.addEventListener("change", onChange);
    document.body.appendChild(root);
    return root;
  }

  function render() {
    const root = ensureRoot();
    root.innerHTML = `${renderPanel()}${renderMiniBar()}`;
    applyHighlights();
    requestAnimationFrame(syncDockOffsets);
  }

  function onClick(event) {
    const actionNode = event.target.closest("[data-action]");
    if (!actionNode) return;
    const action = actionNode.dataset.action || "";
    const index = Number(actionNode.dataset.index);

    const run = async () => {
      switch (action) {
        case "toggle-panel":
          state.panelCollapsed = !state.panelCollapsed;
          persistRuntime();
          render();
          return;
        case "detect-targets":
          refreshDetectedTargets();
          return;
        case "acquire-number":
          await loadAvailableNumbers({ selectFirst: true, fillPhone: false });
          return;
        case "acquire-fill-phone":
          await loadAvailableNumbers({ selectFirst: true, fillPhone: true });
          return;
        case "read-once":
          await readCurrentInbox({ fillCode: false });
          return;
        case "poll-fill":
          await pollForCode(true);
          return;
        case "stop-polling":
          stopPolling();
          return;
        case "fill-phone":
          await fillPhoneIntoPage();
          return;
        case "fill-code":
          await fillCodeIntoPage();
          return;
        case "copy-phone":
          if (await copyText(state.currentNumber?.phoneNumber || "")) setStatus("已复制手机号。", "success");
          return;
        case "copy-code":
          if (await copyText(state.lastCode || state.currentNumber?.lastCode || "")) setStatus("已复制验证码。", "success");
          return;
        case "use-available":
          if (state.availableNumbers[index]) {
            setCurrentNumber(state.availableNumbers[index], "available");
            setStatus(`已切换到号码：${state.availableNumbers[index].phoneNumber}`, "success");
          }
          return;
        case "read-available":
          if (state.availableNumbers[index]) {
            setCurrentNumber(state.availableNumbers[index], "available");
            await readCurrentInbox({ fillCode: false });
          }
          return;
        case "poll-available":
          if (state.availableNumbers[index]) {
            setCurrentNumber(state.availableNumbers[index], "available");
            await pollForCode(true);
          }
          return;
        case "use-history":
          if (state.history[index]) {
            state.currentNumber = Object.assign({}, state.history[index]);
            state.lastCode = String(state.currentNumber.lastCode || "");
            render();
            setStatus(`已切换到历史号码：${state.currentNumber.phoneNumber}`, "success");
          }
          return;
        case "history-fill-phone":
          if (state.history[index]) {
            state.currentNumber = Object.assign({}, state.history[index]);
            state.lastCode = String(state.currentNumber.lastCode || "");
            await fillPhoneIntoPage(state.currentNumber.phoneNumber);
          }
          return;
        case "history-read":
          if (state.history[index]) {
            state.currentNumber = Object.assign({}, state.history[index]);
            state.lastCode = String(state.currentNumber.lastCode || "");
            await readCurrentInbox({ fillCode: false });
          }
          return;
        default:
          return;
      }
    };

    run().catch((error) => {
      setStatus(`操作失败：${error.message}`, "error");
    });
  }

  function onChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) {
      return;
    }

    const key = target.dataset.setting;
    if (!key) return;

    const value = target instanceof HTMLInputElement && target.type === "checkbox"
      ? (target.checked ? "true" : "false")
      : target.value;

    saveSetting(key, value);
    if (key === "providerMode") {
      setStatus(`已切换运行模式：${value === "explicit" ? "指定" : "自动"}`, "info");
    } else {
      setStatus("配置已保存。", "info");
    }
    render();
  }

  function syncDockOffsets() {
    const root = ensureRoot();
    const emailBar = document.getElementById("eep-mini-bar");
    let dockRight = 16;

    if (emailBar) {
      const rect = emailBar.getBoundingClientRect();
      if (rect.width > 0) {
        dockRight = Math.max(16, Math.ceil(window.innerWidth - rect.left + 10));
      }
    }

    root.style.setProperty("--esms-dock-right", `${dockRight}px`);
    root.style.setProperty("--esms-panel-right", `${dockRight + 42}px`);
  }

  function bindMenu() {
    if (menuBound || typeof GM_registerMenuCommand !== "function") return;
    menuBound = true;
    GM_registerMenuCommand("EasySMS：展开/收起面板", () => {
      state.panelCollapsed = !state.panelCollapsed;
      persistRuntime();
      render();
    });
    GM_registerMenuCommand("EasySMS：获取手机号", () => {
      loadAvailableNumbers({ selectFirst: true, fillPhone: false }).catch((error) => setStatus(error.message, "error"));
    });
    GM_registerMenuCommand("EasySMS：轮询并填码", () => {
      pollForCode(true).catch((error) => setStatus(error.message, "error"));
    });
    GM_registerMenuCommand("EasySMS：刷新输入框定位", () => refreshDetectedTargets());
  }

  function installStyles() {
    GM_addStyle(`
      #${ROOT_ID} { --esms-dock-right: 16px; --esms-panel-right: 58px; z-index: 2147483645; font-family: "IBM Plex Sans", "Segoe UI", sans-serif; color: #f6f8f3; }
      #${ROOT_ID} button, #${ROOT_ID} input, #${ROOT_ID} select, #${ROOT_ID} textarea { font: inherit; }
      #${PANEL_ID} { position: fixed; top: 16px; right: var(--esms-panel-right); width: min(400px, calc(100vw - 92px)); max-height: calc(100vh - 32px); overflow: auto; border: 1px solid rgba(255,255,255,0.1); border-radius: 22px; background: radial-gradient(circle at top left, rgba(30,129,176,0.38), transparent 40%), radial-gradient(circle at bottom right, rgba(242,146,66,0.22), transparent 35%), linear-gradient(160deg, rgba(12,18,24,0.96), rgba(18,29,36,0.95)); box-shadow: 0 16px 48px rgba(0,0,0,0.38); backdrop-filter: blur(16px); overflow-x: hidden; }
      #${ROOT_ID} button, #${ROOT_ID} select, #${ROOT_ID} input { border-radius: 12px; }
      #${ROOT_ID} button { border: 1px solid rgba(255,255,255,0.12); background: linear-gradient(135deg, rgba(31,92,119,0.96), rgba(207,122,46,0.86)); color: #fffaf2; padding: 10px 12px; cursor: pointer; transition: transform 0.16s ease, opacity 0.16s ease; }
      #${ROOT_ID} button:hover { transform: translateY(-1px); }
      #${ROOT_ID} button:disabled { cursor: not-allowed; opacity: 0.5; }
      #${ROOT_ID} .esms-header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; padding: 16px 16px 12px; border-bottom: 1px solid rgba(255,255,255,0.08); }
      #${ROOT_ID} .esms-title { font-size: 17px; font-weight: 700; }
      #${ROOT_ID} .esms-subtitle { margin-top: 4px; color: rgba(236,241,232,0.76); font-size: 12px; line-height: 1.45; }
      #${ROOT_ID} .esms-header-actions { display: flex; align-items: center; gap: 8px; }
      #${ROOT_ID} .esms-runtime-pill { padding: 6px 10px; border-radius: 999px; background: rgba(78,102,115,0.42); color: #e6f0ed; font-size: 12px; }
      #${ROOT_ID} .esms-runtime-pill.is-success { background: rgba(39,153,123,0.3); }
      #${ROOT_ID} .esms-runtime-pill.is-warn { background: rgba(197,132,51,0.3); }
      #${ROOT_ID} .esms-runtime-pill.is-error { background: rgba(182,66,66,0.3); }
      #${ROOT_ID} .esms-summary-card { margin: 14px 16px 0; padding: 14px; border-radius: 18px; background: rgba(255,255,255,0.055); border: 1px solid rgba(255,255,255,0.08); }
      #${ROOT_ID} .esms-summary-top { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: start; }
      #${ROOT_ID} .esms-card-title { font-size: 12px; color: rgba(236,241,232,0.7); margin-bottom: 6px; }
      #${ROOT_ID} .esms-current-phone { font-size: 18px; font-weight: 700; letter-spacing: 0.02em; word-break: break-word; }
      #${ROOT_ID} .esms-code-box { min-width: 88px; padding: 10px 12px; border-radius: 14px; background: rgba(6,18,24,0.42); border: 1px solid rgba(255,255,255,0.08); text-align: right; }
      #${ROOT_ID} .esms-code-box span { display: block; font-size: 11px; color: rgba(236,241,232,0.68); }
      #${ROOT_ID} .esms-code-box strong { display: block; margin-top: 6px; font-size: 18px; }
      #${ROOT_ID} .esms-current-meta, #${ROOT_ID} .esms-list-meta, #${ROOT_ID} .esms-message-head, #${ROOT_ID} .esms-message-foot { display: flex; flex-wrap: wrap; gap: 8px 10px; margin-top: 8px; font-size: 12px; color: rgba(236,241,232,0.74); }
      #${ROOT_ID} .esms-mini-actions, #${ROOT_ID} .esms-list-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
      #${ROOT_ID} .esms-action-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; padding: 14px 16px 0; }
      #${ROOT_ID} .esms-block { margin: 14px 16px 0; padding: 0; border-radius: 18px; background: rgba(255,255,255,0.045); border: 1px solid rgba(255,255,255,0.08); overflow: hidden; }
      #${ROOT_ID} .esms-block summary { cursor: pointer; padding: 12px 14px; font-weight: 700; background: rgba(255,255,255,0.03); }
      #${ROOT_ID} .esms-form-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; padding: 14px 14px 0; }
      #${ROOT_ID} .esms-field { display: flex; flex-direction: column; gap: 6px; }
      #${ROOT_ID} .esms-field-wide { grid-column: 1 / -1; }
      #${ROOT_ID} .esms-field span { font-size: 12px; color: rgba(236,241,232,0.72); }
      #${ROOT_ID} .esms-field input, #${ROOT_ID} .esms-field select { border: 1px solid rgba(255,255,255,0.1); background: rgba(3,9,14,0.36); color: #f4f7ef; padding: 10px 12px; }
      #${ROOT_ID} .esms-toggle-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; padding: 14px; font-size: 13px; }
      #${ROOT_ID} .esms-toggle-grid label { display: flex; gap: 8px; align-items: center; }
      #${ROOT_ID} .esms-list-card, #${ROOT_ID} .esms-message-card { margin: 10px 12px; padding: 12px; border-radius: 14px; background: rgba(5,12,17,0.34); border: 1px solid rgba(255,255,255,0.07); }
      #${ROOT_ID} .esms-list-card.is-active { border-color: rgba(74,187,179,0.62); box-shadow: inset 0 0 0 1px rgba(74,187,179,0.2); }
      #${ROOT_ID} .esms-list-title { font-size: 15px; font-weight: 700; }
      #${ROOT_ID} .esms-list-actions a, #${ROOT_ID} .esms-message-foot a { color: #9ad6ec; text-decoration: none; }
      #${ROOT_ID} .esms-code-pill { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px; background: rgba(255,255,255,0.08); font-size: 12px; }
      #${ROOT_ID} .esms-code-pill.is-muted { opacity: 0.7; }
      #${ROOT_ID} .esms-message-preview { margin-top: 10px; color: rgba(244,247,239,0.86); font-size: 13px; line-height: 1.5; }
      #${MINI_BAR_ID} { position: fixed; right: var(--esms-dock-right); top: 50%; transform: translateY(-50%); z-index: 2147483646; display: flex; flex-direction: column; gap: 10px; align-items: flex-end; }
      #${ROOT_ID} .esms-side-row { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
      #${ROOT_ID} .esms-side-btn { width: 32px; height: 32px; padding: 0; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; background: linear-gradient(180deg,#ffffff,#eef5ff) !important; color: #d76f33 !important; font-weight: 700; box-shadow: 0 8px 18px rgba(0,0,0,0.18); }
      #${ROOT_ID} .esms-mini-chip { max-width: 220px; border: none; border-radius: 999px; padding: 9px 12px; background: rgba(9,15,27,0.94) !important; color: #edf5ff !important; box-shadow: 0 14px 28px rgba(0,0,0,0.28); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #${ROOT_ID} .esms-empty { padding: 14px; color: rgba(236,241,232,0.7); font-size: 13px; }
      .esms-highlight-phone { outline: 2px solid rgba(77,191,180,0.95) !important; outline-offset: 2px !important; box-shadow: 0 0 0 4px rgba(77,191,180,0.18) !important; }
      .esms-highlight-code { outline: 2px solid rgba(236,164,91,0.96) !important; outline-offset: 2px !important; box-shadow: 0 0 0 4px rgba(236,164,91,0.16) !important; }
      @media (max-width: 920px) {
        #${PANEL_ID} { top: 12px; left: 12px; right: 56px; width: auto; max-height: calc(100vh - 24px); }
        #${ROOT_ID} .esms-summary-top, #${ROOT_ID} .esms-form-grid, #${ROOT_ID} .esms-toggle-grid, #${ROOT_ID} .esms-action-grid { grid-template-columns: 1fr; }
        #${MINI_BAR_ID} { right: 10px; }
      }
    `);
  }

  function startDockWatcher() {
    if (dockTimer) return;
    dockTimer = window.setInterval(syncDockOffsets, 1000);
    window.addEventListener("resize", syncDockOffsets, { passive: true });
  }

  function bootstrap() {
    if (typeof GM_xmlhttpRequest !== "function") {
      console.warn("EasySMS Browser Runtime requires GM_xmlhttpRequest.");
      return;
    }

    restoreRuntime();
    installStyles();
    ensureRoot();
    bindMenu();
    startDockWatcher();
    render();
    requestAnimationFrame(syncDockOffsets);
    refreshDetectedTargets();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
