const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT) || 3000;
const WORLD_BANK_BASE = "https://api.worldbank.org/v2";
const DBNOMICS_BASE = "https://api.db.nomics.world/v22/series/WB/WDI";
const WDI_INDICATORS = new Set([
  "FI.RES.TOTL.CD",
  "FP.CPI.TOTL.ZG",
  "SP.POP.TOTL",
  "NY.GDP.MKTP.CD",
  "SL.UEM.TOTL.ZS",
  "SP.DYN.LE00.IN",
  "SE.ADT.LITR.ZS",
  "SH.XPD.CHEX.GD.ZS",
  "AG.SRF.TOTL.K2",
  "EN.POP.DNST",
]);
const PUBLIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/script.js", ["script.js", "text/javascript; charset=utf-8"]],
  ["/auth.js", ["auth.js", "text/javascript; charset=utf-8"]],
  ["/firebase-config.js", ["firebase-config.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/data/countries.json", ["data/countries.json", "application/json; charset=utf-8"]],
]);

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

async function fetchHistorySource(url, sourceName) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const upstream = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      },
      signal: controller.signal,
    });
    if (!upstream.ok) {
      console.warn(`${sourceName} respondió HTTP ${upstream.status}.`);
      return null;
    }
    return await upstream.json();
  } catch (error) {
    console.warn(`No se pudo consultar ${sourceName}:`, error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function sendHistory(res, source, records) {
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify([{ source }, records]));
}

async function handleWdiRequest(res, requestUrl) {
  const match = requestUrl.pathname.match(
    /^\/api\/wdi\/country\/([a-z]{2,3})\/indicator\/([a-z0-9.]+)$/i
  );
  if (!match) {
    sendJson(res, 404, { error: "Ruta de consulta histórica no válida." });
    return;
  }

  const [, countryCode, rawIndicator] = match;
  const indicator = rawIndicator.toUpperCase();
  const countryName = requestUrl.searchParams.get("country");
  const years = Number(requestUrl.searchParams.get("years"));
  if (
    !WDI_INDICATORS.has(indicator) ||
    !countryName ||
    countryName.length > 100 ||
    !Number.isInteger(years) ||
    years < 1 ||
    years > 30 ||
    [...requestUrl.searchParams.keys()].some((key) => !["country", "years"].includes(key))
  ) {
    sendJson(res, 400, { error: "Parámetros de consulta histórica no válidos." });
    return;
  }

  const firstYear = new Date().getFullYear() - years + 1;
  const worldBankUrl = new URL(
    `/v2/country/${countryCode}/indicator/${indicator}`,
    WORLD_BANK_BASE
  );
  worldBankUrl.searchParams.set("format", "json");
  worldBankUrl.searchParams.set("mrv", String(years));
  const worldBankPayload = await fetchHistorySource(worldBankUrl, "Banco Mundial");
  const worldBankRecords = worldBankPayload?.[1];
  if (Array.isArray(worldBankRecords)) {
    const records = worldBankRecords
      .filter((record) =>
        record.indicator?.id?.toUpperCase() === indicator &&
        record.country?.id?.toUpperCase() === countryCode.toUpperCase() &&
        Number.isInteger(Number(record.date)) &&
        Number(record.date) >= firstYear &&
        Number.isFinite(record.value)
      )
      .map((record) => ({
        date: record.date,
        value: record.value,
        indicator: { id: indicator },
      }));
    if (records.length > 0) {
      sendHistory(res, "Banco Mundial", records);
      return;
    }
  }

  const dbnomicsUrl = new URL(DBNOMICS_BASE);
  dbnomicsUrl.searchParams.set("q", `${indicator} ${countryName}`);
  dbnomicsUrl.searchParams.set("observations", "true");
  dbnomicsUrl.searchParams.set("metadata", "false");
  dbnomicsUrl.searchParams.set("limit", "1");
  const mirrorPayload = await fetchHistorySource(dbnomicsUrl, "DBnomics");
  const document = mirrorPayload?.series?.docs?.[0];
  if (!document) {
    sendJson(res, 404, { error: `No hay historial publicado para ${countryName} y ${indicator}.` });
    return;
  }

  const seriesCountry = document.series_name?.split(" – ").pop();
  if (
    document.dimensions?.indicator !== indicator ||
    seriesCountry?.toLocaleLowerCase() !== countryName.toLocaleLowerCase()
  ) {
    sendJson(res, 502, {
      error: "La fuente histórica devolvió una serie distinta a la solicitada; no se mostrarán esos datos.",
    });
    return;
  }

  const records = document.period
    .map((date, index) => ({ date, value: document.value[index] }))
    .filter((record) => {
      const year = Number(record.date);
      return Number.isInteger(year) && year >= firstYear && Number.isFinite(record.value);
    })
    .map((record) => ({
      ...record,
      indicator: { id: indicator },
    }));

  if (records.length === 0) {
    sendJson(res, 404, { error: `No hay observaciones de los últimos ${years} años para ${countryName} y ${indicator}.` });
    return;
  }

  sendHistory(res, `WDI vía DBnomics (serie indexada ${document.indexed_at?.slice(0, 10) || "sin fecha"})`, records);
}

async function handleWorldBankRequest(req, res, requestUrl) {
  const match = requestUrl.pathname.match(
    /^\/api\/worldbank\/country\/([a-z]{2,3})\/indicator\/([a-z0-9.]+)$/i
  );
  if (!match) {
    sendJson(res, 404, { error: "Ruta de consulta al Banco Mundial no válida." });
    return;
  }
    const params = requestUrl.searchParams;
    const hasMrv = params.has("mrv");
    const hasMrnev = params.has("mrnev");
    const hasDate = params.has("date");

    const mrv = params.get("mrv");
    const mrnev = params.get("mrnev");
    const date = params.get("date");
    const perPage = params.get("per_page");
  if (
    params.get("format") !== "json" ||
    Number(hasMrv) + Number(hasMrnev) + Number(hasDate) !== 1 ||
    (hasMrv && !/^[1-9]\d?$/.test(mrv)) ||
    (hasMrnev && !/^[1-9]\d?$/.test(mrnev)) ||
    (hasDate && !/^\d{4}:\d{4}$/.test(date)) ||
    (perPage !== null &&
      (!/^\d{1,4}$/.test(perPage) ||
        Number(perPage) < 1 ||
        Number(perPage) > 1000)) ||
    [...params.keys()].some(
      (key) => !["format", "mrv", "mrnev", "date", "per_page"].includes(key)
    )
  ) {
    sendJson(res, 400, {
      error: "Parámetros de consulta al Banco Mundial no válidos.",
    });
    return;
  }

  const upstreamUrl = new URL(
    `/v2/country/${match[1]}/indicator/${match[2]}`,
    "https://api.worldbank.org"
  );
  for (const [key, value] of params) upstreamUrl.searchParams.set(key, value);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      },
      signal: controller.signal,
    });
    const body = await upstream.text();
    if (!upstream.ok) {
      console.error(`Banco Mundial respondió HTTP ${upstream.status} para ${upstreamUrl.pathname}`);
      sendJson(res, 502, {
        error: `El Banco Mundial rechazó la consulta (HTTP ${upstream.status}). Probá nuevamente más tarde.`,
      });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    });
    res.end(body);
  } catch (error) {
    const timedOut = error.name === "AbortError";
    console.error("Error consultando al Banco Mundial:", error);
    sendJson(res, 502, {
      error: timedOut
        ? "El Banco Mundial tardó demasiado en responder. Intentá nuevamente."
        : "No se pudo establecer conexión con el Banco Mundial desde el servidor.",
    });
  } finally {
    clearTimeout(timeout);
  }
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }

  if (requestUrl.pathname.startsWith("/api/worldbank/")) {
    await handleWorldBankRequest(req, res, requestUrl);
    return;
  }

  if (requestUrl.pathname.startsWith("/api/wdi/")) {
    await handleWdiRequest(res, requestUrl);
    return;
  }

  const file = PUBLIC_FILES.get(requestUrl.pathname);
  if (!file) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("No encontrado");
    return;
  }

  const [relativePath, contentType] = file;
  fs.readFile(path.join(__dirname, relativePath), (error, content) => {
    if (error) {
      console.error(`No se pudo leer ${relativePath}:`, error);
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("No se pudo leer el archivo solicitado.");
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : content);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Aplicación disponible en http://localhost:${PORT}`);
});
