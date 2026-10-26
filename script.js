// HU05: conectar la API del Banco Mundial para traer datos reales
// (antes usábamos data/countries.json como mock, HU04, para no depender
// de la API mientras se armaba el resto)

const WORLD_BANK_BASE = "/api/worldbank/country";

// Los 3 indicadores que pide HU03, con su código real en la API del Banco Mundial
const INDICATORS = [
  {
    code: "FI.RES.TOTL.CD",
    label: "Reservas internacionales (USD)",
    format: (v) => `US$ ${new Intl.NumberFormat("es-AR").format(Math.round(v))}`,
  },
  {
    code: "FP.CPI.TOTL.ZG",
    label: "Inflación anual (%)",
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    code: "SP.POP.TOTL",
    label: "Población",
    format: (v) => new Intl.NumberFormat("es-AR").format(Math.round(v)),
  },
];

// MIDP-21 / MIDP-22: "datos profundos" que solo se ven con sesión
// iniciada (login real con Firebase, en auth.js).
const ADVANCED_INDICATORS = [
  {
    code: "NY.GDP.MKTP.CD",
    label: "PBI total (USD)",
    format: (v) => `US$ ${new Intl.NumberFormat("es-AR").format(Math.round(v))}`,
  },
  {
    code: "SL.UEM.TOTL.ZS",
    label: "Desempleo (%)",
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    code: "SP.DYN.LE00.IN",
    label: "Esperanza de vida (años)",
    format: (v) => `${v.toFixed(1)} años`,
  },
  {
    code: "SE.ADT.LITR.ZS",
    label: "Tasa de alfabetización (%)",
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    code: "SH.XPD.CHEX.GD.ZS",
    label: "Gasto en salud (% del PBI)",
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    code: "AG.SRF.TOTL.K2",
    label: "Superficie (km²)",
    format: (v) => `${new Intl.NumberFormat("es-AR").format(Math.round(v))} km²`,
  },
  {
    code: "EN.POP.DNST",
    label: "Densidad poblacional (hab/km²)",
    format: (v) => `${v.toFixed(1)} hab/km²`,
  },
];

let activePath = null;
let datosRespaldo = null; // countries.json (HU04), se usa solo si falla la API real
let selectedIndicatorCode = null;
let countryRequestId = 0;
let choroplethRequestId = 0;

// MIDP-21/22: el panel de datos avanzados va del lado izquierdo, debajo
// del mapa. En vez de agregarlo a mano en index.html, lo creamos acá con
// JavaScript la primera vez que hace falta (insertAdjacentElement, "insert
// adjacent element", pronunciado "ínsert adyéisent élement", significa
// "insertar un elemento al lado de otro" que ya existe en la página).
function ensureAdvancedPanel() {
  let panel = document.getElementById("advanced-panel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "advanced-panel";
    panel.className = "advanced-panel";
    panel.innerHTML = `
      <div class="locked-msg">
        🔒 Esta app tiene datos avanzados (PBI, desempleo, esperanza de
        vida, alfabetización, gasto en salud, superficie, densidad
        poblacional) y el histórico de los últimos 10 años de cada dato,
        disponibles solo para usuarios registrados. Registrate gratis
        arriba a la derecha para acceder, y después elegí un país en el
        mapa.
      </div>`;
    const detailsPanel = document.getElementById("country-details");
    detailsPanel.insertAdjacentElement("afterend", panel);
  }
  return panel;
}

async function cargarRespaldo() {
  if (datosRespaldo) return datosRespaldo; // ya lo cargamos antes, no repetir
  try {
    const res = await fetch("data/countries.json");
    if (!res.ok) throw new Error(`HTTP ${res.status} al pedir data/countries.json`);
    datosRespaldo = await res.json();
  } catch (err) {
    console.error("No se pudo cargar el respaldo data/countries.json:", err);
    datosRespaldo = {};
  }
  return datosRespaldo;
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// La API del Banco Mundial a veces falla de forma intermitente (corta la
// respuesta sin la cabecera de CORS, o tarda demasiado bajo carga), sobre
// todo cuando le mandamos varios pedidos en paralelo. Por eso reintentamos
// automáticamente hasta 2 veces antes de darnos por vencidos, esperando
// un poco más cada vez (backoff, pronunciado "bák-of", significa "espera
// creciente entre reintentos").
//
// Versión general: pide una SERIE de valores (mrv = cuántos años pedís,
// del más nuevo al más viejo, "most recent values" — pronunciado "moust
// ricent vállius", significa "valores más recientes"). La usamos con
// mrv=1 para "el dato actual" y con mrv=10 para el histórico (MIDP-21/22).
async function fetchIndicatorSerie(
  isoCode,
  indicatorCode,
  mrv = 1,
  intentos = 2,
  aniosMaximos = null,
  countryName = null
) {
  if (aniosMaximos && !countryName) {
    throw new Error("Falta el nombre del país para consultar la serie histórica.");
  }

  for (let intento = 1; intento <= intentos; intento++) {
    try {
      const url = aniosMaximos
        ? `/api/wdi/country/${isoCode}/indicator/${indicatorCode}?country=${encodeURIComponent(countryName)}&years=${aniosMaximos}`
        : `${WORLD_BANK_BASE}/${isoCode}/indicator/${indicatorCode}?format=json&mrv=${mrv}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        let detail = "";
        try {
          detail = (await res.json()).error || "";
        } catch {
          detail = await res.text();
        }
        throw new Error(detail || `HTTP ${res.status}`);
      }

      const json = await res.json();
      // La API devuelve [metadata, datos]. Si el país no existe para la API,
      // datos puede venir undefined.
      const datos = json[1];
      if (!datos || datos.length === 0) return [];

      const returnedIndicators = datos
        .map((dato) => dato.indicator?.id)
        .filter(Boolean);
      if (returnedIndicators.some((id) => id.toUpperCase() !== indicatorCode.toUpperCase())) {
        throw new Error("La fuente devolvió datos de otra variable.");
      }

      const firstYear = aniosMaximos
        ? new Date().getFullYear() - aniosMaximos + 1
        : Number.NEGATIVE_INFINITY;
      const serie = datos
        .filter((dato) => dato.value !== null && Number(dato.date) >= firstYear)
        .map((d) => ({ valor: d.value, anio: d.date }))
        .sort((a, b) => Number(a.anio) - Number(b.anio));
      serie.source = json[0]?.source || "Banco Mundial";
      return serie;
    } catch (err) {
      const esUltimoIntento = intento === intentos;
      if (esUltimoIntento) throw err;
      await esperar(intento * 1000); // 1s antes de reintentar
    }
  }
}

// Pide UN indicador para UN país (el dato más reciente disponible).
async function fetchIndicator(isoCode, indicatorCode) {
  const serie = await fetchIndicatorSerie(isoCode, indicatorCode, 1);
  if (serie.length === 0) return null;
  return serie[0];
}

// Antes pedíamos los 3 indicadores en paralelo con Promise.all, pero eso
// manda 3 pedidos al mismo tiempo y parece disparar más seguido los
// bloqueos de la API pública bajo carga. Ahora los pedimos uno detrás
// del otro (secuencial): tarda un poquito más, pero es más confiable.
async function fetchCountryData(isoCode) {
  const resultados = [];
  for (const ind of INDICATORS) {
    const r = await fetchIndicator(isoCode, ind.code);
    resultados.push(r);
  }
  return resultados;
}

function renderLoading(name, code) {
  const panel = document.getElementById("data-panel");
  panel.innerHTML = `
    <p class="country-code">${code}</p>
    <h2 class="country-name">${name}</h2>
    <div class="no-data-msg">Cargando datos desde el Banco Mundial...</div>
  `;
  renderHistoryMessage(
    selectedIndicatorCode
      ? `${name} — ${INDICATORS.find((item) => item.code === selectedIndicatorCode).label}`
      : "Historial de la variable",
    selectedIndicatorCode ? "Cargando historial..." : "Seleccioná un indicador para ver su historial."
  );
  const avanzadoPanel = ensureAdvancedPanel();
  avanzadoPanel.innerHTML = `<div class="no-data-msg">Cargando...</div>`;
}

function renderHistoryMessage(title, message, isError = false) {
  document.getElementById("history-panel").innerHTML = `
    <h2 class="history-title">${title}</h2>
    <p class="history-message${isError ? " history-error" : ""}">${message}</p>
  `;
}

function dibujarGraficoSerie(name, indicator, serie) {
  if (!serie || serie.length === 0) {
    renderHistoryMessage(`${name} — ${indicator.label}`, "No hay datos históricos disponibles para esta variable.");
    return;
  }

  const width = 720;
  const height = 350;
  const margin = { top: 24, right: 24, bottom: 48, left: 76 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = serie.map((point) => point.valor);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const padding = (maximum - minimum || Math.abs(maximum) || 1) * 0.12;
  const domainMinimum = Math.max(0, minimum - padding);
  const domainMaximum = maximum + padding || 1;
  const valueRange = domainMaximum - domainMinimum || 1;
  const x = (index) =>
    margin.left + (serie.length === 1 ? plotWidth / 2 : (index / (serie.length - 1)) * plotWidth);
  const y = (value) => margin.top + ((domainMaximum - value) / valueRange) * plotHeight;
  const compactFormat = new Intl.NumberFormat("es-AR", {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const linePath = serie
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(point.valor)}`)
    .join(" ");
  const areaPath = `${linePath} L ${x(serie.length - 1)} ${margin.top + plotHeight} L ${x(0)} ${margin.top + plotHeight} Z`;
  const grid = Array.from({ length: 4 }, (_, index) => {
    const tickValue = domainMinimum + ((3 - index) / 3) * valueRange;
    const tickY = y(tickValue);
    return `
      <line class="chart-grid" x1="${margin.left}" y1="${tickY}" x2="${width - margin.right}" y2="${tickY}"></line>
      <text class="chart-axis-label" x="${margin.left - 10}" y="${tickY + 4}" text-anchor="end">${compactFormat.format(tickValue)}</text>`;
  }).join("");
  const points = serie.map((point, index) => `
    <circle class="chart-point" cx="${x(index)}" cy="${y(point.valor)}" r="4">
      <title>${point.anio}: ${indicator.format(point.valor)}</title>
    </circle>`).join("");
  const years = serie.map((point, index) => `
    <text class="chart-axis-label" x="${x(index)}" y="${height - 16}" text-anchor="middle">${point.anio}</text>`).join("");

  document.getElementById("history-panel").innerHTML = `
    <h2 class="history-title">${name} — ${indicator.label}</h2>
    <svg class="history-chart" viewBox="0 0 ${width} ${height}" role="img"
      aria-label="Historial de ${indicator.label} de ${name}, por año">
      <defs>
        <linearGradient id="history-area-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.48"></stop>
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.03"></stop>
        </linearGradient>
      </defs>
      ${grid}
      <path class="chart-area" d="${areaPath}"></path>
      <path class="chart-line" d="${linePath}"></path>
      ${points}
      ${years}
    </svg>
    <p class="chart-note">Hasta ${serie.length} observaciones anuales disponibles. Fuente: ${serie.source || "Banco Mundial (WDI)"}.</p>
  `;
}

function seleccionarIndicador(indicatorCode, name, historicos) {
  selectedIndicatorCode = indicatorCode;
  document.querySelectorAll(".stat-trigger").forEach((button) => {
    const isSelected = button.dataset.indicator === indicatorCode;
    button.closest(".stat").classList.toggle("selected-stat", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });

  const indicator = INDICATORS.find((item) => item.code === indicatorCode);
  if (!indicator) return;
  if (!window.usuarioLogueado) {
    renderHistoryMessage(
      `${name} — ${indicator.label}`,
      "Iniciá sesión para consultar el historial de esta variable."
    );
    return;
  }

  dibujarGraficoSerie(name, indicator, historicos?.[INDICATORS.indexOf(indicator)]);
}

// MIDP-30: el selector también colorea el mapa según el valor de cada país.
function aplicarResaltado() {
  document.querySelectorAll("#data-panel .stat").forEach((el) => {
    el.classList.toggle("stat-selected", el.dataset.code === window.caracteristicaSeleccionada);
  });
}

function colorParaValor(valor, valoresOrdenados) {
  // MIDP-11: escala lineal entre el valor mínimo (rojo) y máximo (verde).
  // No usamos la posición en el ranking: el color depende del valor real.
  if (valoresOrdenados.length === 0) return "#33505f";
  const minimo = valoresOrdenados[0];
  const maximo = valoresOrdenados[valoresOrdenados.length - 1];
  // Si todos los países tienen el mismo valor, usamos un color intermedio.
  const proporcion = maximo === minimo
    ? 0.5
    : Math.max(0, Math.min(1, (valor - minimo) / (maximo - minimo)));
  const rojo = Math.round(255 * (1 - proporcion));
  const verde = Math.round(255 * proporcion);
  const hexadecimal = (canal) => canal.toString(16).padStart(2, "0").toUpperCase();
  return `#${hexadecimal(rojo)}${hexadecimal(verde)}00`;
}

function aplicarDatosAlMapa(registros) {
  const valoresPorPais = new Map();
  for (const registro of registros) {
    const codigo = registro.country?.id?.toUpperCase();
    const valor = Number(registro.value);
    if (codigo && Number.isFinite(valor)) valoresPorPais.set(codigo, valor);
  }

  const valoresOrdenados = [...valoresPorPais.values()].sort((a, b) => a - b);
  document.querySelectorAll("#world-map .country").forEach((pais) => {
    const valor = valoresPorPais.get(pais.dataset.id.toUpperCase());
    if (valor === undefined) {
      pais.classList.remove("has-indicator-value");
      pais.style.removeProperty("--indicator-fill");
      return;
    }

    pais.classList.add("has-indicator-value");
    pais.style.setProperty("--indicator-fill", colorParaValor(valor, valoresOrdenados));
  });
}

async function colorearPaises(indicatorCode, info) {
  const requestId = ++choroplethRequestId;
  if (!indicatorCode) {
    aplicarDatosAlMapa([]);
    info.textContent = "";
    return;
  }

  const indicator = INDICATORS.find((item) => item.code === indicatorCode);
  aplicarDatosAlMapa([]);
  info.textContent = "Cargando valores por país...";
  try {
    const url = `${WORLD_BANK_BASE}/all/indicator/${indicatorCode}?format=json&mrv=1&per_page=400`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      let detail = "";
      try {
        detail = (await response.json()).error || "";
      } catch {
        detail = await response.text();
      }
      throw new Error(detail || `HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (requestId !== choroplethRequestId) return;
    if (!Array.isArray(payload) || !Array.isArray(payload[1])) {
      throw new Error("La API devolvió una respuesta de países no válida.");
    }

    const records = payload[1].filter(
      (record) => record.indicator?.id?.toUpperCase() === indicatorCode.toUpperCase()
    );
    aplicarDatosAlMapa(records);
    const cantidad = document.querySelectorAll("#world-map .country.has-indicator-value").length;
    info.textContent = cantidad
      ? `Color por ${indicator.label.toLowerCase()} en ${cantidad} países.`
      : "No hay valores disponibles para mostrar.";
  } catch (error) {
    if (requestId !== choroplethRequestId) return;
    console.error("No se pudo colorear el mapa por indicador:", error);
    aplicarDatosAlMapa([]);
    info.textContent = `No se pudieron cargar los valores de ${indicator.label.toLowerCase()}.`;
  }
}

function ensureSelector() {
  if (document.getElementById("caracteristica-select")) return;

  const barra = document.createElement("div");
  barra.className = "selector-barra";
  barra.innerHTML = `
    <label for="caracteristica-select">Característica a destacar:</label>
    <select id="caracteristica-select" class="selector-select">
      <option value="">Ninguna</option>
      ${INDICATORS.map((ind) => `<option value="${ind.code}">${ind.label}</option>`).join("")}
    </select>
    <span id="caracteristica-info" class="selector-info" aria-live="polite"></span>
    <span class="choropleth-legend" aria-label="Escala de color: menor a mayor valor">
      <span>Menor valor</span><span class="choropleth-gradient" aria-hidden="true"></span><span>Mayor valor</span>
    </span>`;
  document.querySelector(".map-panel").insertAdjacentElement("afterbegin", barra);

  const select = document.getElementById("caracteristica-select");
  const info = document.getElementById("caracteristica-info");
  select.addEventListener("change", () => {
    window.caracteristicaSeleccionada = select.value || null;
    colorearPaises(window.caracteristicaSeleccionada, info);
    aplicarResaltado();
    window.dispatchEvent(
      new CustomEvent("caracteristicachange", { detail: { code: window.caracteristicaSeleccionada } })
    );
  });
}

// MIDP-19: el usuario con sesión iniciada puede bajar el historial en datos
// crudos (sin formato, tal cual vienen de la API) como un archivo CSV
// ("CSV", pronunciado "sí-es-ví", significa "valores separados por comas":
// un archivo de texto que se abre directo en Excel).
// Usamos ";" como separador y coma decimal porque así lo espera Excel en
// español, y le agregamos "﻿" al principio para que respete las tildes.
function descargarHistorialCSV(name, code, historicos, avanzados) {
  const num = (v) => String(v).replace(".", ",");
  const filas = [["Pais", "Codigo", "Indicador", "Anio", "Valor"]];

  INDICATORS.forEach((ind, i) => {
    (historicos[i] || []).forEach((h) => {
      filas.push([name, code, ind.label, h.anio, num(h.valor)]);
    });
  });
  ADVANCED_INDICATORS.forEach((ind, i) => {
    const r = avanzados[i];
    if (r) filas.push([name, code, ind.label, r.anio, num(r.valor)]);
  });

  const csv = filas
    .map((fila) => fila.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";"))
    .join("\r\n");

  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = `historial_${code}.csv`;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
}

// MIDP-24: el usuario premium le manda directamente a los creadores la
// sugerencia de un dato nuevo. Abre el programa de mail del usuario con
// el mensaje ya escrito ("mailto:", pronunciado "méilto", significa
// "mail para": un enlace que arma un mail listo para enviar).
function enviarSugerencia(texto) {
  const mensaje = texto.trim();
  if (!mensaje) {
    alert("Escribí primero qué dato nuevo querés sugerir.");
    return;
  }
  const asunto = "Sugerencia de dato nuevo - Mapa Interactivo de Países";
  // El mail con el que el usuario se registró (lo guarda Firebase). Lo
  // ponemos en el cuerpo para que los creadores sepan quién escribe y
  // puedan responderle, y en "cc" (copia) para que el usuario también
  // reciba una copia en su propio mail.
  const emailUsuario = auth.currentUser ? auth.currentUser.email : "";
  const cuerpo = `${mensaje}\n\nUsuario premium: ${emailUsuario}`;
  window.location.href =
    `mailto:${ADMIN_EMAIL}?cc=${encodeURIComponent(emailUsuario)}` +
    `&subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
}

// resultados: los 3 datos básicos (array paralelo a INDICATORS)
// historicos: null si no hay sesión iniciada, o array paralelo a
//   INDICATORS con la serie de hasta 10 años de cada uno
// avanzados: null si no hay sesión iniciada, o array paralelo a
//   ADVANCED_INDICATORS con el dato más reciente de cada uno
function renderCountry(name, code, resultados, historicos, avanzados) {
  const panel = document.getElementById("data-panel");

  const stats = INDICATORS.map((ind, i) => {
    const r = resultados[i];
    const valorMostrado =
      r && r.valor !== null ? `${ind.format(r.valor)} <span class="stat-year">(${r.anio})</span>` : "Sin datos disponibles";

    const serie = historicos ? historicos[i] : null;
    const historialHtml =
      serie && serie.length > 0
        ? `<details class="historial">
             <summary>Ver últimos ${serie.length} años</summary>
             <ul class="historial-list">
               ${serie.map((h) => `<li><span>${h.anio}</span><span>${ind.format(h.valor)}</span></li>`).join("")}
             </ul>
           </details>`
        : "";

    return `
      <div class="stat selectable-stat${selectedIndicatorCode === ind.code ? " selected-stat" : ""}" data-code="${ind.code}">
        <button class="stat-trigger" type="button" data-indicator="${ind.code}"
          aria-pressed="${selectedIndicatorCode === ind.code}">
          <span class="stat-label">${ind.label}</span>
          <span class="stat-value">${valorMostrado}</span>
        </button>
        ${historialHtml}
      </div>`;
  }).join("");

  panel.innerHTML = `
    <p class="country-code">${code}</p>
    <h2 class="country-name">${name}</h2>
    <div class="stat-list">${stats}</div>
  `;
  panel.querySelectorAll(".stat-trigger").forEach((button) => {
    button.addEventListener("click", () => {
      seleccionarIndicador(button.dataset.indicator, name, historicos);
    });
  });
  aplicarResaltado();
  if (selectedIndicatorCode) {
    if (window.usuarioLogueado) {
      const indicator = INDICATORS.find((item) => item.code === selectedIndicatorCode);
      dibujarGraficoSerie(name, indicator, historicos?.[INDICATORS.indexOf(indicator)]);
    } else {
      const indicator = INDICATORS.find((item) => item.code === selectedIndicatorCode);
      renderHistoryMessage(
        `${name} — ${indicator.label}`,
        "Iniciá sesión para consultar el historial de esta variable."
      );
    }
  } else {
    renderHistoryMessage("Historial de la variable", "Seleccioná reservas, inflación o población para ver su historial.");
  }

  // MIDP-21/22: los datos avanzados van en el panel de la izquierda,
  // debajo del mapa (no acá, en el panel de la derecha).
  const avanzadoPanel = ensureAdvancedPanel();
  if (avanzados) {
    const avanzadosHtml = ADVANCED_INDICATORS.map((ind, i) => {
      const r = avanzados[i];
      const valorMostrado =
        r && r.valor !== null ? `${ind.format(r.valor)} <span class="stat-year">(${r.anio})</span>` : "Sin datos disponibles";
      return `
        <div class="stat">
          <div class="stat-label">${ind.label}</div>
          <div class="stat-value">${valorMostrado}</div>
        </div>`;
    }).join("");
    // MIDP-19 y MIDP-24: hay dos tipos de usuario con sesión iniciada.
    // El "registrado" ve los datos avanzados; el "premium" (su email está
    // en PREMIUM_EMAILS, en auth.js) además puede bajar el historial en
    // CSV y mandarles a los creadores la sugerencia de un dato nuevo.
    const esPremium = window.usuarioPremium;
    const premiumHtml = esPremium
      ? `<button id="download-btn" class="retry-btn">⬇ Descargar historial (CSV)</button>
         <p class="section-label">Sugerir un dato nuevo a los creadores</p>
         <textarea id="suggest-text" rows="3"
           placeholder="Contanos qué dato te gustaría ver en el mapa..."
           style="width:100%;margin-top:8px;background:var(--bg);border:1px solid var(--panel-border);color:var(--text);font-family:var(--body);font-size:13px;padding:8px;border-radius:4px;resize:vertical;"></textarea>
         <button id="suggest-btn" class="retry-btn">✉ Enviar sugerencia</button>`
      : `<div class="locked-msg">
           ⭐ Descargar el historial en CSV y sugerir datos nuevos a los
           creadores son funciones solo para usuarios premium.
         </div>`;

    avanzadoPanel.innerHTML = `
      <p class="section-label">Datos avanzados de ${name} (usuario ${esPremium ? "premium" : "registrado"})</p>
      <div class="stat-list">${avanzadosHtml}</div>
      ${premiumHtml}`;

    if (esPremium) {
      document.getElementById("download-btn").addEventListener("click", () => {
        descargarHistorialCSV(name, code, historicos, avanzados);
      });
      document.getElementById("suggest-btn").addEventListener("click", () => {
        enviarSugerencia(document.getElementById("suggest-text").value);
      });
    }
  } else {
    avanzadoPanel.innerHTML = `
      <div class="locked-msg">
        🔒 Iniciá sesión (o registrate gratis arriba a la derecha) para
        ver PBI total, desempleo, esperanza de vida, alfabetización,
        gasto en salud, superficie, densidad poblacional y el histórico
        de los últimos 10 años de cada dato.
      </div>`;
  }
}

function renderCountryRespaldo(name, code, datos) {
  const panel = document.getElementById("data-panel");
  panel.innerHTML = `
    <p class="country-code">${code}</p>
    <h2 class="country-name">${datos.name || name}</h2>
    <div class="no-data-msg">
      La API del Banco Mundial no respondió. Mostrando datos de prueba
      (HU04) en su lugar.
    </div>
    <div class="stat-list">
      <div class="stat">
        <div class="stat-label">Reservas internacionales (USD millones)</div>
        <div class="stat-value">${new Intl.NumberFormat("es-AR").format(datos.reservas_usd_millones)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Inflación anual (%)</div>
        <div class="stat-value">${datos.inflacion_anual_pct}%</div>
      </div>
      <div class="stat">
        <div class="stat-label">Población (millones)</div>
        <div class="stat-value">${datos.poblacion_millones}</div>
      </div>
    </div>
  `;
  const avanzadoPanel = ensureAdvancedPanel();
  avanzadoPanel.innerHTML = `
    <div class="no-data-msg">
      No se pudieron pedir los datos avanzados porque la API no respondió.
    </div>`;
  renderHistoryMessage("Historial de la variable", "El historial no está disponible mientras se muestran datos de respaldo.");
}

function renderError(name, code, path) {
  const panel = document.getElementById("data-panel");
  panel.innerHTML = `
    <p class="country-code">${code}</p>
    <h2 class="country-name">${name}</h2>
    <div class="no-data-msg">
      No se pudo conectar con la API del Banco Mundial para este país
      (aun después de reintentar). Puede ser un problema pasajero del
      servidor del Banco Mundial.
    </div>
    <button id="retry-btn" class="retry-btn">Reintentar</button>
  `;
  document.getElementById("retry-btn").addEventListener("click", () => {
    onCountryClick({ currentTarget: path });
  });
  renderHistoryMessage("Historial de la variable", "No se puede mostrar el historial porque no se pudo conectar con el servidor.");
  const avanzadoPanel = ensureAdvancedPanel();
  avanzadoPanel.innerHTML = `
    <div class="no-data-msg">
      No se pudieron pedir los datos avanzados porque la API no respondió.
    </div>`;
}

async function onCountryClick(evt) {
  const path = evt.currentTarget;
  const code = path.dataset.id;
  const name = path.dataset.name || code;
  const requestId = ++countryRequestId;

  if (activePath) activePath.classList.remove("active");
  path.classList.add("active");
  activePath = path;

  renderLoading(name, code);

  try {
    const resultados = await fetchCountryData(code);
    if (requestId !== countryRequestId) return;

    // window.usuarioLogueado lo actualiza auth.js cada vez que Firebase
    // detecta que alguien inició o cerró sesión.
    let historicos = null;
    let avanzados = null;
    if (window.usuarioLogueado) {
      historicos = [];
      for (const ind of INDICATORS) {
        try {
          historicos.push(await fetchIndicatorSerie(code, ind.code, 1, 2, 10, name));
        } catch (err) {
          console.error(`No se pudo cargar el historial de ${ind.code}:`, err);
          historicos.push([]);
        }
        if (requestId !== countryRequestId) return;
      }
      avanzados = [];
      for (const ind of ADVANCED_INDICATORS) {
        avanzados.push(await fetchIndicator(code, ind.code));
        if (requestId !== countryRequestId) return;
      }
    }

    renderCountry(name, code, resultados, historicos, avanzados);
  } catch (err) {
    if (requestId !== countryRequestId) return;
    console.error(err);
    const respaldo = await cargarRespaldo();
    if (requestId !== countryRequestId) return;
    if (respaldo[code]) {
      renderCountryRespaldo(name, code, respaldo[code]);
    } else {
      renderError(name, code, path);
    }
  }
}

function wireMapEvents() {
  document.querySelectorAll(".country").forEach((path) => {
    path.addEventListener("click", onCountryClick);
  });
  ensureAdvancedPanel();
  ensureSelector();
}

document.addEventListener("DOMContentLoaded", wireMapEvents);

// Cuando alguien inicia o cierra sesión (evento disparado por auth.js),
// si ya había un país seleccionado, lo volvemos a cargar para que
// aparezcan/desaparezcan los datos avanzados sin tener que reclickear.
window.addEventListener("authchange", () => {
  if (activePath) onCountryClick({ currentTarget: activePath });
});