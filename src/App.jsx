import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTADOR DE ALMACENAMIENTO
// ─────────────────────────────────────────────────────────────────────────────
const PERFIL_DEFAULT_ID = "default";

const localStorageAdapter = {
  load() {
    try {
      const perfiles = JSON.parse(localStorage.getItem("deuda_perfiles") || "null");
      const perfilActivo = localStorage.getItem("deuda_perfil_activo") || null;

      if (perfiles && Object.keys(perfiles).length > 0) {
        return { perfiles, perfilActivo: perfilActivo || Object.keys(perfiles)[0] };
      }

      // Migración desde versión anterior sin perfiles
      const oldItems = JSON.parse(localStorage.getItem("deuda_items") || "[]");
      const oldExtra = localStorage.getItem("deuda_extra") || "0";
      if (oldItems.length > 0) {
        return {
          perfiles: { [PERFIL_DEFAULT_ID]: { nombre: "Principal", tipo: "consumo", items: oldItems, extra: oldExtra } },
          perfilActivo: PERFIL_DEFAULT_ID,
        };
      }

      // Primera vez: sin perfiles
      return { perfiles: {}, perfilActivo: null };
    } catch {
      return { perfiles: {}, perfilActivo: null };
    }
  },

  save(perfiles, perfilActivo) {
    try {
      localStorage.setItem("deuda_perfiles", JSON.stringify(perfiles));
      localStorage.setItem("deuda_perfil_activo", perfilActivo);
    } catch (e) {
      console.warn("Error guardando en localStorage:", e);
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// HOOK PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
const ID = () => Math.random().toString(36).slice(2, 9);
const perfilVacio = (nombre, tipo = "consumo") => ({
  nombre,
  tipo,
  items: [],
  extra: "0",
  ...(tipo === "hipoteca" ? { huchaActual: "0", rentHucha: "2" } : {}),
});

function useDeudaStore(adapter = localStorageAdapter) {
  const initial = adapter.load();

  const [perfiles, setPerfiles] = useState(initial.perfiles);
  const [perfilActivo, setPerfilActivo] = useState(initial.perfilActivo);
  const [saved, setSaved] = useState(true);

  useEffect(() => {
    setSaved(false);
    const timer = setTimeout(() => {
      adapter.save(perfiles, perfilActivo);
      setSaved(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [perfiles, perfilActivo]);

  const idActivo = perfilActivo && perfilActivo in perfiles ? perfilActivo : Object.keys(perfiles)[0] || null;
  const perfil = idActivo ? perfiles[idActivo] : null;
  const items = perfil?.items || [];
  const extraGlobal = perfil?.extra || "0";
  const huchaActual = perfil?.huchaActual || "0";
  const rentHuchaGlobal = perfil?.rentHucha || "2";

  const _setItems = (fn) =>
    setPerfiles((prev) => {
      const id = idActivo;
      const p = prev[id];
      return { ...prev, [id]: { ...p, items: typeof fn === "function" ? fn(p.items) : fn } };
    });

  const _setExtra = (val) =>
    setPerfiles((prev) => {
      const id = idActivo;
      const p = prev[id];
      return { ...prev, [id]: { ...p, extra: val } };
    });

  const _setHucha = (val) =>
    setPerfiles((prev) => {
      const id = idActivo;
      const p = prev[id];
      return { ...prev, [id]: { ...p, huchaActual: val } };
    });

  const _setRentHucha = (val) =>
    setPerfiles((prev) => {
      const id = idActivo;
      const p = prev[id];
      return { ...prev, [id]: { ...p, rentHucha: val } };
    });

  // ── CRUD Perfiles ────────────────────────────────────────────────────────
  const crearPerfil = (nombre, tipo = "consumo") => {
    const id = ID();
    setPerfiles((prev) => ({ ...prev, [id]: perfilVacio(nombre, tipo) }));
    setPerfilActivo(id);
  };

  const renombrarPerfil = (id, nombre) =>
    setPerfiles((prev) => ({ ...prev, [id]: { ...prev[id], nombre } }));

  const eliminarPerfil = (id) => {
    setPerfiles((prev) => {
      const next = { ...prev };
      delete next[id];
      if (idActivo === id) {
        setTimeout(() => setPerfilActivo(Object.keys(next)[0]), 0);
      }
      return next;
    });
  };

  const seleccionarPerfil = (id) => setPerfilActivo(id);

  const duplicarPerfil = (id) => {
    const origen = perfiles[id];
    if (!origen) return;
    const nuevoId = ID();
    const copia = { ...origen, nombre: `${origen.nombre} (copia)`, items: origen.items.map(it => ({ ...it, id: ID() })) };
    setPerfiles((prev) => ({ ...prev, [nuevoId]: copia }));
    setPerfilActivo(nuevoId);
  };

  // ── CRUD Items ────────────────────────────────────────────────────────────
  const addItem = (item) => _setItems((p) => [...p, { ...item, id: ID() }]);
  const editItem = (item) => _setItems((p) => p.map((it) => (it.id === item.id ? item : it)));
  const deleteItem = (id) => _setItems((p) => p.filter((it) => it.id !== id));

  const reordenarItems = (fromIdx, toIdx) =>
    _setItems((prev) => {
      const arr = [...prev];
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return arr;
    });

  const aplicarOrden = (ordenIds) =>
    _setItems((prev) => {
      const byId = Object.fromEntries(prev.map((it) => [it.id, it]));
      return ordenIds.map((id) => byId[id]).filter(Boolean);
    });

  const setExtraGlobal = _setExtra;
  const setHuchaActual = _setHucha;
  const setRentHuchaGlobal = _setRentHucha;

  // ── Backup / Restaurar ────────────────────────────────────────────────────
  const LS_KEYS = ["deuda_perfiles", "deuda_perfil_activo", "deuda_items", "deuda_extra"];

  const exportarParaIA = (perfilesData, perfilActivoId) => {
    const fecha = new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
    const perfilesArr = Object.entries(perfilesData).map(([id, p]) => {
      const esActivo = id === perfilActivoId;
      const deudas = (p.items || []).map(it => {
        if (it.tipo === "hipoteca") {
          return `  - [HIPOTECA] ${it.nombre}: ${it.pendiente}€ pendiente, ${it.mesesRestantes} meses restantes, diferencial ${it.diferencial}% + euríbor ${it.euribor}% = TIN ${((it.diferencial||0)+(it.euribor||0)).toFixed(2)}%, cuota ${it.cuotaFija?.toFixed(2)}€/mes, mínimo amortización ${it.minimoAmortizacion}€, revisión mes ${it.mesRevision}, comisión ${it.comisionPct||0}%`;
        } else if (it.tipo === "tarjeta") {
          return `  - [TARJETA] ${it.nombre}: ${it.pendiente}€ pendiente, TIN ${it.tasaAnual}%, cuota elegida ${it.cuotaElegida}€/mes, límite ${it.limiteCredito||3200}€`;
        } else {
          return `  - [PRÉSTAMO] ${it.nombre}: ${it.pendiente}€ pendiente, TIN ${it.tasaAnual}%, cuota fija ${it.cuotaFija?.toFixed(2)}€/mes`;
        }
      }).join("\n");

      let configExtra = `  Extra mensual: ${p.extra||"0"}€/mes`;
      if (p.tipo === "hipoteca") {
        configExtra += `\n  Saldo hucha: ${p.huchaActual||"0"}€\n  Rentabilidad cuenta hucha: ${p.rentHucha||"2"}%`;
      }

      return `### Perfil: "${p.nombre}" (${p.tipo === "hipoteca" ? "Hipoteca variable" : "Consumo"})${esActivo ? " ← ACTIVO" : ""}
${configExtra}
${deudas || "  (sin deudas)"}`;
    });

    const texto = `# CONTEXTO PARA IA - Prioriza
Fecha de exportacion: ${fecha}

## QUE ES ESTA APP
Prioriza es una aplicacion web de planificacion financiera personal que funciona completamente en el navegador (sin servidor, datos solo en localStorage). Permite:
- Gestionar deudas de consumo (prestamos y tarjetas) usando las estrategias Bola de Nieve y Avalancha
- Gestionar hipotecas variables con euribor, sistema de "hucha" para amortizaciones anticipadas y revisiones periodicas de cuota
- Comparar estrategias de riqueza: amortizar anticipadamente vs invertir en fondo indexado
- Exportar informes y backups

## MOTORES DE CALCULO - LOGICA EXACTA

### 1. Cuota francesa (prestamos)
Formula: C = K * r * (1+r)^n / ((1+r)^n - 1)
Donde K = capital, r = TIN/12/100, n = meses
Cada mes: intereses = saldo * r, amortizacion = cuota - intereses, saldo -= amortizacion

### 2. Tarjetas de credito
El minimo del banco se calcula cada mes sobre el saldo real actualizado:
  minimoBase = max(saldo * 0.03 + interesesMes, 25)
  si saldo > limiteCredito: minimoBase += 9 (comision exceso)
  cuotaEfectiva = max(cuotaElegidaPorUsuario, minimoBase)
La simulacion recorre MES A MES con saldo actualizado. Cuando el saldo baja
lo suficiente, el minimo del banco cae por debajo de la cuota elegida y se
usa la cuota elegida automaticamente. El umbral aproximado es:
  saldoUmbral = cuotaElegida / (TIN/100/12)
Por ejemplo con TIN 12% y cuota 25: umbral = 25 / 0.01 = 2500 euros.
Por encima de 2500 euros de saldo manda el banco, por debajo manda el usuario.

### 3. Bola de nieve / Avalancha
Cada mes, para cada deuda:
  1. Calcular intereses del mes (saldo * TIN/12/100)
  2. Calcular cuota base (minimo banco si tarjeta, cuota fija si prestamo)
  3. Restar cuota base al saldo
  4. Si es la deuda objetivo: aplicar ademas el extra disponible
Cuando una deuda llega a 0: su cuota base real se suma al extra disponible
(efecto bola de nieve). El orden objetivo es configurable por el usuario.

### 4. Hipoteca variable con hucha
Cada mes:
  1. Calcular interes: capital * (diferencial + euribor) / 100 / 12
  2. Calcular cuota: sistema frances con capital y meses restantes actuales
  3. Si mes de revision (cada 12 meses desde mesRevision): recalcular cuota
  4. Acumular hucha: hucha = hucha * (1 + rentHucha/100/12) + extraMensual
  5. Si hucha >= minimoAmortizacion: amortizar (reducir plazo, no cuota)
     amortExtra = floor(hucha / minimo) * minimo
     si hay comision: coste = amortExtra * comisionPct/100
     capital -= amortExtra, hucha -= amortExtra

### 5. Estrategia de riqueza (A vs B)
Estrategia A: acumula en hucha -> amortiza capital -> al liquidar invierte cuota liberada + extra
Estrategia B: invierte el extra directamente en fondo indexado desde mes 1, paga solo cuota minima
Al final del plazo original:
  A_neto = fondoA * (1 - impuesto/100 sobre plusvalias) 
  B_neto = fondoB * (1 - impuesto/100 sobre plusvalias) - capitalPendienteHipoteca
Plusvalia = cartera final - total aportado (el impuesto NO se aplica sobre todo el capital)
Comision fondo: rentabilidadNeta = rentabilidadBruta - comisionAnual (se descuenta mensualmente)

## DATOS ACTUALES DEL USUARIO
${perfilesArr.join("\n\n")}

## COMO USAR ESTE CONTEXTO
Con este contexto puedes preguntarme:
- Si los calculos de tu caso concreto tienen sentido
- Como interpretar los resultados que ves en pantalla
- Cuanto tardas en liquidar cada deuda y cuanto pagas de intereses
- Si conviene mas amortizar o invertir con tus datos reales
- Como funciona exactamente cualquier calculo de la app
- Como mejorar o anadir funcionalidades (adjunta tambien App.jsx para esto)
`;

    // UTF-8 BOM para que Windows y otros programas lean bien los caracteres
    const BOM = "\uFEFF";
    const blob = new Blob([BOM + texto], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `prioriza-contexto-ia-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportarBackup = () => {
    const datos = {};
    for (const key of LS_KEYS) {
      const val = localStorage.getItem(key);
      if (val !== null) datos[key] = val;
    }
    const payload = { version: 2, fecha: new Date().toISOString(), datos };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bola-de-nieve-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const restaurarBackup = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const payload = JSON.parse(e.target.result);
          if (!payload.datos) throw new Error("Formato de backup no reconocido");
          for (const [key, val] of Object.entries(payload.datos)) {
            localStorage.setItem(key, val);
          }
          const restored = adapter.load();
          setPerfiles(restored.perfiles);
          setPerfilActivo(restored.perfilActivo);
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error("Error leyendo el archivo"));
      reader.readAsText(file);
    });

  return {
    perfiles,
    perfilActivo: idActivo,
    perfil,
    items,
    extraGlobal,
    huchaActual,
    rentHuchaGlobal,
    saved,
    crearPerfil,
    renombrarPerfil,
    eliminarPerfil,
    seleccionarPerfil,
    duplicarPerfil,
    addItem,
    editItem,
    deleteItem,
    reordenarItems,
    aplicarOrden,
    setExtraGlobal,
    setHuchaActual,
    setRentHuchaGlobal,
    exportarBackup,
    restaurarBackup,
    exportarParaIA: () => exportarParaIA(perfiles, idActivo),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const _fmtCache = {};
const fmt = (n, d = 2) => {
  if (!_fmtCache[d]) _fmtCache[d] = new Intl.NumberFormat("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
  return _fmtCache[d].format(n ?? 0);
};
const fmtM = (n) => `${fmt(n, 0)} mes${n === 1 ? "" : "es"}`;
const fmtDate = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const monthsBetween = (isoA, isoB) => {
  const a = new Date(isoA + "-01");
  const b = new Date(isoB + "-01");
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
};
const addMonthsToRef = (fechaRefISO, meses) => {
  if (!fechaRefISO || !meses) return "—";
  const [y, m] = fechaRefISO.split("-").map(Number);
  const d = new Date(y, m - 1 + meses, 1);
  return d.toLocaleDateString("es-ES", { month: "short", year: "numeric" });
};
const addMonths = (meses) => {
  const d = new Date();
  d.setMonth(d.getMonth() + meses);
  return d.toLocaleDateString("es-ES", { month: "short", year: "numeric" });
};

// ─────────────────────────────────────────────────────────────────────────────
// MOTORES FINANCIEROS — CONSUMO
// ─────────────────────────────────────────────────────────────────────────────
function cuotaFrancesa(capital, tasaAnual, plazoMeses) {
  if (plazoMeses <= 0 || capital <= 0) return 0;
  const r = tasaAnual / 100 / 12;
  if (r === 0) return capital / plazoMeses;
  return (capital * r * Math.pow(1 + r, plazoMeses)) / (Math.pow(1 + r, plazoMeses) - 1);
}

function avanzarAmortizacion(saldoPendiente, cuotaFija, tasaAnual, meses) {
  let saldo = saldoPendiente;
  const r = tasaAnual / 100 / 12;
  for (let i = 0; i < meses; i++) {
    if (saldo <= 0) break;
    const intereses = saldo * r;
    const amortizacion = Math.min(cuotaFija - intereses, saldo);
    saldo = Math.max(0, saldo - amortizacion);
  }
  return saldo;
}

function cuotaMinimaTargeta(saldo, tasaAnual, limiteComision = 3200) {
  const r = tasaAnual / 100 / 12;
  const intereses = saldo * r;
  const pct = saldo * 0.03;
  const comision = saldo > limiteComision ? 9 : 0;
  return Math.max(25, pct + intereses + comision);
}

function simularBolaDeNieve(items, extraBase) {
  const MAX = 600;
  const estados = items.map((it) => ({
    ...it,
    saldo: it.pendiente,
    terminado: false,
    mesTerminado: null,
    interesesPagados: 0,
  }));

  let extraDisponible = extraBase;
  let mes = 0;

  while (mes < MAX && !estados.every((e) => e.terminado)) {
    const objIdx = estados.findIndex((e) => !e.terminado);

    for (let i = 0; i < estados.length; i++) {
      const est = estados[i];
      if (est.terminado) continue;

      const r = est.tasaAnual / 100 / 12;
      const intMes = est.saldo * r;
      est.interesesPagados += intMes;

      let cuotaBase;
      if (est.tipo === "tarjeta") {
        const minBanco = cuotaMinimaTargeta(est.saldo, est.tasaAnual, est.limiteCredito ?? 3200);
        cuotaBase = Math.max(est.cuotaElegida || 25, minBanco);
      } else {
        cuotaBase = est.cuotaFija;
      }

      const capCuota = Math.min(cuotaBase - intMes, est.saldo);
      est.saldo = Math.max(0, est.saldo - capCuota);

      if (i === objIdx && extraDisponible > 0 && est.saldo > 0) {
        const amort = Math.min(extraDisponible, est.saldo);
        const comision = amort * ((est.comisionPct || 0) / 100);
        est.interesesPagados += comision;
        est.saldo = Math.max(0, est.saldo - amort);
      }

      if (est.saldo <= 0.005) {
        est.saldo = 0;
        est.terminado = true;
        est.mesTerminado = mes + 1;
        // Reciclar la cuota real que se pagaba (intereses + amortización de ese último mes)
        extraDisponible += cuotaBase;
      }
    }
    mes++;
  }

  const plazoGlobal = Math.max(...estados.map((e) => e.mesTerminado || MAX));
  const interesesTotales = estados.reduce((s, e) => s + e.interesesPagados, 0);
  const mesLiquidez = Math.min(...estados.map((e) => e.mesTerminado || MAX));

  const resultadosPorId = {};
  for (const est of estados) {
    resultadosPorId[est.id] = {
      mesesCon: est.mesTerminado || MAX,
      interesesCon: est.interesesPagados,
    };
  }

  return { plazoGlobal, interesesTotales, mesLiquidez, resultadosPorId };
}

function simularSinExtra(item, maxMeses = 600) {
  if (item.tipo === "tarjeta") {
    let s = item.pendiente;
    const r = item.tasaAnual / 100 / 12;
    let meses = 0, intereses = 0;
    while (s > 0.005 && meses < maxMeses) {
      const intMes = s * r;
      const minBanco = cuotaMinimaTargeta(s, item.tasaAnual, item.limiteCredito ?? 3200);
      const cuota = Math.max(item.cuotaElegida || 25, minBanco);
      intereses += intMes;
      s = Math.max(0, s + intMes - cuota);
      meses++;
    }
    return { meses, interesesPagados: intereses };
  } else {
    let saldo = item.pendiente;
    const r = item.tasaAnual / 100 / 12;
    let meses = 0, intereses = 0;
    while (saldo > 0.005 && meses < maxMeses) {
      const intMes = saldo * r;
      const cap = Math.min(item.cuotaFija - intMes, saldo);
      saldo -= cap;
      intereses += intMes;
      meses++;
    }
    return { meses, interesesPagados: intereses };
  }
}

function calcularEscenarios(items, extra) {
  if (items.length === 0) return [];

  const ids = items.map((it) => it.id);
  const byId = Object.fromEntries(items.map((it) => [it.id, it]));

  const metUsuario = simularBolaDeNieve(items, extra);
  const ordenBola = [...ids].sort((a, b) => byId[a].pendiente - byId[b].pendiente);
  const metBola = simularBolaDeNieve(ordenBola.map(id => byId[id]), extra);
  const ordenAvalanche = [...ids].sort((a, b) => byId[b].tasaAnual - byId[a].tasaAnual);
  const metAvalanche = simularBolaDeNieve(ordenAvalanche.map(id => byId[id]), extra);

  const arraysIguales = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  return [
    {
      key: "usuario", label: "Tu orden", emoji: "👤", color: "indigo",
      orden: ids, nombres: ids.map((id) => byId[id].nombre),
      plazoGlobal: metUsuario.plazoGlobal, interesesTotales: metUsuario.interesesTotales,
      mesLiquidez: metUsuario.mesLiquidez, esOptimo: false,
    },
    {
      key: "bola", label: "Bola de nieve", emoji: "⛄", color: "emerald",
      orden: ordenBola, nombres: ordenBola.map((id) => byId[id].nombre),
      plazoGlobal: metBola.plazoGlobal, interesesTotales: metBola.interesesTotales,
      mesLiquidez: metBola.mesLiquidez, esOptimo: arraysIguales(ordenBola, ids),
    },
    {
      key: "avalancha", label: "Avalancha", emoji: "🌊", color: "amber",
      orden: ordenAvalanche, nombres: ordenAvalanche.map((id) => byId[id].nombre),
      plazoGlobal: metAvalanche.plazoGlobal, interesesTotales: metAvalanche.interesesTotales,
      mesLiquidez: metAvalanche.mesLiquidez, esOptimo: arraysIguales(ordenAvalanche, ids),
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// MOTOR HIPOTECA VARIABLE CON HUCHA
// ─────────────────────────────────────────────────────────────────────────────
function simularHipotecaVariable({
  capitalInicial,
  mesesRestantes,
  diferencial,
  euriborActual,
  mesRevision,
  minimoAmortizacion,
  extraMensual,
  comisionAmortPct,
  huchaInicial = 0,
  maxMeses = 48,
  rentHucha = 0,
}) {
  const tasaInicial = diferencial + euriborActual;
  let capital = capitalInicial;
  let mesesRest = mesesRestantes;
  let tasaAnual = tasaInicial;
  let hucha = huchaInicial;
  const rH = rentHucha; // ya viene como tasa mensual (dividida por 100/12 en el llamador)
  let cuotaActual = cuotaFrancesa(capital, tasaAnual, mesesRest);

  const filas = [];
  const hoy = new Date();
  const mesHoy = hoy.getMonth() + 1;
  const anioHoy = hoy.getFullYear();

  for (let i = 0; i < maxMeses && capital > 0.01; i++) {
    const mesAbs = mesHoy + i;
    const mesCalendario = ((mesAbs - 1) % 12) + 1;
    const anioCalendario = anioHoy + Math.floor((mesAbs - 1) / 12);

    const esRevision = mesCalendario === mesRevision && i > 0;
    if (esRevision) {
      tasaAnual = diferencial + euriborActual;
      cuotaActual = cuotaFrancesa(capital, tasaAnual, mesesRest);
    }

    const r = tasaAnual / 100 / 12;
    const interesMes = capital * r;
    const amortCuota = Math.min(cuotaActual - interesMes, capital);

    // La hucha acumula con rentabilidad si se especifica
    hucha = rH > 0 ? hucha * (1 + rH) + extraMensual : hucha + extraMensual;

    let amortExtra = 0;
    let comisionPagada = 0;
    let golpe = false;

    if (capital <= minimoAmortizacion && hucha >= capital - amortCuota && extraMensual > 0) {
      // Capital residual menor que el mínimo: liquidar con hucha solo si hay extra y hucha suficiente
      amortExtra = Math.max(0, capital - amortCuota);
      comisionPagada = amortExtra * (comisionAmortPct / 100);
      golpe = true;
      hucha = Math.max(0, hucha - amortExtra);
    } else if (hucha >= minimoAmortizacion) {
      amortExtra = Math.floor(hucha / minimoAmortizacion) * minimoAmortizacion;
      comisionPagada = amortExtra * (comisionAmortPct / 100);
      hucha = hucha - amortExtra;
      golpe = true;
    }

    capital = Math.max(0, capital - amortCuota - amortExtra);
    mesesRest = Math.max(0, mesesRest - 1);

    filas.push({
      mes: i + 1,
      label: `${String(mesCalendario).padStart(2, "0")}/${anioCalendario}`,
      esRevision,
      cuota: cuotaActual,
      interesMes,
      amortCuota,
      amortExtra,
      comisionPagada,
      huchaDespues: hucha,
      golpe,
      capitalTras: capital,
      tasaAnual,
    });

    if (capital <= 0.01) break;
  }

  return filas;
}

// ─────────────────────────────────────────────────────────────────────────────
// DATOS INICIALES FORMULARIOS
// ─────────────────────────────────────────────────────────────────────────────
const EMPTY_PRESTAMO = {
  tipo: "prestamo",
  nombre: "",
  capitalOriginal: "",
  plazoOriginal: "",
  tasaAnual: "",
  pendiente: "",
  fechaRef: todayISO(),
  comisionPct: "0",
};

const EMPTY_TARJETA = {
  tipo: "tarjeta",
  nombre: "",
  pendiente: "",
  tasaAnual: "",
  cuotaElegida: "",
  limiteCredito: "3200",
  fechaRef: todayISO(),
};

const EMPTY_HIPOTECA = {
  tipo: "hipoteca",
  nombre: "",
  capitalOriginal: "",
  mesesRestantes: "",
  diferencial: "",
  euribor: "",
  mesRevision: "6",
  pendiente: "",
  fechaRef: todayISO(),
  minimoAmortizacion: "3000",
  comisionPct: "0",
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTES UI BASE
// ─────────────────────────────────────────────────────────────────────────────
function Badge({ children, color = "gray" }) {
  const colors = {
    gray: "bg-slate-700 text-slate-300",
    green: "bg-emerald-900/60 text-emerald-300",
    red: "bg-red-900/60 text-red-300",
    amber: "bg-amber-900/60 text-amber-300",
    blue: "bg-blue-900/60 text-blue-300",
    violet: "bg-violet-900/60 text-violet-300",
    sky: "bg-sky-900/60 text-sky-300",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[color]}`}>
      {children}
    </span>
  );
}

function Input({ label, value, onChange, type = "text", placeholder, hint, error, suffix }) {
  const handleFocus = (e) => {
    setTimeout(() => e.target.scrollIntoView({ behavior: "smooth", block: "center" }), 350);
  };
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</label>}
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={handleFocus}
          placeholder={placeholder}
          className={`w-full bg-slate-800 border rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition ${
            error ? "border-red-500" : "border-slate-600"
          } ${suffix ? "pr-10" : ""}`}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">{suffix}</span>
        )}
      </div>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  const scrollRef = useRef(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prevent = (e) => { if (el.scrollHeight > el.clientHeight) e.stopPropagation(); };
    el.addEventListener("touchmove", prevent, { passive: true });
    return () => el.removeEventListener("touchmove", prevent);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-2xl w-full ${wide ? "sm:max-w-2xl" : "sm:max-w-md"} shadow-2xl flex flex-col`}
        style={{ maxHeight: "90dvh" }}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-700 flex-shrink-0 bg-slate-900 rounded-t-2xl z-10">
          <h2 className="text-base font-bold text-slate-100">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-xl leading-none">✕</button>
        </div>
        <div ref={scrollRef} className="overflow-y-auto flex-1 p-4 pb-8">
          {children}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HUCHA INDICADOR
// ─────────────────────────────────────────────────────────────────────────────
function HuchaIndicador({ hucha, minimo, extraMensual, compact = false, onHuchaChange, onExtraChange, onRentHuchaChange, huchaValue, extraValue, rentHuchaValue }) {
  const pct = minimo > 0 ? Math.min(100, (hucha / minimo) * 100) : 0;
  const mesesFaltan = extraMensual > 0 ? Math.ceil((minimo - hucha) / extraMensual) : "∞";
  const lista = pct >= 100;

  if (compact) {
    return (
      <div className="bg-gradient-to-br from-blue-950/60 to-slate-900 rounded-xl border border-blue-900/40 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">🏦 Hucha</span>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${lista ? "bg-emerald-900/60 text-emerald-300" : "bg-blue-900/60 text-blue-300"}`}>
            {lista ? "✓ Lista" : `${pct.toFixed(0)}%`}
          </span>
        </div>
        <p className="text-lg font-black text-slate-100 font-mono">{fmt(hucha)} <span className="text-xs text-blue-400">€</span></p>
        <div className="mt-2 h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              background: lista ? "linear-gradient(90deg,#10b981,#34d399)" : "linear-gradient(90deg,#3b82f6,#60a5fa)",
              boxShadow: lista ? "0 0 8px #10b98160" : "0 0 6px #3b82f640",
            }}
          />
        </div>
        <p className="text-xs text-slate-500 mt-1">
          {lista ? "Lista para amortizar" : `Faltan ${fmt(minimo - hucha)} € · ~${mesesFaltan} m`}
        </p>
      </div>
    );
  }

  return (
    <div className="relative bg-gradient-to-br from-blue-950/80 to-slate-900 rounded-2xl border border-blue-900/40 p-5 overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-20"
        style={{ background: "radial-gradient(circle, #3b82f6 0%, transparent 70%)", transform: "translate(30%,-30%)" }} />

      {/* Cabecera: saldo grande + objetivo */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-1">🏦 Hucha</p>
          <p className="text-3xl font-black text-slate-100 font-mono">{fmt(hucha)} <span className="text-sm text-blue-400">€</span></p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">Objetivo</p>
          <p className="text-lg font-bold text-slate-300 font-mono">{fmt(minimo)} €</p>
        </div>
      </div>

      {/* Barra de progreso */}
      <div className="h-2 bg-slate-800 rounded-full overflow-hidden mb-2">
        <div className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: lista ? "linear-gradient(90deg,#10b981,#34d399)" : "linear-gradient(90deg,#3b82f6,#60a5fa)",
            boxShadow: lista ? "0 0 12px #10b98180" : "0 0 8px #3b82f640",
          }} />
      </div>
      <div className="flex justify-between text-xs mb-4">
        <span className="text-slate-500">{pct.toFixed(1)}% acumulado</span>
        {lista ? (
          <span className="text-emerald-400 font-bold">✓ Lista para amortizar</span>
        ) : (
          <span className="text-blue-400">
            Faltan <span className="font-mono font-bold">{fmt(minimo - hucha)} €</span>
            {" "}· ~{mesesFaltan} mes{mesesFaltan !== 1 ? "es" : ""}
          </span>
        )}
      </div>

      {/* Inputs editables dentro del cuadro */}
      {(onHuchaChange || onExtraChange || onRentHuchaChange) && (
        <div className="grid grid-cols-3 gap-3 border-t border-blue-900/40 pt-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-blue-500 uppercase tracking-wider">Saldo actual</label>
            <div className="relative">
              <input
                type="number"
                value={huchaValue ?? ""}
                onChange={(e) => onHuchaChange?.(e.target.value)}
                className="w-full bg-slate-900/60 border border-blue-800/50 rounded-lg px-3 py-2 pr-8 text-sm text-blue-300 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">€</span>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-blue-500 uppercase tracking-wider">Aportación/mes</label>
            <div className="relative">
              <input
                type="number"
                value={extraValue ?? ""}
                onChange={(e) => onExtraChange?.(e.target.value)}
                className="w-full bg-slate-900/60 border border-blue-800/50 rounded-lg px-3 py-2 pr-10 text-sm text-blue-300 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">€/m</span>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-blue-500 uppercase tracking-wider">Rentab. cuenta</label>
            <div className="relative">
              <input
                type="number"
                value={rentHuchaValue ?? ""}
                onChange={(e) => onRentHuchaChange?.(e.target.value)}
                step="0.1"
                className="w-full bg-slate-900/60 border border-blue-800/50 rounded-lg px-3 py-2 pr-8 text-sm text-blue-300 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="2"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">%</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TABLA AMORTIZACIÓN HIPOTECA
// ─────────────────────────────────────────────────────────────────────────────
function TablaAmortizacion({ item, extraMensual, huchaInicial, rentHucha = 0, meses = 36 }) {
  const [mostrarMeses, setMostrarMeses] = useState(meses);

  const filas = useMemo(() => {
    if (!item.pendiente || !item.mesesRestantes) return [];
    return simularHipotecaVariable({
      capitalInicial: item.pendiente,
      mesesRestantes: item.mesesRestantes,
      diferencial: item.diferencial || 0,
      euriborActual: item.euribor || 0,
      mesRevision: item.mesRevision || 6,
      minimoAmortizacion: item.minimoAmortizacion || 3000,
      extraMensual: extraMensual || 0,
      comisionAmortPct: item.comisionPct || 0,
      huchaInicial: huchaInicial || 0,
      maxMeses: mostrarMeses,
      rentHucha,
    });
  }, [item, extraMensual, huchaInicial, rentHucha, mostrarMeses]);

  const filasRef = useMemo(() => {
    if (!item.pendiente) return [];
    return simularHipotecaVariable({
      capitalInicial: item.pendiente,
      mesesRestantes: item.mesesRestantes,
      diferencial: item.diferencial || 0,
      euriborActual: item.euribor || 0,
      mesRevision: item.mesRevision || 6,
      minimoAmortizacion: item.minimoAmortizacion || 3000,
      extraMensual: 0,
      comisionAmortPct: item.comisionPct || 0,
      huchaInicial: 0,
      maxMeses: mostrarMeses,
    });
  }, [item, mostrarMeses]);

  const totalIntereses = filas.reduce((s, f) => s + f.interesMes, 0);
  const totalAmortExtra = filas.reduce((s, f) => s + f.amortExtra, 0);
  const totalComisiones = filas.reduce((s, f) => s + f.comisionPagada, 0);
  const golpes = filas.filter(f => f.golpe);
  const interesesRef = filasRef.reduce((s, f) => s + f.interesMes, 0);
  const ahorro = interesesRef - totalIntereses;

  return (
    <div className="space-y-3">
      {/* Métricas resumen */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: "Intereses proyectados", val: `${fmt(totalIntereses)} €`, color: "text-red-400" },
          { label: "Ahorro vs sin hucha", val: `${fmt(ahorro)} €`, color: "text-emerald-400" },
          { label: "Capital extra amortizado", val: `${fmt(totalAmortExtra)} €`, color: "text-blue-400" },
          { label: `Golpes de hucha`, val: `${golpes.length}`, color: "text-amber-400" },
        ].map((m, i) => (
          <div key={i} className="bg-slate-800/60 rounded-xl p-2.5 border border-slate-700/50">
            <p className="text-xs text-slate-500 mb-1">{m.label}</p>
            <p className={`text-sm font-bold font-mono ${m.color}`}>{m.val}</p>
          </div>
        ))}
      </div>

      {/* Selector meses */}
      <div className="flex gap-2">
        {[24, 36, 48].map(m => (
          <button key={m} onClick={() => setMostrarMeses(m)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              mostrarMeses === m
                ? "bg-blue-900/60 border border-blue-600 text-blue-300"
                : "bg-slate-800 border border-slate-700 text-slate-500 hover:border-slate-500"
            }`}>
            {m} meses
          </button>
        ))}
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap gap-3 text-xs text-slate-600">
        <span>💥 Amortización extra</span>
        <span className="text-amber-600">↻ Revisión de cuota</span>
        <span className="text-red-700">Intereses en rojo</span>
        <span className="text-blue-700">Hucha en azul</span>
      </div>

      {/* Tabla */}
      <div className="bg-slate-900/80 rounded-xl border border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs" style={{ minWidth: 520 }}>
            <thead>
              <tr className="border-b-2 border-slate-700 bg-slate-950/60">
                {["Mes", "Cuota", "Intereses", "Hucha", "Amort. extra", "Capital"].map((h, i) => (
                  <th key={i} className={`px-3 py-2.5 font-bold text-slate-500 uppercase tracking-wider ${i > 0 ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-slate-600">Sin datos suficientes</td></tr>
              ) : filas.map((fila, idx) => (
                <tr key={idx}
                  className={`border-b transition-colors ${
                    fila.golpe
                      ? "bg-emerald-950/30 border-emerald-800/30"
                      : idx % 2 === 0 ? "bg-slate-900/40 border-slate-800/30" : "bg-slate-900/20 border-slate-800/20"
                  }`}>
                  <td className={`px-3 py-2 font-mono ${fila.golpe ? "text-emerald-400" : "text-slate-400"}`}>
                    {fila.golpe && <span className="mr-1">💥</span>}
                    {fila.esRevision && !fila.golpe && <span className="mr-1 text-amber-500">↻</span>}
                    {fila.label}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-200">
                    {fmt(fila.cuota)}
                    {fila.esRevision && <div className="text-[9px] text-amber-500 text-right">revisión</div>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-red-400">{fmt(fila.interesMes)}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {fila.golpe
                      ? <span className="text-emerald-400 font-bold">{fmt(fila.huchaDespues)} →0</span>
                      : <span className="text-blue-400">{fmt(fila.huchaDespues)}</span>
                    }
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {fila.golpe ? (
                      <div>
                        <span className="text-emerald-400 font-bold">−{fmt(fila.amortExtra)}</span>
                        {fila.comisionPagada > 0 && <div className="text-[9px] text-amber-500">com.{fmt(fila.comisionPagada)}</div>}
                      </div>
                    ) : <span className="text-slate-700">—</span>}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono font-bold ${fila.golpe ? "text-emerald-400" : "text-slate-300"}`}>
                    {fmt(fila.capitalTras)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filas.length > 0 && (
          <div className="px-4 py-2.5 border-t border-slate-700 flex justify-between flex-wrap gap-2 text-xs text-slate-500">
            <span>{filas.length} meses · {golpes.length} amortizaciones</span>
            <span>
              Intereses: <strong className="text-red-400 font-mono">{fmt(totalIntereses)} €</strong>
              {" "}· Comisiones: <strong className="text-amber-400 font-mono">{fmt(totalComisiones)} €</strong>
            </span>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-600 italic border-l-2 border-slate-700 pl-3">
        Sistema francés recalculado en cada revisión. La hucha amortiza solo al alcanzar el mínimo, reduciendo plazo (no cuota).
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMULARIO HIPOTECA
// ─────────────────────────────────────────────────────────────────────────────
function FormHipoteca({ initial, onSave, onCancel }) {
  const [d, setD] = useState({ ...EMPTY_HIPOTECA, ...initial });
  const set = (k) => (v) => setD((p) => ({ ...p, [k]: v }));

  const cap = parseFloat(d.capitalOriginal) || 0;
  const pend = parseFloat(d.pendiente) || 0;
  const mesesRest = parseInt(d.mesesRestantes) || 0;
  const dif = parseFloat(d.diferencial) || 0;
  const eur = parseFloat(d.euribor) || 0;
  const tasaTotal = dif + eur;

  const cuota = cuotaFrancesa(pend || cap, tasaTotal, mesesRest);

  const errors = {};
  if (!d.nombre) errors.nombre = "Obligatorio";
  if (!pend && !cap) errors.pendiente = "Obligatorio";
  if (!mesesRest) errors.mesesRestantes = "Obligatorio";
  if (!dif) errors.diferencial = "Obligatorio";
  if (eur === 0 && !d.euribor) errors.euribor = "Obligatorio";
  if (!d.mesRevision) errors.mesRevision = "Obligatorio";

  const handleSave = () => {
    if (Object.keys(errors).length) return;
    onSave({
      ...d,
      tipo: "hipoteca",
      capitalOriginal: cap,
      pendiente: pend || cap,
      mesesRestantes: mesesRest,
      diferencial: dif,
      euribor: eur,
      mesRevision: parseInt(d.mesRevision) || 6,
      minimoAmortizacion: parseFloat(d.minimoAmortizacion) || 3000,
      comisionPct: parseFloat(d.comisionPct) || 0,
      cuotaFija: cuota,
      tasaAnual: tasaTotal,
    });
  };

  const mesesNombre = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

  return (
    <div className="flex flex-col gap-4">
      <Input label="Nombre de la hipoteca" value={d.nombre} onChange={set("nombre")} placeholder="Piso Principal…" error={errors.nombre} />

      <div className="grid grid-cols-2 gap-3">
        <Input label="Capital original" value={d.capitalOriginal} onChange={set("capitalOriginal")} type="number" placeholder="150000" suffix="€" />
        <Input label="Capital pendiente" value={d.pendiente} onChange={set("pendiente")} type="number" placeholder="85000" suffix="€" error={errors.pendiente} hint="Saldo según el banco hoy" />
      </div>

      <Input label="Meses restantes" value={d.mesesRestantes} onChange={set("mesesRestantes")} type="number" placeholder="240" suffix="m" error={errors.mesesRestantes} />

      <div className="grid grid-cols-2 gap-3">
        <Input label="Diferencial (banco)" value={d.diferencial} onChange={set("diferencial")} type="number" placeholder="0.75" suffix="%" error={errors.diferencial} hint="Margen fijo del banco" />
        <Input label="Euríbor proyectado" value={d.euribor} onChange={set("euribor")} type="number" placeholder="2.50" suffix="%" error={errors.euribor} hint="Tu previsión del euríbor" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Mes de revisión</label>
          <select
            value={d.mesRevision}
            onChange={(e) => set("mesRevision")(e.target.value)}
            className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => (
              <option key={m} value={m}>{m} - {mesesNombre[m]}</option>
            ))}
          </select>
          <p className="text-xs text-slate-500">Mes del año en que el banco revisa el tipo</p>
        </div>
        <Input label="Mínimo amortización" value={d.minimoAmortizacion} onChange={set("minimoAmortizacion")} type="number" placeholder="3000" suffix="€" hint="Umbral mínimo del banco" />
      </div>

      <Input label="Comisión amortización anticipada" value={d.comisionPct} onChange={set("comisionPct")} type="number" placeholder="0.25" suffix="%" hint="% sobre capital amortizado (0 si no hay)" />

      <Input label="Fecha de referencia" value={d.fechaRef} onChange={set("fechaRef")} type="date" />

      {tasaTotal > 0 && mesesRest > 0 && (pend || cap) > 0 && (
        <div className="bg-blue-950/40 rounded-xl p-3 border border-blue-800/40">
          <p className="text-xs text-blue-400 mb-2 font-semibold">Preview calculado</p>
          <div className="flex justify-between text-sm">
            <span className="text-slate-300">TIN actual</span>
            <span className="text-blue-300 font-bold font-mono">{fmt(tasaTotal, 2)}%</span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className="text-slate-300">Cuota mensual estimada</span>
            <span className="text-blue-300 font-bold font-mono">{fmt(cuota)} €/mes</span>
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-800 transition">Cancelar</button>
        <button onClick={handleSave} disabled={Object.keys(errors).length > 0}
          className="flex-1 py-2.5 rounded-xl bg-sky-600 text-white text-sm font-semibold hover:bg-sky-500 disabled:opacity-40 transition">
          Guardar hipoteca
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMULARIO PRÉSTAMO (sin cambios)
// ─────────────────────────────────────────────────────────────────────────────
function FormPrestamo({ initial, onSave, onCancel }) {
  const [d, setD] = useState({ ...EMPTY_PRESTAMO, ...initial });
  const set = (k) => (v) => setD((p) => ({ ...p, [k]: v }));

  const cap = parseFloat(d.capitalOriginal) || 0;
  const plazo = parseInt(d.plazoOriginal) || 0;
  const tasa = parseFloat(d.tasaAnual) || 0;
  const pend = parseFloat(d.pendiente) || 0;

  const cuota = cuotaFrancesa(cap, tasa, plazo);
  const cuotaOk = cuota > 0;

  let mesesRestEst = 0;
  if (cuotaOk && pend > 0) {
    const r = tasa / 100 / 12;
    if (r === 0) mesesRestEst = Math.ceil(pend / cuota);
    else mesesRestEst = Math.ceil(Math.log(cuota / (cuota - pend * r)) / Math.log(1 + r));
    if (!isFinite(mesesRestEst) || mesesRestEst < 0) mesesRestEst = 0;
  }

  const errors = {};
  if (!d.nombre) errors.nombre = "Obligatorio";
  if (!cap) errors.capitalOriginal = "Obligatorio";
  if (!plazo) errors.plazoOriginal = "Obligatorio";
  if (!tasa) errors.tasaAnual = "Obligatorio";
  if (!pend) errors.pendiente = "Obligatorio";

  const handleSave = () => {
    if (Object.keys(errors).length) return;
    onSave({ ...d, capitalOriginal: cap, plazoOriginal: plazo, tasaAnual: tasa, pendiente: pend, comisionPct: parseFloat(d.comisionPct) || 0, cuotaFija: cuota });
  };

  return (
    <div className="flex flex-col gap-4">
      <Input label="Nombre del préstamo" value={d.nombre} onChange={set("nombre")} placeholder="Hipoteca, Coche…" error={errors.nombre} />
      <div className="grid grid-cols-2 gap-3">
        <Input label="Capital original" value={d.capitalOriginal} onChange={set("capitalOriginal")} type="number" placeholder="80000" suffix="€" error={errors.capitalOriginal} />
        <Input label="Plazo original" value={d.plazoOriginal} onChange={set("plazoOriginal")} type="number" placeholder="240" suffix="m" error={errors.plazoOriginal} />
      </div>
      <Input label="Tipo de interés anual (TIN)" value={d.tasaAnual} onChange={set("tasaAnual")} type="number" placeholder="3.5" suffix="%" error={errors.tasaAnual} />
      <Input label="Capital pendiente hoy" value={d.pendiente} onChange={set("pendiente")} type="number" placeholder="65000" suffix="€" error={errors.pendiente} hint="El saldo que te indica el banco hoy" />
      <Input label="Fecha de referencia" value={d.fechaRef} onChange={set("fechaRef")} type="date" />
      <Input label="Comisión por amortización anticipada" value={d.comisionPct} onChange={set("comisionPct")} type="number" placeholder="0.5" suffix="%" hint="% sobre el capital amortizado (0 si no hay)" />
      {cuotaOk && (
        <div className="bg-slate-800 rounded-xl p-3 border border-slate-700">
          <p className="text-xs text-slate-400 mb-1">Preview calculado</p>
          <div className="flex justify-between text-sm">
            <span className="text-slate-300">Cuota mensual</span>
            <span className="text-indigo-300 font-bold">{fmt(cuota)} €/mes</span>
          </div>
          {mesesRestEst > 0 && (
            <div className="flex justify-between text-sm mt-1">
              <span className="text-slate-300">Meses restantes estimados</span>
              <span className="text-slate-200">{fmtM(mesesRestEst)}</span>
            </div>
          )}
        </div>
      )}
      <div className="flex gap-2 pt-2">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-800 transition">Cancelar</button>
        <button onClick={handleSave} disabled={Object.keys(errors).length > 0}
          className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 disabled:opacity-40 transition">Guardar</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMULARIO TARJETA (sin cambios)
// ─────────────────────────────────────────────────────────────────────────────
function FormTargeta({ initial, onSave, onCancel }) {
  const [d, setD] = useState({ ...EMPTY_TARJETA, ...initial });
  const set = (k) => (v) => setD((p) => ({ ...p, [k]: v }));

  const saldo = parseFloat(d.pendiente) || 0;
  const tasa = parseFloat(d.tasaAnual) || 0;
  const cuotaEl = parseFloat(d.cuotaElegida) || 0;
  const limiteCredito = parseFloat(d.limiteCredito) || 3200;

  const previewActivo = saldo > 0 && tasa > 0 && cuotaEl > 0;
  const minBanco = previewActivo ? cuotaMinimaTargeta(saldo, tasa, limiteCredito) : 0;
  const intMes = previewActivo ? saldo * (tasa / 100 / 12) : 0;
  const cuotaEfectiva = previewActivo ? Math.max(cuotaEl, minBanco) : cuotaEl;
  const noAmortiza = previewActivo && cuotaEfectiva <= intMes;
  const superaLimite = previewActivo && saldo > limiteCredito;

  const errors = {};
  if (!d.nombre) errors.nombre = "Obligatorio";
  if (!saldo) errors.pendiente = "Obligatorio";
  if (!tasa) errors.tasaAnual = "Obligatorio";
  if (!cuotaEl) errors.cuotaElegida = "Obligatorio";

  const handleSave = () => {
    if (Object.keys(errors).length) return;
    const minB = cuotaMinimaTargeta(saldo, tasa, limiteCredito);
    onSave({ ...d, pendiente: saldo, tasaAnual: tasa, cuotaElegida: cuotaEl, limiteCredito, cuotaFija: Math.max(cuotaEl, minB) });
  };

  return (
    <div className="flex flex-col gap-4">
      <Input label="Nombre de la tarjeta" value={d.nombre} onChange={set("nombre")} placeholder="Visa, Mastercard…" error={errors.nombre} />
      <Input label="Saldo pendiente hoy" value={d.pendiente} onChange={set("pendiente")} type="number" placeholder="3071" suffix="€" error={errors.pendiente} />
      <Input label="Tipo de interés anual (TIN)" value={d.tasaAnual} onChange={set("tasaAnual")} type="number" placeholder="12" suffix="%" hint="Si te lo dan mensual (ej: 1%), multiplica por 12" error={errors.tasaAnual} />
      <Input label="Cuota mensual que decides pagar" value={d.cuotaElegida} onChange={set("cuotaElegida")} type="number" placeholder="150" suffix="€/mes" error={errors.cuotaElegida} />
      <Input label="Límite de crédito" value={d.limiteCredito} onChange={set("limiteCredito")} type="number" placeholder="3200" suffix="€" hint="El banco cobra 9 € extra/mes si el saldo supera este límite" />
      <Input label="Fecha de referencia" value={d.fechaRef} onChange={set("fechaRef")} type="date" />
      {previewActivo && (
        <div className={`rounded-xl p-3 border ${noAmortiza ? "bg-red-950/40 border-red-700" : superaLimite ? "bg-orange-950/40 border-orange-700" : cuotaEl < minBanco ? "bg-amber-950/40 border-amber-700" : "bg-slate-800 border-slate-700"}`}>
          <p className="text-xs text-slate-400 mb-2">Cálculo automático del banco</p>
          <div className="flex justify-between text-sm">
            <span className="text-slate-300">Intereses este mes</span>
            <span className="text-slate-200">{fmt(intMes)} €</span>
          </div>
          {superaLimite && (
            <div className="flex justify-between text-sm mt-1">
              <span className="text-slate-300">Comisión por exceso límite</span>
              <span className="text-orange-300 font-bold">+ 9,00 €</span>
            </div>
          )}
          <div className="flex justify-between text-sm mt-1">
            <span className="text-slate-300">Pago mínimo banco</span>
            <span className="text-amber-300 font-bold">{fmt(minBanco)} €</span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className="text-slate-300">Cuota efectiva simulada</span>
            <span className="text-indigo-300 font-bold">{fmt(cuotaEfectiva)} €</span>
          </div>
          {noAmortiza && <p className="text-xs text-red-400 mt-2">🚨 La cuota no cubre los intereses. ¡La deuda crece cada mes!</p>}
          {cuotaEl < minBanco && !noAmortiza && <p className="text-xs text-amber-400 mt-2">⚠ Tu cuota es menor que el mínimo del banco. Se usará {fmt(minBanco)} €.</p>}
        </div>
      )}
      <div className="flex gap-2 pt-2">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-800 transition">Cancelar</button>
        <button onClick={handleSave} disabled={Object.keys(errors).length > 0}
          className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-500 disabled:opacity-40 transition">Guardar</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL ACTUALIZAR (sin cambios)
// ─────────────────────────────────────────────────────────────────────────────
function ModalActualizar({ item, onClose, onSave }) {
  const [modo, setModo] = useState(null);
  const [saldoReal, setSaldoReal] = useState("");
  const [fechaReal, setFechaReal] = useState(todayISO());
  const [fechaProyeccion, setFechaProyeccion] = useState(todayISO());
  const [preview, setPreview] = useState(null);

  const calcularProyeccion = () => {
    const meses = monthsBetween(item.fechaRef, fechaProyeccion);
    if (meses <= 0) { setPreview({ error: "La fecha debe ser posterior a la referencia" }); return; }

    let saldoNuevo;
    if (item.tipo === "tarjeta") {
      let s = item.pendiente;
      const r = item.tasaAnual / 100 / 12;
      for (let i = 0; i < meses; i++) {
        if (s <= 0) break;
        const intMes = s * r;
        const minB = cuotaMinimaTargeta(s, item.tasaAnual, item.limiteCredito ?? 3200);
        const cuota = Math.max(item.cuotaElegida || 25, minB);
        s = Math.max(0, s + intMes - cuota);
      }
      saldoNuevo = s;
    } else if (item.tipo === "hipoteca") {
      const filas = simularHipotecaVariable({
        capitalInicial: item.pendiente,
        mesesRestantes: item.mesesRestantes,
        diferencial: item.diferencial || 0,
        euriborActual: item.euribor || 0,
        mesRevision: item.mesRevision || 6,
        minimoAmortizacion: item.minimoAmortizacion || 9999999,
        extraMensual: 0,
        comisionAmortPct: 0,
        maxMeses: meses,
      });
      saldoNuevo = filas.length > 0 ? filas[filas.length - 1].capitalTras : item.pendiente;
    } else {
      saldoNuevo = avanzarAmortizacion(item.pendiente, item.cuotaFija, item.tasaAnual, meses);
    }
    setPreview({ meses, saldoNuevo });
  };

  const confirmar = () => {
    if (modo === "real") {
      const s = parseFloat(saldoReal);
      if (!s) return;
      onSave({ ...item, pendiente: s, fechaRef: fechaReal });
    } else if (modo === "proyectar" && preview && !preview.error) {
      onSave({ ...item, pendiente: preview.saldoNuevo, fechaRef: fechaProyeccion });
    }
    onClose();
  };

  return (
    <Modal title={`Actualizar · ${item.nombre}`} onClose={onClose}>
      {!modo && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-400">Ref. actual: <span className="text-slate-200">{fmtDate(item.fechaRef)}</span> · Saldo: <span className="text-slate-200">{fmt(item.pendiente)} €</span></p>
          <button onClick={() => setModo("real")} className="w-full p-4 rounded-xl border border-slate-600 hover:border-indigo-500 hover:bg-indigo-950/30 text-left transition">
            <div className="font-semibold text-slate-100 mb-1">📋 Saldo real del banco</div>
            <div className="text-xs text-slate-400">Introduces el capital pendiente del extracto. Siempre 100% fiable.</div>
          </button>
          <button onClick={() => setModo("proyectar")} className="w-full p-4 rounded-xl border border-slate-600 hover:border-violet-500 hover:bg-violet-950/30 text-left transition">
            <div className="font-semibold text-slate-100 mb-1">📈 Proyectar según el plan</div>
            <div className="text-xs text-slate-400">Calcula el saldo teórico asumiendo cuotas normales. Es una estimación.</div>
          </button>
        </div>
      )}
      {modo === "real" && (
        <div className="flex flex-col gap-4">
          <button onClick={() => setModo(null)} className="text-xs text-slate-500 hover:text-slate-300 text-left">← Volver</button>
          <Input label="Capital pendiente según extracto" value={saldoReal} onChange={setSaldoReal} type="number" suffix="€" placeholder="62450.00" />
          <Input label="Fecha del extracto" value={fechaReal} onChange={setFechaReal} type="date" />
          <button onClick={confirmar} disabled={!saldoReal} className="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 disabled:opacity-40 transition">Actualizar</button>
        </div>
      )}
      {modo === "proyectar" && (
        <div className="flex flex-col gap-4">
          <button onClick={() => setModo(null)} className="text-xs text-slate-500 hover:text-slate-300 text-left">← Volver</button>
          <Input label="Proyectar hasta" value={fechaProyeccion} onChange={setFechaProyeccion} type="date" />
          <button onClick={calcularProyeccion} className="w-full py-2.5 rounded-xl bg-slate-700 text-slate-100 text-sm hover:bg-slate-600 transition">Calcular</button>
          {preview && (
            <div className={`rounded-xl p-3 border ${preview.error ? "bg-red-950/40 border-red-700" : "bg-slate-800 border-slate-700"}`}>
              {preview.error ? (
                <p className="text-xs text-red-400">{preview.error}</p>
              ) : (
                <>
                  <p className="text-xs text-slate-400 mb-2">Resultado estimado ({preview.meses} meses)</p>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-300">Saldo proyectado</span>
                    <span className="text-indigo-300 font-bold">{fmt(preview.saldoNuevo)} €</span>
                  </div>
                  <div className="flex justify-between text-sm mt-1">
                    <span className="text-slate-300">Amortizado</span>
                    <span className="text-emerald-300">{fmt(item.pendiente - preview.saldoNuevo)} €</span>
                  </div>
                  <p className="text-xs text-amber-400 mt-2">⚠ Estimación. No incluye amortizaciones extraordinarias.</p>
                </>
              )}
            </div>
          )}
          {preview && !preview.error && (
            <button onClick={confirmar} className="w-full py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-500 transition">Confirmar proyección</button>
          )}
        </div>
      )}
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TARJETA HIPOTECA
// ─────────────────────────────────────────────────────────────────────────────
function HipotecaCard({ item, resultado, idx, total, dragging, onEdit, onDelete, onActualizar, onMoveUp, onMoveDown, dragHandlers, extraMensual, huchaActual, rentHuchaGlobal }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showTabla, setShowTabla] = useState(false);

  const tasaTotal = (item.diferencial || 0) + (item.euribor || 0);
  const mesesSin = resultado?.mesesSin ?? 0;
  const mesesCon = resultado?.mesesCon ?? 0;
  const mesesAhorrados = resultado?.mesesAhorrados ?? 0;
  const ahorro = resultado?.ahorro ?? 0;

  return (
    <div
      className={`rounded-2xl border transition-all select-none ${dragging ? "opacity-40 scale-95" : "opacity-100"} border-sky-800/50 bg-sky-950/20`}
      {...dragHandlers}
    >
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start gap-3 mb-3">
          <div className="flex flex-col items-center gap-1 pt-1 cursor-grab active:cursor-grabbing touch-none" style={{ touchAction: "none" }}>
            <div className="w-5 h-0.5 bg-slate-500 rounded" />
            <div className="w-5 h-0.5 bg-slate-500 rounded" />
            <div className="w-5 h-0.5 bg-slate-500 rounded" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-slate-100 truncate">{item.nombre}</span>
              <Badge color="sky">Hipoteca</Badge>
              <span className="text-xs text-slate-500 ml-auto">#{idx + 1}/{total}</span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Ref: {fmtDate(item.fechaRef)} · {item.mesesRestantes} meses restantes
            </p>
          </div>
        </div>

        {/* Datos financieros */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-slate-800/60 rounded-lg p-2 text-center">
            <p className="text-xs text-slate-500 mb-0.5">Pendiente</p>
            <p className="text-sm font-bold text-slate-100">{fmt(item.pendiente)} €</p>
          </div>
          <div className="bg-slate-800/60 rounded-lg p-2 text-center">
            <p className="text-xs text-slate-500 mb-0.5">TIN actual</p>
            <p className="text-sm font-bold text-sky-300">{fmt(tasaTotal, 2)}%</p>
            <p className="text-[10px] text-slate-600">{fmt(item.diferencial, 2)}+{fmt(item.euribor, 2)}</p>
          </div>
          <div className="bg-slate-800/60 rounded-lg p-2 text-center">
            <p className="text-xs text-slate-500 mb-0.5">Cuota</p>
            <p className="text-sm font-bold text-slate-100">{fmt(item.cuotaFija)} €</p>
          </div>
        </div>

        {/* Hucha compact */}
        <div className="mb-3">
          <HuchaIndicador
            hucha={parseFloat(huchaActual) || 0}
            minimo={item.minimoAmortizacion || 3000}
            extraMensual={parseFloat(extraMensual) || 0}
            compact={true}
          />
        </div>

        {/* Resultado simulación */}
        {resultado && (mesesSin > 0 || mesesCon > 0) && (
          <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-700/50 mb-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-slate-500">Sin hucha</p>
                <p className="text-slate-300">{fmtM(mesesSin)}</p>
                <p className="text-slate-500 mt-0.5">{addMonthsToRef(item.fechaRef, mesesSin)}</p>
              </div>
              <div>
                <p className="text-slate-500">Con hucha</p>
                <p className="text-sky-300 font-bold">{fmtM(mesesCon)}</p>
                <p className="text-sky-600 mt-0.5">{addMonthsToRef(item.fechaRef, mesesCon)}</p>
              </div>
              {mesesAhorrados > 0 && (
                <>
                  <div>
                    <p className="text-slate-500">Plazo ahorrado</p>
                    <p className="text-emerald-300 font-bold">{fmtM(mesesAhorrados)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Ahorro intereses</p>
                    <p className="text-emerald-300 font-bold">{fmt(ahorro)} €</p>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Acciones */}
        <div className="flex gap-2 mb-2">
          <button onClick={() => onActualizar(item)} className="flex-1 py-1.5 rounded-lg border border-slate-600 text-slate-300 text-xs hover:bg-slate-800 transition">📅 Actualizar</button>
          <button onClick={() => onEdit(item)} className="flex-1 py-1.5 rounded-lg border border-slate-600 text-slate-300 text-xs hover:bg-slate-800 transition">✏️ Editar</button>
          <button onClick={onMoveUp} disabled={idx === 0} className="py-1.5 px-2.5 rounded-lg border border-slate-600 text-slate-300 text-xs hover:bg-slate-800 disabled:opacity-20 transition">↑</button>
          <button onClick={onMoveDown} disabled={idx === total - 1} className="py-1.5 px-2.5 rounded-lg border border-slate-600 text-slate-300 text-xs hover:bg-slate-800 disabled:opacity-20 transition">↓</button>
          {confirmDelete ? (
            <>
              <button onClick={() => onDelete(item.id)} className="py-1.5 px-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold transition">✓</button>
              <button onClick={() => setConfirmDelete(false)} className="py-1.5 px-2.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs transition">✕</button>
            </>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="py-1.5 px-3 rounded-lg border border-red-800/50 text-red-400 text-xs hover:bg-red-950/30 transition">🗑</button>
          )}
        </div>

        {/* Toggle tabla amortización */}
        <button
          onClick={() => setShowTabla(!showTabla)}
          className="w-full py-1.5 rounded-lg border border-sky-800/40 text-sky-400 text-xs font-semibold hover:bg-sky-950/30 transition flex items-center justify-center gap-1"
        >
          <span>{showTabla ? "▲" : "▼"}</span>
          <span>{showTabla ? "Ocultar" : "Ver"} cuadro de amortización (36m)</span>
        </button>

        {showTabla && (
          <div className="mt-3 border-t border-slate-700 pt-3">
            <TablaAmortizacion
              item={item}
              extraMensual={parseFloat(extraMensual) || 0}
              huchaInicial={parseFloat(huchaActual) || 0}
              rentHucha={(parseFloat(rentHuchaGlobal) || 0) / 100 / 12}
              meses={36}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TARJETA ITEM CONSUMO (sin cambios materiales)
// ─────────────────────────────────────────────────────────────────────────────
function ItemCard({ item, resultado, idx, total, dragging, onEdit, onDelete, onActualizar, onMoveUp, onMoveDown, dragHandlers }) {
  const isPrestamo = item.tipo === "prestamo";
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mesesAhorrados = resultado?.mesesAhorrados ?? 0;
  const ahorro = resultado?.ahorro ?? 0;
  const mesesCon = resultado?.mesesCon ?? 0;
  const mesesSin = resultado?.mesesSin ?? 0;

  return (
    <div
      className={`rounded-2xl border transition-all select-none ${dragging ? "opacity-40 scale-95" : "opacity-100 scale-100"} ${isPrestamo ? "border-indigo-800/50 bg-indigo-950/20" : "border-violet-800/50 bg-violet-950/20"}`}
      {...dragHandlers}
    >
      <div className="p-4">
        <div className="flex items-start gap-3 mb-3">
          <div className="flex flex-col items-center gap-1 pt-1 cursor-grab active:cursor-grabbing touch-none" style={{ touchAction: "none" }}>
            <div className="w-5 h-0.5 bg-slate-500 rounded" />
            <div className="w-5 h-0.5 bg-slate-500 rounded" />
            <div className="w-5 h-0.5 bg-slate-500 rounded" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-slate-100 truncate">{item.nombre}</span>
              <Badge color={isPrestamo ? "blue" : "gray"}>{isPrestamo ? "Préstamo" : "Tarjeta"}</Badge>
              <span className="text-xs text-slate-500 ml-auto">#{idx + 1}/{total}</span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">Ref: {fmtDate(item.fechaRef)}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-slate-800/60 rounded-lg p-2 text-center">
            <p className="text-xs text-slate-500 mb-0.5">Pendiente</p>
            <p className="text-sm font-bold text-slate-100">{fmt(item.pendiente)} €</p>
          </div>
          <div className="bg-slate-800/60 rounded-lg p-2 text-center">
            <p className="text-xs text-slate-500 mb-0.5">Interés</p>
            <p className="text-sm font-bold text-slate-100">{item.tasaAnual}%</p>
          </div>
          <div className="bg-slate-800/60 rounded-lg p-2 text-center">
            <p className="text-xs text-slate-500 mb-0.5">Cuota</p>
            <p className="text-sm font-bold text-slate-100">{fmt(item.cuotaFija)} €</p>
          </div>
        </div>

        {resultado && (
          <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-700/50 mb-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-slate-500">Sin extra</p>
                <p className="text-slate-300">{fmtM(mesesSin)}</p>
                <p className="text-slate-500 mt-0.5">{addMonthsToRef(item.fechaRef, mesesSin)}</p>
              </div>
              <div>
                <p className="text-slate-500">Con bola de nieve</p>
                <p className="text-emerald-300 font-bold">{fmtM(mesesCon)}</p>
                <p className="text-emerald-600 mt-0.5">{addMonthsToRef(item.fechaRef, mesesCon)}</p>
              </div>
              <div>
                <p className="text-slate-500">Plazo ahorrado</p>
                <p className="text-emerald-300 font-bold">{fmtM(mesesAhorrados)}</p>
              </div>
              <div>
                <p className="text-slate-500">Ahorro intereses</p>
                <p className="text-emerald-300 font-bold">{fmt(ahorro)} €</p>
              </div>
            </div>
            {mesesAhorrados > 0 && (
              <div className="mt-2">
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                  <span>Reducción de plazo</span>
                  <span>{Math.round((mesesAhorrados / mesesSin) * 100)}%</span>
                </div>
                <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all"
                    style={{ width: `${Math.min(100, (mesesAhorrados / mesesSin) * 100)}%` }} />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={() => onActualizar(item)} className="flex-1 py-1.5 rounded-lg border border-slate-600 text-slate-300 text-xs hover:bg-slate-800 transition">📅 Actualizar</button>
          <button onClick={() => onEdit(item)} className="flex-1 py-1.5 rounded-lg border border-slate-600 text-slate-300 text-xs hover:bg-slate-800 transition">✏️ Editar</button>
          <button onClick={onMoveUp} disabled={idx === 0} className="py-1.5 px-2.5 rounded-lg border border-slate-600 text-slate-300 text-xs hover:bg-slate-800 disabled:opacity-20 disabled:cursor-not-allowed transition">↑</button>
          <button onClick={onMoveDown} disabled={idx === total - 1} className="py-1.5 px-2.5 rounded-lg border border-slate-600 text-slate-300 text-xs hover:bg-slate-800 disabled:opacity-20 disabled:cursor-not-allowed transition">↓</button>
          {confirmDelete ? (
            <>
              <button onClick={() => onDelete(item.id)} className="py-1.5 px-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold transition">✓</button>
              <button onClick={() => setConfirmDelete(false)} className="py-1.5 px-2.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs transition">✕</button>
            </>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="py-1.5 px-3 rounded-lg border border-red-800/50 text-red-400 text-xs hover:bg-red-950/30 transition">🗑</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPARADOR DE ESCENARIOS (sin cambios)
// ─────────────────────────────────────────────────────────────────────────────
function ComparadorEscenarios({ escenarios, onSeleccionar, mesesGlobalSin }) {
  const [confirmando, setConfirmando] = useState(null);

  const colorMap = {
    indigo: { bg: "bg-indigo-950/40", border: "border-indigo-700/50", badge: "bg-indigo-800/60 text-indigo-300", text: "text-indigo-300", btn: "bg-indigo-600 hover:bg-indigo-500" },
    emerald: { bg: "bg-emerald-950/40", border: "border-emerald-700/50", badge: "bg-emerald-800/60 text-emerald-300", text: "text-emerald-300", btn: "bg-emerald-600 hover:bg-emerald-500" },
    amber: { bg: "bg-amber-950/40", border: "border-amber-700/50", badge: "bg-amber-800/60 text-amber-300", text: "text-amber-300", btn: "bg-amber-600 hover:bg-amber-500" },
  };

  const minPlazo = Math.min(...escenarios.map(e => e.plazoGlobal));
  const minIntereses = Math.min(...escenarios.map(e => e.interesesTotales));

  const handleAplicar = (esc) => {
    onSeleccionar(esc.orden);
    setConfirmando(null);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Comparar estrategias</p>
        <p className="text-xs text-slate-600">Menor saldo primero · Mayor interés primero</p>
      </div>
      {escenarios.map((esc) => {
        const c = colorMap[esc.color];
        const esMejorPlazo = esc.plazoGlobal === minPlazo;
        const esMejorIntereses = esc.interesesTotales === minIntereses;
        const esUsuario = esc.key === "usuario";
        const estaConfirmando = confirmando === esc.key;

        if (estaConfirmando) {
          return (
            <div key={esc.key} className={`rounded-2xl border p-4 ${c.bg} ${c.border}`}>
              <p className="text-sm font-bold text-slate-100 mb-1">{esc.emoji} {esc.label}</p>
              <p className="text-xs text-slate-400 mb-3">¿Aplicar este orden de ataque?</p>
              <div className="flex flex-wrap gap-1 mb-4">
                {esc.nombres.map((nombre, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="text-slate-600 text-xs">→</span>}
                    <span className={`text-xs px-1.5 py-0.5 rounded-md ${c.badge}`}>{nombre}</span>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleAplicar(esc)} className={`flex-1 py-2 rounded-xl text-white text-sm font-semibold transition ${c.btn}`}>✓ Confirmar</button>
                <button onClick={() => setConfirmando(null)} className="flex-1 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm transition">✕ Cancelar</button>
              </div>
            </div>
          );
        }

        return (
          <button key={esc.key}
            onClick={() => !esUsuario && setConfirmando(esc.key)}
            className={`w-full text-left rounded-2xl border p-3.5 transition-all ${c.bg} ${c.border} ${esUsuario ? "opacity-100 cursor-default ring-2 ring-indigo-500/40" : "hover:scale-[1.01] active:scale-[0.99] cursor-pointer"}`}
          >
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-base">{esc.emoji}</span>
              <span className={`text-sm font-bold ${c.text}`}>{esc.label}</span>
              {esUsuario && <span className="text-xs px-1.5 py-0.5 rounded-full bg-indigo-800/60 text-indigo-300 ml-1">actual</span>}
              {esc.esOptimo && !esUsuario && <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-400 ml-1">= tu orden</span>}
              <span className="ml-auto text-xs text-slate-500">{esUsuario ? "—" : "Aplicar →"}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-2.5">
              <div className={`rounded-lg p-2 text-center ${esMejorPlazo ? c.bg + " ring-1 " + c.border : "bg-slate-800/50"}`}>
                <p className="text-xs text-slate-500 mb-0.5">Fin deudas</p>
                <p className={`text-xs font-bold ${esMejorPlazo ? c.text : "text-slate-300"}`}>{addMonths(esc.plazoGlobal)}</p>
                <p className="text-xs text-slate-600">{fmtM(esc.plazoGlobal)}</p>
                {esMejorPlazo && <p className="text-xs text-emerald-400 mt-0.5">✓ mejor</p>}
              </div>
              <div className={`rounded-lg p-2 text-center ${esMejorIntereses ? c.bg + " ring-1 " + c.border : "bg-slate-800/50"}`}>
                <p className="text-xs text-slate-500 mb-0.5">Intereses totales</p>
                <p className={`text-xs font-bold ${esMejorIntereses ? c.text : "text-slate-300"}`}>{fmt(esc.interesesTotales, 0)} €</p>
                {esMejorIntereses && <p className="text-xs text-emerald-400 mt-0.5">✓ mejor</p>}
              </div>
            </div>
            <div className="flex flex-wrap gap-1 items-center">
              <span className="text-xs text-slate-600">Orden:</span>
              {esc.nombres.map((nombre, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="text-slate-600 text-xs">→</span>}
                  <span className={`text-xs px-1.5 py-0.5 rounded-md ${c.badge}`}>{nombre}</span>
                </span>
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL GESTIÓN DE PERFILES (actualizado para tipo)
// ─────────────────────────────────────────────────────────────────────────────
function ModalPerfiles({ perfiles, perfilActivo, onSeleccionar, onCrear, onRenombrar, onEliminar, onDuplicar, onClose }) {
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoTipo, setNuevoTipo] = useState("consumo");
  const [editandoId, setEditandoId] = useState(null);
  const [editNombre, setEditNombre] = useState("");
  const [confirmEliminarId, setConfirmEliminarId] = useState(null);
  const ids = Object.keys(perfiles);

  const guardarRenombre = (id) => {
    if (editNombre.trim()) onRenombrar(id, editNombre.trim());
    setEditandoId(null);
  };

  const handleCrear = () => {
    if (!nuevoNombre.trim()) return;
    onCrear(nuevoNombre.trim(), nuevoTipo);
    setNuevoNombre("");
    setNuevoTipo("consumo");
  };

  const tipoBadge = (tipo) => tipo === "hipoteca"
    ? <span className="text-xs px-1.5 py-0.5 rounded-full bg-sky-900/60 text-sky-300">🏠 Hipoteca</span>
    : <span className="text-xs px-1.5 py-0.5 rounded-full bg-indigo-900/60 text-indigo-300">💳 Consumo</span>;

  return (
    <div className="flex flex-col gap-3">
      {ids.map((id) => {
        const p = perfiles[id];
        const esActivo = id === perfilActivo;
        const nItems = p.items?.length || 0;

        if (editandoId === id) {
          return (
            <div key={id} className="flex gap-2 items-center bg-slate-800 rounded-xl p-3 border border-indigo-600">
              <input autoFocus value={editNombre} onChange={e => setEditNombre(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") guardarRenombre(id); if (e.key === "Escape") setEditandoId(null); }}
                className="flex-1 bg-slate-700 border border-slate-500 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <button onClick={() => guardarRenombre(id)} className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm transition">✓</button>
              <button onClick={() => setEditandoId(null)} className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm transition">✕</button>
            </div>
          );
        }

        if (confirmEliminarId === id) {
          return (
            <div key={id} className="rounded-xl p-3 border border-red-700 bg-red-950/40">
              <p className="text-sm text-red-300 mb-2">¿Eliminar <span className="font-bold">{p.nombre}</span>? Se borrarán sus {nItems} deuda{nItems !== 1 ? "s" : ""}.</p>
              <div className="flex gap-2">
                <button onClick={() => { onEliminar(id); setConfirmEliminarId(null); }} className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold transition">Eliminar</button>
                <button onClick={() => setConfirmEliminarId(null)} className="flex-1 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm transition">Cancelar</button>
              </div>
            </div>
          );
        }

        return (
          <div key={id} className={`flex items-center gap-2 rounded-xl p-3 border transition ${esActivo ? "border-indigo-500 bg-indigo-950/40" : "border-slate-700 bg-slate-800/40"}`}>
            <button onClick={() => { onSeleccionar(id); onClose(); }} className="flex-1 text-left min-w-0">
              <div className="flex items-center gap-2">
                <p className={`text-sm font-bold truncate ${esActivo ? "text-indigo-300" : "text-slate-200"}`}>{p.nombre}</p>
                {esActivo && <span className="shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-indigo-800/60 text-indigo-300">activo</span>}
                {tipoBadge(p.tipo)}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">{nItems} deuda{nItems !== 1 ? "s" : ""} · extra {p.extra || "0"}€/mes</p>
            </button>
            <button onClick={() => { setEditandoId(id); setEditNombre(p.nombre); }}
              className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition" title="Renombrar">✏️</button>
            <button onClick={() => onDuplicar(id)}
              className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-indigo-300 hover:bg-slate-700 transition" title="Duplicar">📋</button>
            {ids.length > 1 && !esActivo && (
              <button onClick={() => setConfirmEliminarId(id)}
                className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-700 transition">🗑</button>
            )}
          </div>
        );
      })}

      <div className="border-t border-slate-700 pt-3 mt-1">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Nuevo perfil</p>

        {/* Selector de tipo */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <button
            onClick={() => setNuevoTipo("consumo")}
            className={`p-3 rounded-xl border text-left transition ${nuevoTipo === "consumo" ? "border-indigo-500 bg-indigo-950/40" : "border-slate-700 bg-slate-800/40 hover:border-slate-600"}`}
          >
            <div className="text-lg mb-1">💳</div>
            <p className={`text-xs font-bold ${nuevoTipo === "consumo" ? "text-indigo-300" : "text-slate-400"}`}>Consumo</p>
            <p className="text-[10px] text-slate-600 mt-0.5">Préstamos y tarjetas</p>
          </button>
          <button
            onClick={() => setNuevoTipo("hipoteca")}
            className={`p-3 rounded-xl border text-left transition ${nuevoTipo === "hipoteca" ? "border-sky-500 bg-sky-950/40" : "border-slate-700 bg-slate-800/40 hover:border-slate-600"}`}
          >
            <div className="text-lg mb-1">🏠</div>
            <p className={`text-xs font-bold ${nuevoTipo === "hipoteca" ? "text-sky-300" : "text-slate-400"}`}>Hipoteca variable</p>
            <p className="text-[10px] text-slate-600 mt-0.5">Con euríbor y hucha</p>
          </button>
        </div>

        <div className="flex gap-2">
          <input value={nuevoNombre} onChange={e => setNuevoNombre(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleCrear(); }}
            placeholder="Nombre del perfil…"
            className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <button onClick={handleCrear} disabled={!nuevoNombre.trim()}
            className={`px-4 py-2 rounded-lg text-white text-sm font-semibold transition disabled:opacity-40 ${nuevoTipo === "hipoteca" ? "bg-sky-600 hover:bg-sky-500" : "bg-indigo-600 hover:bg-indigo-500"}`}>
            Crear
          </button>
        </div>
      </div>

      <button onClick={onClose} className="w-full py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm hover:bg-slate-800 transition mt-1">Cerrar</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GESTIÓN DE DATOS
// ─────────────────────────────────────────────────────────────────────────────
const SEC_KEYS = {
  enabled: "bdn_sec_enabled",
  pinHash: "bdn_sec_pin_hash",
  webauthnId: "bdn_sec_webauthn_id",
};

async function hashPin(pin) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("bdn_salt_" + pin));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPin(pin) {
  const stored = localStorage.getItem(SEC_KEYS.pinHash);
  if (!stored) return false;
  return (await hashPin(pin)) === stored;
}

function webAuthnAvailable() {
  return !!(window.PublicKeyCredential && typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function");
}

async function hasPlatformAuthenticator() {
  if (!webAuthnAvailable()) return false;
  try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
  catch { return false; }
}

async function webAuthnRegister() {
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "Prioriza", id: location.hostname || "localhost" },
      user: { id: userId, name: "usuario", displayName: "Usuario" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
      timeout: 60000,
    },
  });
  const credId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
  localStorage.setItem(SEC_KEYS.webauthnId, credId);
  return true;
}

async function webAuthnVerify() {
  const storedId = localStorage.getItem(SEC_KEYS.webauthnId);
  if (!storedId) return false;
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const credIdBytes = Uint8Array.from(atob(storedId), c => c.charCodeAt(0));
  try {
    await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: location.hostname || "localhost",
        allowCredentials: [{ type: "public-key", id: credIdBytes }],
        userVerification: "required",
        timeout: 60000,
      },
    });
    return true;
  } catch { return false; }
}

if (typeof document !== "undefined" && !document.getElementById("bdn-shake")) {
  const s = document.createElement("style");
  s.id = "bdn-shake";
  s.textContent = `@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}.animate-shake{animation:shake 0.5s ease-in-out}`;
  document.head.appendChild(s);
}

if (typeof document !== "undefined" && !document.getElementById("bdn-styles")) {
  const s = document.createElement("style");
  s.id = "bdn-styles";
  s.textContent = `@keyframes cardFlash{0%{box-shadow:0 0 0 2px #6366f1,0 0 16px 4px #6366f188}60%{box-shadow:0 0 0 2px #6366f1,0 0 16px 4px #6366f144}100%{box-shadow:none}}.card-flash{animation:cardFlash 600ms ease-out}`;
  document.head.appendChild(s);
}

function PinPad({ onSuccess, onCancel, label = "Introduce tu PIN" }) {
  const [digits, setDigits] = useState([]);
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);

  const press = async (d) => {
    if (digits.length >= 4) return;
    const next = [...digits, d];
    setDigits(next);
    setError("");
    if (next.length === 4) {
      const ok = await verifyPin(next.join(""));
      if (ok) { onSuccess(); }
      else {
        setShake(true);
        setError("PIN incorrecto");
        setTimeout(() => { setDigits([]); setShake(false); }, 700);
      }
    }
  };

  const del = () => setDigits(p => p.slice(0, -1));
  const KEYS = ["1","2","3","4","5","6","7","8","9","","0","⌫"];

  return (
    <div className={`flex flex-col items-center gap-5 ${shake ? "animate-shake" : ""}`}>
      <p className="text-sm text-slate-400">{label}</p>
      <div className="flex gap-4">
        {[0,1,2,3].map(i => (
          <div key={i} className={`w-3 h-3 rounded-full border-2 transition-all duration-150 ${i < digits.length ? "bg-indigo-400 border-indigo-400 scale-110" : "border-slate-600"}`} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3 w-56">
        {KEYS.map((k, i) => (
          k === "" ? <div key={i} /> :
          k === "⌫" ? (
            <button key={i} onClick={del} className="h-14 rounded-2xl bg-slate-800 text-slate-400 text-xl font-bold hover:bg-slate-700 active:scale-95 transition-all">⌫</button>
          ) : (
            <button key={i} onClick={() => press(k)} className="h-14 rounded-2xl bg-slate-800 text-slate-100 text-xl font-bold hover:bg-slate-700 active:scale-95 transition-all border border-slate-700/50">{k}</button>
          )
        ))}
      </div>
      {error && <p className="text-xs text-red-400 animate-pulse">{error}</p>}
      {onCancel && <button onClick={onCancel} className="text-xs text-slate-600 hover:text-slate-400 mt-1">Cancelar</button>}
    </div>
  );
}

function LockScreen({ onUnlock }) {
  const [mode, setMode] = useState("init");
  const [bioAvail, setBioAvail] = useState(false);
  const [bioError, setBioError] = useState("");
  const [resetMsg, setResetMsg] = useState("");

  useEffect(() => {
    hasPlatformAuthenticator().then(avail => {
      setBioAvail(avail && !!localStorage.getItem(SEC_KEYS.webauthnId));
      if (avail && localStorage.getItem(SEC_KEYS.webauthnId)) { tryBio(); }
      else { setMode("pin"); }
    });
  }, []);

  const tryBio = async () => {
    setMode("bio");
    setBioError("");
    const ok = await webAuthnVerify();
    if (ok) { onUnlock(); }
    else { setBioError("Biometría no reconocida"); setMode("pin"); }
  };

  const handleReset = () => {
    [SEC_KEYS.enabled, SEC_KEYS.pinHash, SEC_KEYS.webauthnId].forEach(k => localStorage.removeItem(k));
    setResetMsg("Seguridad eliminada. Recargando…");
    setTimeout(() => location.reload(), 1500);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950 flex flex-col items-center justify-center px-6" style={{ fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>
      <div className="mb-10 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <h1 className="text-xl font-black text-slate-100">Prioriza</h1>
        <p className="text-xs text-slate-500 mt-1">Desbloquea para acceder</p>
      </div>
      {mode === "bio" && (
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-indigo-600/20 border border-indigo-600/40 flex items-center justify-center text-3xl animate-pulse">👆</div>
          <p className="text-sm text-slate-400">Usando biometría…</p>
          {bioError && <p className="text-xs text-red-400">{bioError}</p>}
          <button onClick={() => setMode("pin")} className="text-xs text-slate-500 hover:text-slate-300 mt-2">Usar PIN en su lugar</button>
        </div>
      )}
      {mode === "pin" && (
        <div className="flex flex-col items-center gap-4 w-full max-w-xs">
          <PinPad onSuccess={onUnlock} />
          {bioAvail && (
            <button onClick={tryBio} className="flex items-center gap-2 text-xs text-indigo-400 hover:text-indigo-300 mt-2">
              <span>👆</span><span>Usar huella / FaceID</span>
            </button>
          )}
        </div>
      )}
      {mode === "reset_confirm" && (
        <div className="bg-red-950/40 border border-red-700 rounded-2xl p-5 max-w-xs w-full text-center">
          <p className="text-sm font-bold text-red-300 mb-2">¿Eliminar seguridad?</p>
          <p className="text-xs text-slate-400 mb-4">Se borrarán el PIN y la biometría.<br/><strong className="text-emerald-400">Tus deudas y perfiles no se tocarán.</strong></p>
          <div className="flex gap-2">
            <button onClick={handleReset} className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-semibold transition">Sí, resetear</button>
            <button onClick={() => setMode("pin")} className="flex-1 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm transition">Cancelar</button>
          </div>
          {resetMsg && <p className="text-xs text-emerald-400 mt-3">{resetMsg}</p>}
        </div>
      )}
      {mode !== "reset_confirm" && (
        <button onClick={() => setMode("reset_confirm")} className="absolute bottom-6 text-xs text-slate-700 hover:text-slate-500 transition">
          ¿Problemas para entrar? · Reset de emergencia
        </button>
      )}
    </div>
  );
}

function SecuritySettings() {
  const enabled = !!localStorage.getItem(SEC_KEYS.enabled);
  const [step, setStep] = useState("idle");
  const [newPin, setNewPin] = useState([]);
  const [confirmPin, setConfirm] = useState([]);
  const [phase, setPhase] = useState("enter");
  const [pinError, setPinError] = useState("");
  const [bioAvail, setBioAvail] = useState(false);
  const [msg, setMsg] = useState("");
  const [, forceUpdate] = useState(0);

  useEffect(() => { hasPlatformAuthenticator().then(setBioAvail); }, []);

  const flash = (text, ms = 3000) => { setMsg(text); setTimeout(() => setMsg(""), ms); };
  const startSetup = () => { setStep("setup_pin"); setPhase("enter"); setNewPin([]); setConfirm([]); };

  const handlePinDigit = (d) => {
    if (phase === "enter") {
      const next = [...newPin, d];
      if (next.length > 4) return;
      setNewPin(next);
      if (next.length === 4) setTimeout(() => setPhase("confirm"), 300);
    } else {
      const next = [...confirmPin, d];
      if (next.length > 4) return;
      setConfirm(next);
      if (next.length === 4) {
        if (next.join("") === newPin.join("")) { finishPinSetup(next.join("")); }
        else {
          setPinError("Los PINs no coinciden.");
          setTimeout(() => { setNewPin([]); setConfirm([]); setPhase("enter"); setPinError(""); }, 1000);
        }
      }
    }
  };

  const delPinDigit = () => {
    if (phase === "enter") setNewPin(p => p.slice(0, -1));
    else setConfirm(p => p.slice(0, -1));
  };

  const finishPinSetup = async (pin) => {
    const h = await hashPin(pin);
    localStorage.setItem(SEC_KEYS.pinHash, h);
    setStep("setup_bio");
  };

  const activateBio = async () => {
    try {
      await webAuthnRegister();
      localStorage.setItem(SEC_KEYS.enabled, "1");
      setStep("done");
      forceUpdate(n => n + 1);
      flash("✓ Seguridad activada con biometría");
    } catch {
      flash("Biometría no disponible. Se usará solo PIN.");
      skipBio();
    }
  };

  const skipBio = () => { localStorage.setItem(SEC_KEYS.enabled, "1"); setStep("idle"); forceUpdate(n => n + 1); flash("✓ Seguridad activada con PIN"); };
  const disableSecurity = () => {
    [SEC_KEYS.enabled, SEC_KEYS.pinHash, SEC_KEYS.webauthnId].forEach(k => localStorage.removeItem(k));
    setStep("idle"); forceUpdate(n => n + 1); flash("Seguridad desactivada");
  };

  const KEYS_SETUP = ["1","2","3","4","5","6","7","8","9","","0","⌫"];
  const currentDigits = phase === "enter" ? newPin : confirmPin;

  return (
    <div className="border-t border-slate-700 pt-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs font-bold text-slate-300">Bloqueo de acceso</p>
          <p className="text-xs text-slate-500">PIN + biometría</p>
        </div>
        <div className={`px-2 py-0.5 rounded-full text-xs font-bold ${enabled ? "bg-emerald-900/60 text-emerald-400" : "bg-slate-700 text-slate-500"}`}>
          {enabled ? "Activo" : "Inactivo"}
        </div>
      </div>
      {step === "idle" && (
        <button onClick={() => enabled ? setStep("disable_confirm") : startSetup()}
          className={`w-full py-2.5 rounded-xl text-sm font-semibold transition ${enabled ? "border border-red-800/50 text-red-400 hover:bg-red-950/30" : "bg-indigo-600 hover:bg-indigo-500 text-white"}`}>
          {enabled ? "🔓 Desactivar seguridad" : "🔐 Activar seguridad"}
        </button>
      )}
      {step === "disable_confirm" && (
        <div className="rounded-xl p-3 bg-red-950/30 border border-red-800/50">
          <p className="text-xs text-red-300 mb-3">¿Desactivar el bloqueo?</p>
          <div className="flex gap-2">
            <button onClick={disableSecurity} className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold transition">Sí, desactivar</button>
            <button onClick={() => setStep("idle")} className="flex-1 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs transition">Cancelar</button>
          </div>
        </div>
      )}
      {step === "setup_pin" && (
        <div className="flex flex-col items-center gap-4 py-2">
          <p className="text-xs text-slate-400 font-semibold">{phase === "enter" ? "Elige un PIN de 4 dígitos" : "Repite el PIN para confirmar"}</p>
          <div className="flex gap-3">
            {[0,1,2,3].map(i => (
              <div key={i} className={`w-3 h-3 rounded-full border-2 transition-all duration-150 ${i < currentDigits.length ? "bg-indigo-400 border-indigo-400" : "border-slate-600"}`} />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 w-48">
            {KEYS_SETUP.map((k, i) => (
              k === "" ? <div key={i} /> :
              k === "⌫" ? (
                <button key={i} onClick={delPinDigit} className="h-12 rounded-xl bg-slate-800 text-slate-400 text-lg font-bold hover:bg-slate-700 active:scale-95 transition-all">⌫</button>
              ) : (
                <button key={i} onClick={() => handlePinDigit(k)} className="h-12 rounded-xl bg-slate-800 text-slate-100 text-lg font-bold hover:bg-slate-700 active:scale-95 transition-all border border-slate-700/50">{k}</button>
              )
            ))}
          </div>
          {pinError && <p className="text-xs text-red-400">{pinError}</p>}
          <button onClick={() => setStep("idle")} className="text-xs text-slate-600 hover:text-slate-400">Cancelar</button>
        </div>
      )}
      {step === "setup_bio" && (
        <div className="flex flex-col items-center gap-3 py-3">
          <div className="text-3xl">👆</div>
          <p className="text-xs text-slate-300 font-semibold text-center">{bioAvail ? "¿Activar también huella / FaceID?" : "Tu dispositivo no tiene biometría"}</p>
          <p className="text-xs text-slate-500 text-center">El PIN siempre funcionará como respaldo</p>
          {bioAvail ? (
            <div className="flex gap-2 w-full">
              <button onClick={activateBio} className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition">Sí, activar biometría</button>
              <button onClick={skipBio} className="flex-1 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs transition">Solo PIN</button>
            </div>
          ) : (
            <button onClick={skipBio} className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition">Activar con PIN</button>
          )}
        </div>
      )}
      {msg && <p className={`text-xs text-center mt-2 ${msg.startsWith("✓") ? "text-emerald-400" : "text-slate-400"}`}>{msg}</p>}
    </div>
  );
}

function GestionDatos({ onExportar, onRestaurar }) {
  const [estado, setEstado] = useState(null);
  const [msgError, setMsgError] = useState("");
  const fileRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setEstado("confirmando");
    fileRef._pendingFile = file;
  };

  const confirmarRestaura = async () => {
    try {
      await onRestaurar(fileRef._pendingFile);
      setEstado("ok");
      setTimeout(() => setEstado(null), 3000);
    } catch (err) {
      setMsgError(err.message || "Error desconocido");
      setEstado("error");
      setTimeout(() => setEstado(null), 4000);
    }
  };

  return (
    <div className="bg-slate-900 rounded-2xl border border-slate-700 p-4">
      <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Gestión de datos</h2>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <button onClick={onExportar} className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition">
          <span>💾</span><span>Backup</span>
        </button>
        <label className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-semibold transition cursor-pointer">
          <span>📂</span><span>Restaurar</span>
          <input type="file" accept=".json" className="hidden" onChange={handleFileChange} />
        </label>
      </div>
      {estado === "confirmando" && (
        <div className="rounded-xl p-3 bg-amber-950/40 border border-amber-700">
          <p className="text-xs text-amber-300 mb-2">⚠️ Esto <strong>sobrescribirá</strong> todos los datos actuales. ¿Continuar?</p>
          <div className="flex gap-2">
            <button onClick={confirmarRestaura} className="flex-1 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold transition">Sí, restaurar</button>
            <button onClick={() => setEstado(null)} className="flex-1 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs transition">Cancelar</button>
          </div>
        </div>
      )}
      {estado === "ok" && <p className="text-xs text-emerald-400 text-center mt-1">✓ Datos restaurados correctamente</p>}
      {estado === "error" && <p className="text-xs text-red-400 text-center mt-1">✗ {msgError}</p>}
      <p className="text-xs text-slate-600 mt-3 text-center">El backup incluye todos los perfiles y sus deudas</p>
      <SecuritySettings />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERADOR DE INFORME HTML
// ─────────────────────────────────────────────────────────────────────────────
function generarInformeHTML({ perfil, resultadosPorId, sinExtraPorId, simCon, extra }) {
  const fmt = (n) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
  const fmtM = (n) => `${Math.round(n)} mes${n === 1 ? "" : "es"}`;
  const addMonthsLocal = (n) => {
    const d = new Date();
    d.setMonth(d.getMonth() + Math.round(n));
    return d.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  };

  const items = perfil.items;
  const fechaHoy = new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
  const totalPendiente = items.reduce((s, it) => s + (it.pendiente || 0), 0);
  const totalCuotas = items.reduce((s, it) => s + (it.cuotaFija || 0), 0);
  const totalSinBola = Object.values(sinExtraPorId).reduce((s, r) => s + r.interesesPagados, 0);
  const ahorroTotal = simCon ? totalSinBola - simCon.interesesTotales : 0;
  const plazoSin = Object.values(sinExtraPorId).length > 0 ? Math.max(...Object.values(sinExtraPorId).map(r => r.meses)) : 0;
  const plazoCon = simCon?.plazoGlobal ?? 0;

  const tarjetaResumen = (label, value, sub, green = false) => `
    <div class="card">
      <div class="card-label">${label}</div>
      <div class="card-value ${green ? "green" : ""}">${value}</div>
      <div class="card-sub">${sub}</div>
    </div>`;

  const filasDeudas = items.map((it, idx) => {
    const res = resultadosPorId[it.id];
    const sinR = sinExtraPorId[it.id];
    if (!res) return "";
    const isHip = it.tipo === "hipoteca";
    const isPre = it.tipo === "prestamo";
    const tipoLabel = isHip ? "HIPOTECA" : isPre ? "PRÉSTAMO" : "TARJETA";
    const tipoColor = isHip ? "#0ea5e9" : isPre ? "#6366f1" : "#8b5cf6";
    const tin = it.tasaAnual || ((it.diferencial || 0) + (it.euribor || 0));
    return `
    <tr>
      <td><span class="badge" style="background:${tipoColor}">${tipoLabel}</span> ${it.nombre}</td>
      <td>${fmt(it.pendiente)} €</td>
      <td>${tin}%</td>
      <td>${fmt(it.cuotaFija)} €/mes</td>
      <td>${fmtM(sinR?.meses ?? 0)}</td>
      <td class="green">${fmtM(res.mesesCon)}</td>
      <td class="green">${fmt(res.ahorro || 0)} €</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Informe · ${perfil.nombre} · ${fechaHoy}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f8fafc; color: #1e293b; padding: 32px 24px; }
    .header { border-bottom: 3px solid #6366f1; padding-bottom: 16px; margin-bottom: 28px; }
    .header h1 { font-size: 22px; font-weight: 900; color: #1e293b; }
    .header p { font-size: 13px; color: #64748b; margin-top: 4px; }
    .section-title { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 12px; margin-top: 28px; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    @media(min-width: 600px) { .grid { grid-template-columns: repeat(4, 1fr); } }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; }
    .card-label { font-size: 11px; color: #94a3b8; margin-bottom: 6px; }
    .card-value { font-size: 18px; font-weight: 900; color: #1e293b; }
    .card-value.green { color: #10b981; }
    .card-sub { font-size: 11px; color: #94a3b8; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; font-size: 13px; }
    th { background: #f1f5f9; padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
    td { padding: 12px; border-top: 1px solid #f1f5f9; color: #334155; }
    tr:hover td { background: #f8fafc; }
    .badge { display: inline-block; padding: 2px 7px; border-radius: 4px; color: #fff; font-size: 10px; font-weight: 700; }
    .green { color: #10b981; font-weight: 700; }
    .footer { margin-top: 36px; text-align: center; font-size: 11px; color: #cbd5e1; }
    @media print {
      body { background: #fff; padding: 16px; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Informe de deudas · ${perfil.nombre}</h1>
    <p>Generado el ${fechaHoy} · Prioriza</p>
  </div>

  <div class="section-title">Resumen global</div>
  <div class="grid">
    ${tarjetaResumen("Total pendiente", `${fmt(totalPendiente)} €`, `${items.length} deuda${items.length !== 1 ? "s" : ""}`)}
    ${tarjetaResumen("Desembolso mensual", `${fmt(totalCuotas + extra)} €/mes`, `${fmt(totalCuotas)} cuotas + ${fmt(extra)} extra`)}
    ${tarjetaResumen("Ahorro en intereses", `${fmt(ahorroTotal)} €`, "con el plan", true)}
    ${tarjetaResumen("Libre de deudas en", addMonthsLocal(plazoCon), `${fmtM(plazoSin - plazoCon)} antes`, true)}
  </div>

  <div class="section-title">Detalle de deudas</div>
  <table>
    <thead>
      <tr>
        <th>Deuda</th>
        <th>Pendiente</th>
        <th>TIN</th>
        <th>Cuota</th>
        <th>Sin plan</th>
        <th>Con plan</th>
        <th>Ahorro</th>
      </tr>
    </thead>
    <tbody>${filasDeudas}</tbody>
  </table>

  <div class="footer">Prioriza · Tu planificador financiero personal</div>
</body>
</html>`;
}

function descargarInforme({ perfil, resultadosPorId, sinExtraPorId, simCon, extra }) {
  const html = generarInformeHTML({ perfil, resultadosPorId, sinExtraPorId, simCon, extra });
  const fecha = new Date().toISOString().slice(0, 10);
  const nombre = perfil.nombre.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `prioriza-informe-${nombre}-${fecha}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// APP PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const secEnabled = !!localStorage.getItem(SEC_KEYS.enabled);
  const [unlocked, setUnlocked] = useState(!secEnabled);
  if (!unlocked) return <LockScreen onUnlock={() => setUnlocked(true)} />;
  return <AppInner />;
}

function AppInner() {
  const {
    perfiles, perfilActivo, perfil, items, extraGlobal, huchaActual, rentHuchaGlobal, saved,
    crearPerfil, renombrarPerfil, eliminarPerfil, seleccionarPerfil, duplicarPerfil,
    addItem, editItem, deleteItem, reordenarItems, aplicarOrden,
    setExtraGlobal, setHuchaActual, setRentHuchaGlobal, exportarBackup, restaurarBackup, exportarParaIA,
  } = useDeudaStore();

  const esHipoteca = perfil?.tipo === "hipoteca";

  const [modal, setModal] = useState(null);
  const [modalIA, setModalIA] = useState(null); // { texto: string }
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const touchRef = useRef({ startY: 0, id: null, order: null });

  // ── Ayuda ────────────────────────────────────────────────────────────────
  const [mostrarAyuda, setMostrarAyuda] = useState(false);
  const [mostrarOnboarding, setMostrarOnboarding] = useState(() => {
    return !localStorage.getItem("bdn_onboarding_done");
  });
  const cerrarOnboarding = () => {
    localStorage.setItem("bdn_onboarding_done", "1");
    setMostrarOnboarding(false);
    if (Object.keys(perfiles).length === 0) {
      setModal("perfiles");
    }
  };
  const reabrirOnboarding = () => {
    setMostrarAyuda(false);
    setMostrarOnboarding(true);
  };

  const extra = parseFloat(extraGlobal) || 0;
  const hucha = parseFloat(huchaActual) || 0;

  // ── Simulación consumo ────────────────────────────────────────────────────
  const itemsSim = useMemo(() => items.filter(it => it.tipo !== "hipoteca").map((it) => ({
    id: it.id, tipo: it.tipo, nombre: it.nombre, pendiente: it.pendiente,
    tasaAnual: it.tasaAnual, cuotaFija: it.cuotaFija, cuotaElegida: it.cuotaElegida,
    limiteCredito: it.limiteCredito ?? 3200, comisionPct: it.comisionPct || 0,
  })), [items]);

  // Hipotecas se simulan por separado
  const itemsHipoteca = useMemo(() => items.filter(it => it.tipo === "hipoteca"), [items]);

  const simCon = useMemo(
    () => itemsSim.length > 0 ? simularBolaDeNieve(itemsSim, extra) : null,
    [itemsSim, extra]
  );

  const sinExtraPorId = useMemo(() => {
    const result = {};
    for (const it of itemsSim) {
      result[it.id] = simularSinExtra(it);
    }
    // Simulación hipotecas sin hucha
    for (const it of itemsHipoteca) {
      const filasRef = simularHipotecaVariable({
        capitalInicial: it.pendiente, mesesRestantes: it.mesesRestantes || 360,
        diferencial: it.diferencial || 0, euriborActual: it.euribor || 0,
        mesRevision: it.mesRevision || 6, minimoAmortizacion: it.minimoAmortizacion || 9999999,
        extraMensual: 0, comisionAmortPct: 0, huchaInicial: 0, maxMeses: 600,
      });
      result[it.id] = {
        meses: filasRef.length,
        interesesPagados: filasRef.reduce((s, f) => s + f.interesMes, 0),
      };
    }
    return result;
  }, [itemsSim, itemsHipoteca]);

  const resultadosPorId = useMemo(() => {
    const result = {};
    // Consumo
    for (const it of itemsSim) {
      const sin = sinExtraPorId[it.id];
      const con = simCon?.resultadosPorId[it.id];
      result[it.id] = {
        mesesSin: sin.meses,
        mesesCon: con?.mesesCon ?? sin.meses,
        interesesSin: sin.interesesPagados,
        interesesCon: con?.interesesCon ?? sin.interesesPagados,
        ahorro: sin.interesesPagados - (con?.interesesCon ?? sin.interesesPagados),
        mesesAhorrados: sin.meses - (con?.mesesCon ?? sin.meses),
      };
    }
    // Hipotecas
    for (const it of itemsHipoteca) {
      const sin = sinExtraPorId[it.id];
      const rH = (parseFloat(rentHuchaGlobal) || 0) / 100 / 12;
      const filasCon = simularHipotecaVariable({
        capitalInicial: it.pendiente, mesesRestantes: it.mesesRestantes || 360,
        diferencial: it.diferencial || 0, euriborActual: it.euribor || 0,
        mesRevision: it.mesRevision || 6, minimoAmortizacion: it.minimoAmortizacion || 3000,
        extraMensual: extra, comisionAmortPct: it.comisionPct || 0,
        huchaInicial: hucha, maxMeses: 600, rentHucha: rH,
      });
      const intCon = filasCon.reduce((s, f) => s + f.interesMes, 0);
      const mesesCon = filasCon.length;
      result[it.id] = {
        mesesSin: sin.meses,
        mesesCon,
        interesesSin: sin.interesesPagados,
        interesesCon: intCon,
        ahorro: sin.interesesPagados - intCon,
        mesesAhorrados: sin.meses - mesesCon,
      };
    }
    return result;
  }, [itemsSim, itemsHipoteca, sinExtraPorId, simCon, extra, hucha, rentHuchaGlobal]);

  // Métricas globales
  const interesesTotalesSin = useMemo(
    () => Object.values(sinExtraPorId).reduce((s, r) => s + r.interesesPagados, 0),
    [sinExtraPorId]
  );
  const ahorroTotal = useMemo(() => simCon
    ? itemsSim.reduce((s, it) => s + (sinExtraPorId[it.id]?.interesesPagados || 0), 0) - simCon.interesesTotales
    : 0,
    [simCon, sinExtraPorId, itemsSim]
  );
  const cuotaTotalActual = useMemo(() => items.reduce((s, it) => s + (it.cuotaFija || 0), 0), [items]);
  const pendienteTotal = useMemo(() => items.reduce((s, it) => s + (it.pendiente || 0), 0), [items]);
  const mesesGlobalSin = useMemo(
    () => items.length > 0 ? Math.max(...items.map(it => sinExtraPorId[it.id]?.meses ?? 0)) : 0,
    [items, sinExtraPorId]
  );
  const mesesGlobalCon = simCon?.plazoGlobal ?? 0;
  const mesesGlobalAhorrados = mesesGlobalSin - mesesGlobalCon;

  const fechaFinSin = mesesGlobalSin > 0 ? addMonths(mesesGlobalSin) : null;
  const fechaFinCon = mesesGlobalCon > 0 ? addMonths(mesesGlobalCon) : null;

  const escenarios = useMemo(
    () => esHipoteca ? [] : calcularEscenarios(itemsSim, extra),
    [esHipoteca, itemsSim, extra]
  );

  // ── Métricas globales hipoteca ────────────────────────────────────────────
  // Se calculan siempre (aunque el perfil sea consumo no se usan)
  const hipInteresesSin = useMemo(
    () => itemsHipoteca.reduce((s, it) => s + (sinExtraPorId[it.id]?.interesesPagados ?? 0), 0),
    [itemsHipoteca, sinExtraPorId]
  );
  const hipInteresesCon = useMemo(
    () => itemsHipoteca.reduce((s, it) => s + (resultadosPorId[it.id]?.interesesCon ?? 0), 0),
    [itemsHipoteca, resultadosPorId]
  );
  const hipAhorroIntereses = hipInteresesSin - hipInteresesCon;
  const hipMesesSin = useMemo(
    () => itemsHipoteca.length > 0 ? Math.max(...itemsHipoteca.map(it => sinExtraPorId[it.id]?.meses ?? 0)) : 0,
    [itemsHipoteca, sinExtraPorId]
  );
  const hipMesesCon = useMemo(
    () => itemsHipoteca.length > 0 ? Math.max(...itemsHipoteca.map(it => resultadosPorId[it.id]?.mesesCon ?? 0)) : 0,
    [itemsHipoteca, resultadosPorId]
  );
  const hipMesesAhorrados = hipMesesSin - hipMesesCon;
  const hipFechaFinSin = hipMesesSin > 0 ? addMonths(hipMesesSin) : null;
  const hipFechaFinCon = hipMesesCon > 0 ? addMonths(hipMesesCon) : null;

  const handleAddItem = useCallback((item) => { addItem(item); setModal(null); }, [addItem]);
  const handleEditItem = useCallback((item) => { editItem(item); setModal(null); }, [editItem]);

  const moveItem = (idx, dir) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= items.length) return;
    const movedId = items[idx].id;
    reordenarItems(idx, newIdx);
    requestAnimationFrame(() => {
      const target = document.querySelector(`[data-item-id="${movedId}"]`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "nearest" });
        target.classList.remove("card-flash");
        void target.offsetWidth;
        target.classList.add("card-flash");
        setTimeout(() => target.classList.remove("card-flash"), 650);
      }
    });
  };

  const handleTouchStart = useCallback((e, id) => {
    const touch = e.touches[0];
    touchRef.current = { startY: touch.clientY, id, order: items.map((it) => it.id) };
    setDraggingId(id);
  }, [items]);

  const handleTouchMove = useCallback((e) => {
    if (!touchRef.current.id) return;
    e.preventDefault();
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const card = el?.closest("[data-item-id]");
    if (card) {
      const overId = card.getAttribute("data-item-id");
      if (overId && overId !== touchRef.current.id) setDragOverId(overId);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (touchRef.current.id && dragOverId) {
      const fromIdx = items.findIndex((it) => it.id === touchRef.current.id);
      const toIdx = items.findIndex((it) => it.id === dragOverId);
      if (fromIdx !== -1 && toIdx !== -1) reordenarItems(fromIdx, toIdx);
    }
    setDraggingId(null);
    setDragOverId(null);
    touchRef.current = { startY: 0, id: null, order: null };
  }, [dragOverId, items, reordenarItems]);

  const handleDragStart = useCallback((e, id) => { e.dataTransfer.effectAllowed = "move"; setDraggingId(id); }, []);
  const handleDragOver = useCallback((e, id) => { e.preventDefault(); setDragOverId(id); }, []);
  const handleDrop = useCallback((id) => {
    if (draggingId && id !== draggingId) {
      const fi = items.findIndex((it) => it.id === draggingId);
      const ti = items.findIndex((it) => it.id === id);
      if (fi !== -1 && ti !== -1) reordenarItems(fi, ti);
    }
    setDraggingId(null);
    setDragOverId(null);
  }, [draggingId, items, reordenarItems]);

  // Sin perfiles: pantalla de bienvenida mínima
  if (!perfil) return (
    <>
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center px-6 gap-6"
      style={{ fontFamily: "'DM Sans', 'Segoe UI', sans-serif" }}>
      <div className="text-center">
        <div className="text-5xl mb-4">🎯</div>
        <h1 className="text-2xl font-black text-slate-100 mb-2">Bienvenido a Prioriza</h1>
        <p className="text-sm text-slate-400 leading-relaxed">Crea tu primer perfil para empezar a gestionar tus finanzas</p>
      </div>
      <button
        onClick={() => setModal("perfiles")}
        className="w-full max-w-xs py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-base transition shadow-lg shadow-indigo-900/40">
        Crear mi primer perfil →
      </button>
    </div>
    {modal === "perfiles" && (
      <Modal title="Perfiles" onClose={() => setModal(null)}>
        <ModalPerfiles
          perfiles={perfiles}
          perfilActivo={perfilActivo}
          onSeleccionar={(id) => { seleccionarPerfil(id); setModal(null); }}
          onCrear={crearPerfil}
          onRenombrar={renombrarPerfil}
          onEliminar={eliminarPerfil}
          onDuplicar={(id) => { duplicarPerfil(id); setModal(null); }}
          onClose={() => setModal(null)}
        />
      </Modal>
    )}
    {modal === "ajustes" && (
      <Modal title="Ajustes" onClose={() => setModal(null)}>
        <GestionDatos onExportar={exportarBackup} onRestaurar={restaurarBackup} />
      </Modal>
    )}
    {mostrarOnboarding && <Onboarding onFin={cerrarOnboarding} />}
    {mostrarAyuda && <PanelAyuda onCerrar={() => setMostrarAyuda(false)} onVerOnboarding={reabrirOnboarding} />}
    </>
  );

  return (
    <>
    <div className="min-h-screen bg-slate-950 text-slate-100" style={{ fontFamily: "'DM Sans', 'Segoe UI', sans-serif" }}>

      {/* Header */}
      <div className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur border-b border-slate-800 px-4 py-3">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-base font-black tracking-tight text-slate-100">
              {esHipoteca ? "🏠 Prioriza" : "💸 Prioriza"}
            </h1>
            <p className="text-xs text-slate-500">
              {esHipoteca ? "Hipoteca variable + hucha" : "Gestión de deudas"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-emerald-500">{saved ? "✓ guardado" : "guardando…"}</span>
            <button
              onClick={() => setMostrarAyuda(true)}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-800 border border-slate-700 hover:border-indigo-500 text-slate-400 hover:text-indigo-300 transition text-sm font-black"
              title="Ayuda"
            >?</button>
            <button
              onClick={exportarParaIA}
              className="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-800 border border-slate-700 hover:border-violet-500 hover:bg-violet-950/40 text-slate-400 hover:text-violet-300 transition text-base"
              title="Exportar contexto para IA"
            >🤖</button>
            <button
              onClick={() => setModal("ajustes")}
              className="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-800 border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 transition text-base"
              title="Ajustes"
            >⚙️</button>
            <button
              onClick={() => setModal("perfiles")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 hover:border-indigo-500 active:bg-slate-700 transition text-sm"
            >
              <span className="text-slate-200 font-semibold max-w-[100px] truncate">{perfil?.nombre || "Perfil"}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-4 space-y-4">

        {/* ── PANEL HIPOTECA ── */}
        {esHipoteca && (
          <>
            {/* Proyección global: condiciones + intereses + fechas */}
            {items.length > 0 && hipMesesSin > 0 && (
              <div className="bg-gradient-to-br from-sky-950/70 to-blue-950/60 rounded-2xl border border-sky-800/40 p-4">
                <h2 className="text-xs font-bold text-sky-400 uppercase tracking-widest mb-3">Proyección global · Euríbor fijo</h2>

                {/* Condiciones actuales */}
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <div className="bg-slate-800/50 rounded-xl p-3 text-center">
                    <p className="text-xs text-slate-500 mb-1">Capital total</p>
                    <p className="text-sm font-bold text-slate-100">{fmt(pendienteTotal)} €</p>
                  </div>
                  <div className="bg-slate-800/50 rounded-xl p-3 text-center">
                    <p className="text-xs text-slate-500 mb-1">Cuota/mes</p>
                    <p className="text-sm font-bold text-slate-100">{fmt(cuotaTotalActual)} €</p>
                  </div>
                  <div className="bg-slate-800/50 rounded-xl p-3 text-center">
                    <p className="text-xs text-slate-500 mb-1">Intereses sin hucha</p>
                    <p className="text-sm font-bold text-red-400">{fmt(hipInteresesSin, 2)} €</p>
                  </div>
                </div>

                {/* Cifras de intereses */}
                <div className="space-y-2 mb-4">
                  <div className="bg-sky-900/30 border border-sky-700/40 rounded-xl px-4 py-3 flex items-center justify-between">
                    <p className="text-xs font-bold text-sky-400 uppercase tracking-wider">Ahorro en intereses</p>
                    <p className="text-xl font-black text-sky-300 font-mono">{fmt(hipAhorroIntereses, 2)} €</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-slate-800/50 rounded-xl px-3 py-2.5 text-center">
                      <p className="text-xs text-slate-500 mb-1">Sin hucha</p>
                      <p className="text-base font-bold text-slate-300 font-mono">{fmt(hipInteresesSin, 2)} €</p>
                    </div>
                    <div className="bg-blue-950/40 border border-blue-800/30 rounded-xl px-3 py-2.5 text-center">
                      <p className="text-xs text-blue-500 mb-1">Con hucha</p>
                      <p className="text-base font-bold text-blue-300 font-mono">{fmt(hipInteresesCon, 2)} €</p>
                    </div>
                  </div>
                </div>

                {/* Fechas fin */}
                {hipFechaFinSin && hipFechaFinCon && (
                  <div className="border-t border-sky-800/30 pt-3">
                    <p className="text-xs font-bold text-sky-500 uppercase tracking-widest mb-2">Fecha libre de hipoteca</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-800/60 rounded-xl p-2.5 text-center">
                        <p className="text-xs text-slate-500 mb-0.5">Sin hucha</p>
                        <p className="text-base font-black text-slate-300">{hipFechaFinSin}</p>
                        <p className="text-xs text-slate-500">{fmtM(hipMesesSin)}</p>
                      </div>
                      <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
                        <span className="text-sky-400 text-lg">→</span>
                        {hipMesesAhorrados > 0 && (
                          <span className="text-xs font-bold text-sky-400">-{fmtM(hipMesesAhorrados)}</span>
                        )}
                      </div>
                      <div className="flex-1 bg-sky-900/30 border border-sky-700/40 rounded-xl p-2.5 text-center">
                        <p className="text-xs text-sky-500 mb-0.5">Con hucha</p>
                        <p className="text-base font-black text-sky-300">{hipFechaFinCon}</p>
                        <p className="text-xs text-sky-600">{fmtM(hipMesesCon)}</p>
                      </div>
                    </div>
                  </div>
                )}

                <p className="text-xs text-slate-600 mt-3 italic">
                  ⚠ Proyección teórica asumiendo euríbor constante. La cuota real cambia en cada revisión.
                </p>
              </div>
            )}

            {/* Hucha: barra + inputs integrados */}
            {items.length > 0 && (
              <HuchaIndicador
                hucha={hucha}
                minimo={items[0]?.minimoAmortizacion || 3000}
                extraMensual={extra}
                compact={false}
                huchaValue={huchaActual}
                extraValue={extraGlobal}
                rentHuchaValue={rentHuchaGlobal}
                onHuchaChange={setHuchaActual}
                onExtraChange={setExtraGlobal}
                onRentHuchaChange={setRentHuchaGlobal}
              />
            )}
          </>
        )}

        {/* ── PANEL CONSUMO ── */}
        {!esHipoteca && (
          <>
            {items.length > 0 && (
              <div className="bg-slate-900 rounded-2xl border border-slate-700 p-4">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Condiciones iniciales</h2>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-slate-800/60 rounded-xl p-3 text-center">
                    <p className="text-xs text-slate-500 mb-1">Pendiente total</p>
                    <p className="text-sm font-bold text-slate-100">{fmt(pendienteTotal)} €</p>
                  </div>
                  <div className="bg-slate-800/60 rounded-xl p-3 text-center">
                    <p className="text-xs text-slate-500 mb-1">Cuota mensual</p>
                    <p className="text-sm font-bold text-slate-100">{fmt(cuotaTotalActual)} €/m</p>
                  </div>
                  <div className="bg-slate-800/60 rounded-xl p-3 text-center">
                    <p className="text-xs text-slate-500 mb-1">Intereses sin plan</p>
                    <p className="text-sm font-bold text-red-400">{fmt(interesesTotalesSin)} €</p>
                  </div>
                </div>
              </div>
            )}

            {items.length > 0 && (ahorroTotal > 0 || mesesGlobalSin > 0) && (
              <div className="bg-gradient-to-br from-emerald-950/60 to-teal-950/60 rounded-2xl border border-emerald-800/40 p-4">
                <h2 className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-3">Resumen del plan</h2>
                <div className="mb-4">
                  <label className="text-xs font-semibold text-emerald-500 uppercase tracking-wider block mb-1">Aportación extra mensual</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={extraGlobal}
                      onChange={(e) => setExtraGlobal(e.target.value)}
                      className="w-full bg-slate-800/60 border border-emerald-800/50 rounded-xl px-3 py-2.5 pr-10 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      placeholder="0"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">€/mes</span>
                  </div>
                </div>
                <div className="flex justify-around mb-4">
                  <div className="text-center">
                    <p className="text-2xl font-black text-emerald-300">{fmt(ahorroTotal)} €</p>
                    <p className="text-xs text-emerald-600">ahorrado en intereses</p>
                  </div>
                  <div className="w-px bg-emerald-800/40" />
                  <div className="text-center">
                    <p className="text-2xl font-black text-teal-300">{fmt(simCon?.interesesTotales ?? interesesTotalesSin)} €</p>
                    <p className="text-xs text-teal-600">intereses con el plan</p>
                  </div>
                </div>
                {fechaFinSin && fechaFinCon && (
                  <div className="border-t border-emerald-800/30 pt-3">
                    <p className="text-xs font-bold text-emerald-500 uppercase tracking-widest mb-2">Fecha libre de deudas</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-800/60 rounded-xl p-2.5 text-center">
                        <p className="text-xs text-slate-500 mb-0.5">Sin plan</p>
                        <p className="text-base font-black text-slate-300">{fechaFinSin}</p>
                        <p className="text-xs text-slate-500">{fmtM(mesesGlobalSin)}</p>
                      </div>
                      <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
                        <span className="text-emerald-400 text-lg">→</span>
                        {mesesGlobalAhorrados > 0 && <span className="text-xs font-bold text-emerald-400">-{fmtM(mesesGlobalAhorrados)}</span>}
                      </div>
                      <div className="flex-1 bg-emerald-900/30 border border-emerald-700/40 rounded-xl p-2.5 text-center">
                        <p className="text-xs text-emerald-500 mb-0.5">Con plan</p>
                        <p className="text-base font-black text-emerald-300">{fechaFinCon}</p>
                        <p className="text-xs text-emerald-600">{fmtM(mesesGlobalCon)}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {items.length >= 2 && escenarios.length > 0 && (
              <div className="bg-slate-900 rounded-2xl border border-slate-700 p-4">
                <ComparadorEscenarios
                  escenarios={escenarios}
                  mesesGlobalSin={mesesGlobalSin}
                  onSeleccionar={(orden) => aplicarOrden(orden)}
                />
              </div>
            )}
          </>
        )}

        {/* Lista de items */}
        {items.length === 0 ? (
          <div className="text-center py-12 text-slate-600">
            <p className="text-4xl mb-3">{esHipoteca ? "🏠" : "📋"}</p>
            <p className="text-sm">
              {esHipoteca ? "Añade tu primera hipoteca variable" : "Añade tu primer préstamo o tarjeta"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {!esHipoteca && (
              <p className="text-xs text-slate-500 text-center">Arrastra para reordenar · El orden define la bola de nieve</p>
            )}
            {items.map((item, idx) => (
              <div
                key={item.id}
                data-item-id={item.id}
                draggable={!esHipoteca}
                onDragStart={(e) => handleDragStart(e, item.id)}
                onDragOver={(e) => handleDragOver(e, item.id)}
                onDrop={() => handleDrop(item.id)}
                onDragEnd={() => { setDraggingId(null); setDragOverId(null); }}
                className={`transition-transform ${dragOverId === item.id && draggingId !== item.id ? "scale-[1.02] ring-2 ring-indigo-500 rounded-2xl" : ""}`}
              >
                {item.tipo === "hipoteca" ? (
                  <HipotecaCard
                    item={item}
                    resultado={resultadosPorId[item.id]}
                    idx={idx}
                    total={items.length}
                    dragging={draggingId === item.id}
                    onEdit={(it) => setModal({ edit: it })}
                    onDelete={deleteItem}
                    onActualizar={(it) => setModal({ actualizar: it })}
                    onMoveUp={() => moveItem(idx, -1)}
                    onMoveDown={() => moveItem(idx, 1)}
                    dragHandlers={{
                      onTouchStart: (e) => handleTouchStart(e, item.id),
                      onTouchMove: handleTouchMove,
                      onTouchEnd: handleTouchEnd,
                    }}
                    extraMensual={extraGlobal}
                    huchaActual={huchaActual}
                    rentHuchaGlobal={rentHuchaGlobal}
                  />
                ) : (
                  <ItemCard
                    item={item}
                    resultado={resultadosPorId[item.id]}
                    idx={idx}
                    total={items.length}
                    dragging={draggingId === item.id}
                    onEdit={(it) => setModal({ edit: it })}
                    onDelete={deleteItem}
                    onActualizar={(it) => setModal({ actualizar: it })}
                    onMoveUp={() => moveItem(idx, -1)}
                    onMoveDown={() => moveItem(idx, 1)}
                    dragHandlers={{
                      onTouchStart: (e) => handleTouchStart(e, item.id),
                      onTouchMove: handleTouchMove,
                      onTouchEnd: handleTouchEnd,
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Botones añadir */}
        {esHipoteca ? (
          <button
            onClick={() => setModal("addHipoteca")}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-sky-600 text-white text-sm font-semibold hover:bg-sky-500 transition shadow-lg shadow-sky-900/30"
          >
            <span>+ Hipoteca variable</span>
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setModal("addPrestamo")} className="flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 transition shadow-lg shadow-indigo-900/30">
              <span>+ Préstamo</span>
            </button>
            <button onClick={() => setModal("addTargeta")} className="flex items-center justify-center gap-2 py-3 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-500 transition shadow-lg shadow-violet-900/30">
              <span>+ Tarjeta</span>
            </button>
          </div>
        )}

        {items.length > 0 && (
          <button onClick={() => descargarInforme({ perfil, resultadosPorId, sinExtraPorId, simCon, extra })} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-slate-600 text-slate-300 text-sm font-semibold hover:bg-slate-800 hover:border-slate-500 transition">
            <span>📄</span><span>Descargar informe</span>
          </button>
        )}

        {/* ── MÓDULO ESTRATEGIA DE RIQUEZA (solo hipoteca) ── */}
        {esHipoteca && items.length > 0 && (
          <EstrategiaRiqueza
            items={items}
            extraMensual={extraGlobal}
            huchaActual={huchaActual}
            rentHucha={rentHuchaGlobal}
          />
        )}

        {/* ── DONATIVO ── */}
        <div className="flex justify-center pb-2">
          <a href="https://ko-fi.com/prioriza" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-700/60 text-slate-500 hover:text-amber-400 hover:border-amber-700/50 hover:bg-amber-950/20 transition text-xs">
            <span>🍺</span>
            <span>¿Te ayuda Prioriza? Invítame a una cerveza</span>
          </a>
        </div>

      </div>

      {/* ── MODALES ── */}
      {modal === "ajustes" && (
        <Modal title="Ajustes" onClose={() => setModal(null)}>
          <GestionDatos onExportar={exportarBackup} onRestaurar={restaurarBackup} />
        </Modal>
      )}
      {modal === "perfiles" && (
        <Modal title="Perfiles" onClose={() => setModal(null)}>
          <ModalPerfiles
            perfiles={perfiles}
            perfilActivo={perfilActivo}
            onSeleccionar={(id) => seleccionarPerfil(id)}
            onCrear={crearPerfil}
            onRenombrar={renombrarPerfil}
            onEliminar={eliminarPerfil}
            onDuplicar={(id) => { duplicarPerfil(id); setModal(null); }}
            onClose={() => setModal(null)}
          />
        </Modal>
      )}
      {modal === "addHipoteca" && (
        <Modal title="Nueva hipoteca variable" onClose={() => setModal(null)}>
          <FormHipoteca onSave={handleAddItem} onCancel={() => setModal(null)} />
        </Modal>
      )}
      {modal === "addPrestamo" && (
        <Modal title="Nuevo préstamo" onClose={() => setModal(null)}>
          <FormPrestamo onSave={handleAddItem} onCancel={() => setModal(null)} />
        </Modal>
      )}
      {modal === "addTargeta" && (
        <Modal title="Nueva tarjeta de crédito" onClose={() => setModal(null)}>
          <FormTargeta onSave={handleAddItem} onCancel={() => setModal(null)} />
        </Modal>
      )}
      {modal?.edit && (
        <Modal title={`Editar · ${modal.edit.nombre}`} onClose={() => setModal(null)}>
          {modal.edit.tipo === "hipoteca"
            ? <FormHipoteca initial={modal.edit} onSave={handleEditItem} onCancel={() => setModal(null)} />
            : modal.edit.tipo === "prestamo"
            ? <FormPrestamo initial={modal.edit} onSave={handleEditItem} onCancel={() => setModal(null)} />
            : <FormTargeta initial={modal.edit} onSave={handleEditItem} onCancel={() => setModal(null)} />
          }
        </Modal>
      )}
      {modal?.actualizar && (
        <ModalActualizar
          item={modal.actualizar}
          onClose={() => setModal(null)}
          onSave={(updated) => { editItem(updated); setModal(null); }}
        />
      )}
    </div>
    {/* ── OVERLAYS ── */}
    {mostrarOnboarding && <Onboarding onFin={cerrarOnboarding} />}
    {mostrarAyuda && (
      <PanelAyuda
        onCerrar={() => setMostrarAyuda(false)}
        onVerOnboarding={reabrirOnboarding}
      />
    )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MÓDULO: ESTRATEGIA DE RIQUEZA — MOTOR FINANCIERO
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// MÓDULO: ESTRATEGIA DE RIQUEZA — MOTOR (bucle único mes a mes)
// Flujo de caja idéntico: ambos desembolsan cuota+extra cada mes.
// A: extra → hucha (con rentHucha) → amortiza al llegar minAmort
//    al liquidar → invierte cuotaOrig+extra en fondo
// B: paga cuota normal → extra al fondo desde mes 1
// ─────────────────────────────────────────────────────────────────────────────
function calcularEstrategias({
  cap, tin, mesesTotal, extra, minAmort, mesRevision,
  rentHucha, rentSP, comFondo, impuesto,
  huchaInicial = 0, comisionAmortPct = 0,
  diferencial = 0, euriborActual = 0,
}) {
  const cuotaOrig = cuotaFrancesa(cap, tin, mesesTotal);
  const rInv = (rentSP - comFondo) / 100 / 12;
  const rH   = rentHucha / 100 / 12;
  const imp  = impuesto / 100;
  const r    = tin / 100 / 12;

  const hoy    = new Date();
  const mesHoy = hoy.getMonth() + 1;

  // ── Bucle único mes a mes para A, B, historial e intB ──────────────────────
  let capA = cap, mRA = mesesTotal, hA = huchaInicial, cA = cuotaOrig;
  let capB = cap, mRB = mesesTotal, cB = cuotaOrig;
  let fondoA = 0, aportFA = 0, intA = 0, comA = 0, mesLiqA = null;
  let fondoB = 0, aportFB = 0, intB = 0;
  const hist = [];

  for (let mes = 1; mes <= mesesTotal; mes++) {
    const mesAbs = mesHoy + mes - 1;
    const mc = ((mesAbs - 1) % 12) + 1;

    // ── A: hucha con rentabilidad → amortiza al llegar mínimo ──────────────
    if (capA > 0.01) {
      if (mc === mesRevision && mes > 1) cA = cuotaFrancesa(capA, tin, mRA);
      const iA = capA * r;
      intA += iA;
      const amC = Math.min(cA - iA, capA);
      capA = Math.max(0, capA - amC);
      mRA = Math.max(0, mRA - 1);
      hA = rH > 0 ? hA * (1 + rH) + extra : hA + extra;

      if (capA > 0.01 && capA <= minAmort && hA >= capA) {
        // Capital residual pequeño: liquidar con hucha solo si la hucha lo cubre
        comA += capA * (comisionAmortPct / 100);
        hA = Math.max(0, hA - capA);
        capA = 0;
        mesLiqA = mes;
      } else if (hA >= minAmort) {
        const amE = Math.floor(hA / minAmort) * minAmort;
        comA += amE * (comisionAmortPct / 100);
        capA = Math.max(0, capA - amE);
        hA -= amE;
        if (capA <= 0.01) { capA = 0; mesLiqA = mes; }
      }
    } else {
      // Hipoteca liquidada: invertir cuota liberada + extra
      fondoA = fondoA * (1 + rInv) + (cuotaOrig + extra);
      aportFA += (cuotaOrig + extra);
    }

    // ── B: solo cuota normal, extra íntegro al fondo desde mes 1 ───────────
    if (capB > 0.01) {
      if (mc === mesRevision && mes > 1) cB = cuotaFrancesa(capB, tin, mRB);
      const iB = capB * r;
      intB += iB;
      const amCB = Math.min(cB - iB, capB);
      capB = Math.max(0, capB - amCB);
      mRB = Math.max(0, mRB - 1);
    }
    fondoB = fondoB * (1 + rInv) + extra;
    aportFB += extra;

    hist.push({ mes, liqA: fondoA + hA, liqB: fondoB });
  }

  const mInvA = mesLiqA ? mesesTotal - mesLiqA : 0;

  // Patrimonios netos (IRPF solo sobre plusvalías)
  const pvA  = Math.max(0, fondoA - aportFA);
  const ANet = fondoA - pvA * imp;
  const pvB  = Math.max(0, fondoB - aportFB);
  const BNet = fondoB - pvB * imp;

  let crossover = null;
  for (const h of hist) {
    if (mesLiqA && h.mes > mesLiqA && h.liqA > h.liqB) { crossover = h.mes; break; }
  }

  return {
    cuotaOrig, mesLiqA,
    mInvA,
    fondoA, aportFA, pvA, ANet,
    fondoB, aportFB, pvB, BNet,
    intA, comA, intB,
    ahorroIntereses: Math.max(0, intB - intA),
    crossover, hist,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE: SPARKLINE EVOLUCIÓN
// ─────────────────────────────────────────────────────────────────────────────
function SparklineEvolucion({ hist, mesLiqA, crossover, mesesTotal }) {
  if (!hist || hist.length === 0) return null;
  const W = 300, H = 72;
  const maxVal = Math.max(...hist.map(h => Math.max(h.liqA, h.liqB)), 1);
  const px = mes => (mes / mesesTotal) * W;
  const py = val => H - (val / maxVal) * H;
  const pathA = hist.map((h, i) => `${i === 0 ? "M" : "L"}${px(h.mes).toFixed(1)},${py(h.liqA).toFixed(1)}`).join(" ");
  const pathB = hist.map((h, i) => `${i === 0 ? "M" : "L"}${px(h.mes).toFixed(1)},${py(h.liqB).toFixed(1)}`).join(" ");
  return (
    <div className="w-full">
      <svg width="100%" viewBox={`0 0 ${W} ${H + 18}`} style={{ display: "block" }}>
        {mesLiqA && <line x1={px(mesLiqA)} y1={0} x2={px(mesLiqA)} y2={H} stroke="#6366f1" strokeWidth="1" strokeDasharray="3,3" opacity="0.7" />}
        {crossover && <line x1={px(crossover)} y1={0} x2={px(crossover)} y2={H} stroke="#f59e0b" strokeWidth="1" strokeDasharray="3,3" opacity="0.9" />}
        <path d={pathB} fill="none" stroke="#7c3aed" strokeWidth="1.5" opacity="0.85" />
        <path d={pathA} fill="none" stroke="#10b981" strokeWidth="1.5" opacity="0.85" />
        <circle cx={6} cy={H + 11} r={3} fill="#10b981" />
        <text x={12} y={H + 15} fontSize={8} fill="#64748b">A (líquido)</text>
        <circle cx={68} cy={H + 11} r={3} fill="#7c3aed" />
        <text x={74} y={H + 15} fontSize={8} fill="#64748b">B</text>
        {mesLiqA && <>
          <line x1={126} y1={H + 8} x2={138} y2={H + 8} stroke="#6366f1" strokeWidth="1" strokeDasharray="3,3" />
          <text x={142} y={H + 12} fontSize={8} fill="#64748b">Hip. libre</text>
        </>}
        {crossover && <>
          <line x1={196} y1={H + 8} x2={208} y2={H + 8} stroke="#f59e0b" strokeWidth="1" strokeDasharray="3,3" />
          <text x={212} y={H + 12} fontSize={8} fill="#64748b">Crossover</text>
        </>}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE: ESTRATEGIA DE RIQUEZA
// ─────────────────────────────────────────────────────────────────────────────
function EstrategiaRiqueza({ items, extraMensual, huchaActual, rentHucha }) {
  const hipoteca = items.find(it => it.tipo === "hipoteca");

  const [config, setConfig] = useState({
    rentSP: "9.5", impuesto: "19", comFondo: "0.2",
  });
  const setC = k => e => setConfig(p => ({ ...p, [k]: e.target.value }));

  const extra = parseFloat(extraMensual) || 0;

  const res = useMemo(() => {
    if (!hipoteca?.pendiente || !hipoteca?.mesesRestantes) return null;
    const tin = (hipoteca.diferencial || 0) + (hipoteca.euribor || 0);
    try {
      return calcularEstrategias({
        cap:              hipoteca.pendiente,
        tin,
        mesesTotal:       hipoteca.mesesRestantes,
        extra,
        minAmort:         hipoteca.minimoAmortizacion || 3000,
        mesRevision:      hipoteca.mesRevision || 6,
        diferencial:      hipoteca.diferencial || 0,
        euriborActual:    hipoteca.euribor || 0,
        comisionAmortPct: hipoteca.comisionPct || 0,
        huchaInicial:     parseFloat(huchaActual) || 0,
        rentHucha:        parseFloat(rentHucha)         || 0,
        rentSP:           parseFloat(config.rentSP)     || 0,
        comFondo:         parseFloat(config.comFondo)   || 0,
        impuesto:         parseFloat(config.impuesto)   || 0,
      });
    } catch { return null; }
  }, [hipoteca, extra, huchaActual, rentHucha, config]);

  if (!hipoteca) return null;

  const tin = (hipoteca.diferencial || 0) + (hipoteca.euribor || 0);
  const ganaB = res && res.BNet > res.ANet;
  const difE  = res ? Math.abs(res.BNet - res.ANet) : 0;
  const difP  = res ? difE / Math.max(res.ANet, 1) * 100 : 0;

  const CfgInput = ({ label, field, hint }) => (
    <div className="flex flex-col gap-0.5">
      <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">{label}</label>
      <div className="relative">
        <input type="number" value={config[field]} onChange={setC(field)} step="0.1"
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 pr-5 text-xs text-slate-100 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 text-[9px]">%</span>
      </div>
      {hint && <p className="text-[8px] text-slate-600">{hint}</p>}
    </div>
  );

  const Row = ({ label, valA, valB, cA = "text-slate-300", cB = "text-slate-300", bold }) => (
    <div className={`grid grid-cols-3 gap-1 text-xs py-0.5 ${bold ? "border-t border-slate-700/60 pt-1.5 mt-0.5" : ""}`}>
      <span className="text-[10px] text-slate-500 leading-tight">{label}</span>
      <span className={`text-right font-mono ${cA} ${bold ? "font-black text-sm" : ""}`}>{valA}</span>
      <span className={`text-right font-mono ${cB} ${bold ? "font-black text-sm" : ""}`}>{valB}</span>
    </div>
  );

  return (
    <div className="bg-slate-900 rounded-2xl border border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-700/60"
        style={{ background: "linear-gradient(135deg,#0f172a,#1e1b4b)" }}>
        <p className="text-sm font-black text-slate-100">📈 Estrategia de Riqueza</p>
        <p className="text-[10px] text-indigo-400 mt-0.5">
          TIN {fmt(tin, 2)}% · {hipoteca.mesesRestantes} meses · extra {fmt(extra, 0)} €/mes
          · flujo {fmt((res?.cuotaOrig || 0) + extra, 0)} €/mes
        </p>
      </div>

      <div className="p-4 space-y-4">
        {/* Config */}
        <div className="grid grid-cols-3 gap-2">
          <CfgInput label="S&P 500" field="rentSP" hint="~9.5% hist." />
          <CfgInput label="IRPF" field="impuesto" hint="19-28%" />
          <CfgInput label="Comisión" field="comFondo" hint="ETF ~0.2%" />
        </div>

        {res && (<>
          {/* Barras */}
          <div className="flex items-end gap-4 h-32 px-2">
            {[
              { label: "A · Amortizar→Invertir", val: res.ANet,
                grad: "linear-gradient(180deg,#34d399,#059669)", tc: "text-emerald-300" },
              { label: "B · Invertir directo", val: res.BNet,
                grad: ganaB ? "linear-gradient(180deg,#a78bfa,#7c3aed)" : "linear-gradient(180deg,#64748b,#334155)",
                tc: ganaB ? "text-violet-300" : "text-slate-400" },
            ].map(({ label, val, grad, tc }) => {
              const mx = Math.max(res.ANet, res.BNet, 1);
              const pct = val / mx * 100;
              return (
                <div key={label} className="flex-1 flex flex-col items-center gap-1">
                  <p className={`text-xs font-black font-mono ${tc}`}>{fmt(val)} €</p>
                  <div className="w-full flex items-end" style={{ height: 70 }}>
                    <div className="w-full rounded-t-lg overflow-hidden"
                      style={{ height: `${Math.max(pct, 4)}%`, background: grad }}>
                      <div className="h-full opacity-10"
                        style={{ background: "repeating-linear-gradient(45deg,transparent,transparent 4px,white 4px,white 8px)" }} />
                    </div>
                  </div>
                  <p className="text-[9px] text-slate-400 text-center leading-tight">{label}</p>
                </div>
              );
            })}
          </div>

          {/* Veredicto */}
          <div className={`rounded-xl p-3 border ${ganaB ? "bg-violet-950/30 border-violet-800/40" : "bg-emerald-950/30 border-emerald-800/40"}`}>
            <p className="text-xs font-black text-slate-100">
              {ganaB ? "🚀" : "🏠"} {ganaB
                ? `Invertir directo genera un ${fmt(difP, 1)}% más en el fondo`
                : `Amortizar genera un ${fmt(difP, 1)}% más en el fondo`}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              Diferencia: <strong className={ganaB ? "text-violet-300" : "text-emerald-300"}>{fmt(difE)} €</strong>
            </p>
          </div>

          {/* Tabla comparativa */}
          <div className="bg-slate-800/30 rounded-xl p-3">
            <div className="grid grid-cols-3 gap-1 mb-2 pb-1 border-b border-slate-700/40">
              <span className="text-[9px] font-bold text-slate-600 uppercase">Concepto</span>
              <span className="text-[9px] font-bold text-emerald-600 uppercase text-right">A</span>
              <span className="text-[9px] font-bold text-violet-600 uppercase text-right">B</span>
            </div>
            <Row label="Hip. libre en"
              valA={`${res.mesLiqA ?? "—"} m`} valB={`${hipoteca.mesesRestantes} m`}
              cA="text-emerald-300" />
            <Row label="Meses en fondo"
              valA={`${res.mInvA} m`} valB={`${hipoteca.mesesRestantes} m`} />
            <Row label="Aportado fondo"
              valA={`${fmt(res.aportFA)} €`} valB={`${fmt(res.aportFB)} €`} />
            <Row label="Plusvalías"
              valA={`${fmt(res.pvA)} €`} valB={`${fmt(res.pvB)} €`}
              cA="text-amber-400" cB="text-amber-400" />
            <Row label="Intereses banco"
              valA={`${fmt(res.intA)} €`} valB={`${fmt(res.intB)} €`}
              cA="text-red-400" cB="text-red-400" />
            {res.comA > 0.01 && (
              <Row label="Comisiones amort."
                valA={`${fmt(res.comA)} €`} valB="0,00 €"
                cA="text-amber-400" cB="text-slate-600" />
            )}
            <Row label="Fondo neto"
              valA={`${fmt(res.ANet)} €`} valB={`${fmt(res.BNet)} €`}
              cA="text-emerald-300" cB={ganaB ? "text-violet-300" : "text-slate-300"} bold />
          </div>

          {/* Evolución */}
          <div className="bg-slate-800/30 rounded-xl p-3">
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-2">Evolución patrimonio líquido</p>
            <SparklineEvolucion hist={res.hist} mesLiqA={res.mesLiqA}
              crossover={res.crossover} mesesTotal={hipoteca.mesesRestantes} />
            <p className="text-[9px] mt-2 text-center">
              {res.crossover
                ? <span className="text-amber-400">Crossover en mes {res.crossover} (año {(res.crossover/12).toFixed(1)}) — A supera a B en liquidez</span>
                : <span className="text-slate-600">B mantiene mayor liquidez durante todo el horizonte</span>}
            </p>
          </div>

          {/* Liquidez */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-emerald-950/20 rounded-xl border border-emerald-900/30 p-2.5">
              <p className="text-[9px] font-bold text-emerald-500 mb-1.5">A · Ventajas</p>
              <div className="space-y-0.5 text-[10px] text-slate-400">
                <p>✅ Deuda libre en mes <strong className="text-emerald-300">{res.mesLiqA ?? "—"}</strong></p>
                <p>✅ Ahorra <strong className="text-emerald-300">{fmt(res.ahorroIntereses)} €</strong> al banco</p>
                <p>🔒 Capital amortizado ilíquido hasta venta</p>
                <p>⚠️ Sin fondo hasta mes {res.mesLiqA ?? "—"}</p>
              </div>
            </div>
            <div className="bg-violet-950/20 rounded-xl border border-violet-900/30 p-2.5">
              <p className="text-[9px] font-bold text-violet-400 mb-1.5">B · Ventajas</p>
              <div className="space-y-0.5 text-[10px] text-slate-400">
                <p>✅ Fondo accesible desde mes <strong className="text-violet-300">1</strong></p>
                <p>✅ Compuesto durante <strong className="text-violet-300">{hipoteca.mesesRestantes} m</strong></p>
                <p>✅ Patrimonio liquidable en días</p>
                <p>⚠️ Paga <strong className="text-red-400">{fmt(res.ahorroIntereses)} €</strong> más al banco</p>
              </div>
            </div>
          </div>

          {/* Nota */}
          <p className="text-[9px] text-slate-700 italic leading-relaxed">
            Flujo idéntico: ambos desembolsan cuota+extra cada mes. A: extra a hucha con rentabilidad,
            amortiza al alcanzar mínimo, luego invierte cuota+extra. B: extra al fondo desde mes 1.
            Fondo neto = cartera − IRPF sobre plusvalías. Sin garantía de rentabilidad futura.
          </p>
        </>)}

        {!res && (
          <p className="text-xs text-slate-600 text-center py-4">Añade una hipoteca variable para ver el análisis</p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTENIDO DE AYUDA
// ─────────────────────────────────────────────────────────────────────────────

const ONBOARDING_SLIDES = [
  {
    emoji: "👋",
    titulo: "Bienvenido a Prioriza",
    cuerpo: "Esta app te ayuda a tomar decisiones financieras inteligentes: pagar deudas más rápido, gestionar tu hipoteca variable y comparar si te conviene más amortizar o invertir. Todo en tu móvil, sin conexión a internet y con tus datos solo en tu dispositivo.",
    color: "from-indigo-950/80 to-slate-900",
    borde: "border-indigo-700/40",
  },
  {
    emoji: "💳",
    titulo: "Perfiles de Consumo",
    cuerpo: "Añade préstamos y tarjetas de crédito. La app calcula el orden óptimo para liquidarlos usando Bola de Nieve (menor saldo primero) o Avalancha (mayor interés primero). El extra mensual se aplica a la deuda prioritaria y al liquidarla su cuota se suma automáticamente a la siguiente.",
    color: "from-violet-950/80 to-slate-900",
    borde: "border-violet-700/40",
  },
  {
    emoji: "🏠",
    titulo: "Hipoteca Variable y Hucha",
    cuerpo: "Introduce tu diferencial, el Euríbor proyectado y el mínimo de amortización del banco. La app acumula tu aportación en una 'hucha' — opcionalmente con rentabilidad — y solo amortiza al alcanzar ese mínimo, replicando exactamente la realidad. El cuadro de amortización muestra mes a mes cada 'golpe'.",
    color: "from-sky-950/80 to-slate-900",
    borde: "border-sky-700/40",
  },
  {
    emoji: "📈",
    titulo: "Estrategia de Riqueza",
    cuerpo: "Compara A (acumular en hucha → amortizar → invertir la cuota liberada) contra B (invertir el extra directamente en un fondo indexado desde el mes 1). El análisis incluye IRPF sobre plusvalías, comisiones del fondo y el coste real de las comisiones de amortización anticipada.",
    color: "from-emerald-950/80 to-slate-900",
    borde: "border-emerald-700/40",
  },
  {
    emoji: "🤖",
    titulo: "Asistente IA integrado",
    cuerpo: "Pulsa el botón 🤖 del header para descargar un archivo de contexto con toda tu configuración. Adjúntalo a cualquier IA (Claude, ChatGPT…) y pregúntale lo que quieras: interpretar resultados, analizar tu situación, o incluso pedirle que mejore el código de la propia app.",
    color: "from-violet-950/80 to-slate-900",
    borde: "border-violet-700/40",
  },
  {
    emoji: "🔒",
    titulo: "Tus datos, solo tuyos",
    cuerpo: "Todo se guarda en tu dispositivo usando localStorage. Exporta un backup JSON en cualquier momento y restáuralo si cambias de móvil. Activa opcionalmente un PIN de 4 dígitos o biometría (huella/FaceID) para proteger el acceso.",
    color: "from-slate-800/80 to-slate-900",
    borde: "border-slate-600/40",
  },
];

const AYUDA_SECCIONES = [
  {
    id: "inicio",
    icono: "🚀",
    titulo: "Primeros pasos",
    contenido: [
      {
        subtitulo: "¿Por dónde empiezo?",
        texto: "Pulsa el botón de perfil (arriba a la derecha) y crea tu primer perfil. Elige 'Consumo' si tienes préstamos o tarjetas, o 'Hipoteca variable' si quieres gestionar una hipoteca con Euríbor. Puedes tener varios perfiles y cambiar entre ellos sin que interfieran.",
      },
      {
        subtitulo: "¿Puedo tener varios perfiles?",
        texto: "Sí. Cada perfil tiene sus propios datos, su propio extra mensual y, en el caso de hipoteca, su propia hucha con su rentabilidad. Pero los perfiles dan mucho más juego del que parece:\n\n• Compara condiciones: crea un perfil con tu préstamo actual y otro con la oferta de otro banco. Verás en segundos cuánto ahorras realmente cambiando.\n\n• Simula una reunificación: pon todas tus deudas actuales en un perfil y en otro pon el préstamo unificado que te ofrecen. Compara intereses totales y plazo — muchas veces la reunificación sale más cara de lo que parece.\n\n• Escenarios de extra: duplica un perfil y cambia solo el extra mensual para ver cuánto acelera la liquidación aportar 100€ más al mes.\n\n• Hipoteca fija vs variable: crea un perfil de consumo con la cuota de la fija como si fuera un préstamo y compara con tu hipoteca variable real.",
      },
      {
        subtitulo: "¿Qué es el botón 🤖?",
        texto: "Genera y descarga un archivo de texto con toda la descripción de la app y tus datos reales de configuración. Adjúntalo en cualquier chat de IA (Claude, ChatGPT, Gemini…) y pregúntale lo que necesites: interpretar tus resultados, analizar tu situación concreta o pedir mejoras al código fuente de la app.",
      },
      {
        subtitulo: "¿Mis datos están seguros?",
        texto: "Todo se guarda localmente en tu navegador. Nadie externo tiene acceso. Haz backups periódicos desde 'Gestión de datos' → 'Backup' para no perder nada si limpias el navegador. Opcionalmente activa el PIN desde ese mismo bloque.",
      },
    ],
  },
  {
    id: "consumo",
    icono: "💳",
    titulo: "Prioriza — Consumo",
    contenido: [
      {
        subtitulo: "¿Qué es la Bola de Nieve?",
        texto: "Pagas los mínimos en todas las deudas y concentras el extra en una sola. Al liquidarla, su cuota se suma al extra y se aplica a la siguiente. Como una bola de nieve que crece al rodar. Psicológicamente muy efectiva porque da victorias rápidas.",
      },
      {
        subtitulo: "¿Qué diferencia hay entre Bola de Nieve y Avalancha?",
        texto: "Bola de Nieve ataca primero la deuda de menor saldo — victorias rápidas y motivación. Avalancha ataca primero la de mayor interés — es matemáticamente óptima y ahorra más dinero. La app calcula ambas automáticamente y te muestra cuál te conviene con tus datos reales.",
      },
      {
        subtitulo: "¿Qué pongo en 'Extra mensual'?",
        texto: "El dinero adicional que puedes destinar cada mes más allá de pagar las cuotas normales. Aunque sea poco, 50 € o 100 € al mes pueden recortar años de deuda. La app calcula exactamente cuánto ahorras con cada euro extra.",
      },
      {
        subtitulo: "Préstamo vs Tarjeta de crédito",
        texto: "Los préstamos tienen cuota fija calculada con el sistema francés. Las tarjetas tienen un mínimo variable que fija el banco (normalmente 3% del saldo + intereses, mínimo 25 €). Si tu cuota elegida es menor que ese mínimo, la app te avisa y usa el mínimo real para que los cálculos sean correctos.",
      },
      {
        subtitulo: "¿Qué hace el botón 'Actualizar'?",
        texto: "Permite actualizar el saldo pendiente de dos formas: introduciendo el capital real del último extracto bancario (siempre más fiable), o proyectando el saldo teórico a una fecha futura según el plan de pagos. Úsalo periódicamente para que los cálculos se ajusten a la realidad.",
      },
    ],
  },
  {
    id: "hipoteca",
    icono: "🏠",
    titulo: "Hipoteca Variable y Hucha",
    contenido: [
      {
        subtitulo: "¿Qué es el diferencial y el Euríbor?",
        texto: "Tu tipo de interés = Diferencial (margen fijo del banco, ej: 0.75%) + Euríbor (índice que cambia anualmente, ej: 2.50%). La cuota se recalcula cada año en el mes de revisión pactado en escritura. La app usa el Euríbor que introduces como proyección constante.",
      },
      {
        subtitulo: "¿Qué es la hucha y por qué funciona así?",
        texto: "Los bancos exigen un importe mínimo para amortizaciones anticipadas (ej: 3.000 €). No puedes amortizar 200 € al mes directamente. La hucha acumula tu aportación mensual y cuando llega al mínimo del banco, 'golpea': amortiza todo de una vez y se vacía. Así la app replica exactamente cómo funciona en la realidad.",
      },
      {
        subtitulo: "¿Qué es la 'Rentab. cuenta' de la hucha?",
        texto: "Si tienes la hucha en una cuenta remunerada o depósito, puedes indicar su rentabilidad anual (ej: 2%). La app aplicará ese interés mensualmente sobre el saldo acumulado antes de sumar la nueva aportación. Esto adelanta los golpes de hucha y reduce aún más los intereses totales.",
      },
      {
        subtitulo: "¿Qué significa 'Golpe de hucha' en la tabla?",
        texto: "El símbolo 💥 marca los meses en que la hucha se vacía para amortizar capital. Verás la columna 'Amort. extra' con la cantidad amortizada y, si aplica, la comisión cobrada por el banco. Cada golpe reduce el capital vivo y, por tanto, los intereses futuros.",
      },
      {
        subtitulo: "¿Qué hace la revisión de cuota (↻)?",
        texto: "Cada año, en el mes pactado con el banco, se recalcula la cuota con el Euríbor proyectado y el capital pendiente en ese momento. En la tabla lo verás marcado con ↻. Como la app usa un Euríbor fijo (tu previsión), la cuota varía solo por la reducción de capital.",
      },
      {
        subtitulo: "¿Por qué la proyección dice 'Euríbor fijo'?",
        texto: "Nadie puede predecir el Euríbor futuro. La app asume que se mantiene en el valor que introduces para darte cifras concretas. Tómalo como un escenario base. Si quieres ver qué pasa con Euríbor al 3.5%, cambia el campo y la proyección se actualiza al instante.",
      },
    ],
  },
  {
    id: "riqueza",
    icono: "📈",
    titulo: "Estrategia de Riqueza",
    contenido: [
      {
        subtitulo: "¿Qué compara exactamente este módulo?",
        texto: "Al final del plazo original de tu hipoteca, ¿quién tiene más patrimonio? La persona que amortizó antes y luego invirtió la cuota liberada (A), o la que invirtió el extra desde el primer día sin amortizar nada extra (B). Ambas gastan exactamente el mismo dinero cada mes.",
      },
      {
        subtitulo: "Estrategia A — Hucha, amortizar y luego invertir",
        texto: "Tu aportación mensual va a la hucha (con rentabilidad si la configuras). Al alcanzar el mínimo del banco, amortiza. Una vez liquidada la hipoteca, inviertes la cuota liberada + el extra durante los meses restantes. Pagas menos intereses al banco y eliminas la deuda antes.",
      },
      {
        subtitulo: "Estrategia B — Invertir directamente",
        texto: "Pagas solo la cuota obligatoria mes a mes. Cada mes inviertes el extra íntegro en un fondo indexado tipo S&P 500 desde el primer día. Al final del plazo tienes más tiempo de capitalización compuesta pero has pagado más intereses al banco.",
      },
      {
        subtitulo: "¿Qué son 'Intereses banco' y 'Comisiones amort.'?",
        texto: "'Intereses banco' es el total de intereses puros pagados a la entidad durante toda la vida de la hipoteca en cada estrategia. Si tienes comisión de amortización anticipada configurada, aparece una fila adicional 'Comisiones amort.' con el coste real de cada golpe de hucha en la estrategia A.",
      },
      {
        subtitulo: "¿Por qué se descuenta el IRPF?",
        texto: "En España las ganancias de inversión tributan entre el 19% y el 28% según el importe. La app aplica el porcentaje que introduces solo sobre los beneficios (cartera final − lo que aportaste), no sobre todo el capital. El 'Fondo neto' ya tiene ese descuento aplicado.",
      },
      {
        subtitulo: "¿Qué rentabilidad pongo para el S&P 500?",
        texto: "El S&P 500 ha rentado históricamente entorno al 9-10% anual (sin descontar inflación). Para ser conservador usa 7%. Ten en cuenta que la comisión del fondo resta rentabilidad directamente: un fondo con 0.2% de comisión y 7% de rentabilidad bruta da un 6.8% neto.",
      },
      {
        subtitulo: "¿Qué es el 'Crossover' en la gráfica?",
        texto: "Es el mes en que la línea de patrimonio líquido de A supera a la de B. Antes de ese punto B tiene más liquidez (su fondo es accesible). Después, A tiene más porque la cuota liberada post-liquidación crece muy rápido. Si no hay crossover, B mantiene ventaja en liquidez durante todo el horizonte.",
      },
    ],
  },
  {
    id: "datos",
    icono: "💾",
    titulo: "Seguridad y datos",
    contenido: [
      {
        subtitulo: "¿Cómo hago un backup?",
        texto: "Desde el bloque 'Gestión de datos' al final de la pantalla pulsa 'Backup'. Se descarga un JSON con todos tus perfiles y datos. Guárdalo en un lugar seguro (nube, email…). Para restaurar, pulsa 'Restaurar' y selecciona ese archivo. Recibirás una confirmación antes de sobrescribir.",
      },
      {
        subtitulo: "¿Qué pasa si limpio el navegador?",
        texto: "Los datos se borran. Haz backups periódicos para evitarlo. El backup incluye todos los perfiles, sus deudas, la hucha, el extra y toda la configuración. Si usas la app en varios dispositivos, el backup es la forma de sincronizarlos manualmente.",
      },
      {
        subtitulo: "¿Cómo activo el PIN?",
        texto: "En 'Gestión de datos' → 'Activar seguridad'. Introduces un PIN de 4 dígitos dos veces. Opcionalmente añades biometría (huella o FaceID) según tu dispositivo. El PIN siempre funciona como respaldo aunque la biometría falle.",
      },
      {
        subtitulo: "¿Y si olvido el PIN?",
        texto: "En la pantalla de bloqueo hay un enlace 'Reset de emergencia' en la parte inferior. Elimina el PIN y la biometría pero no toca tus datos financieros. Es una salida de emergencia sin pérdida de información.",
      },
      {
        subtitulo: "¿Para qué sirve el botón 🤖?",
        texto: "Descarga un archivo de texto con la descripción completa de la app y todos tus datos de configuración (perfiles, deudas, hucha, tasas…). Adjúntalo en un chat de IA y podrás preguntarle lo que quieras sobre tu situación o sobre el funcionamiento de la app, sin ningún coste ni API.",
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE: ONBOARDING
// ─────────────────────────────────────────────────────────────────────────────
function Onboarding({ onFin }) {
  const [slide, setSlide] = useState(0);
  const total = ONBOARDING_SLIDES.length;
  const s = ONBOARDING_SLIDES[slide];

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/95 backdrop-blur-sm flex flex-col items-center justify-center px-6">
      {/* Botón cerrar esquina */}
      <button onClick={onFin}
        className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition text-lg">
        ✕
      </button>
      {/* Slide card */}
      <div className={`w-full max-w-sm bg-gradient-to-br ${s.color} rounded-3xl border ${s.borde} p-8 text-center shadow-2xl`}>
        <div className="text-6xl mb-5">{s.emoji}</div>
        <h2 className="text-xl font-black text-slate-100 mb-3 tracking-tight leading-tight">{s.titulo}</h2>
        <p className="text-sm text-slate-300 leading-relaxed">{s.cuerpo}</p>
      </div>

      {/* Dots */}
      <div className="flex gap-2 mt-6">
        {ONBOARDING_SLIDES.map((_, i) => (
          <button key={i} onClick={() => setSlide(i)}
            className={`rounded-full transition-all duration-300 ${i === slide ? "w-6 h-2 bg-indigo-400" : "w-2 h-2 bg-slate-600 hover:bg-slate-500"}`} />
        ))}
      </div>

      {/* Botones */}
      <div className="flex gap-3 mt-6 w-full max-w-sm">
        <button onClick={onFin}
          className="flex-1 py-3 rounded-xl border border-slate-600 text-slate-400 text-sm hover:bg-slate-800 transition">
          Saltar
        </button>
        {slide < total - 1 ? (
          <button onClick={() => setSlide(s => s + 1)}
            className="flex-2 flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition">
            Siguiente →
          </button>
        ) : (
          <button onClick={onFin}
            className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition">
            ¡Empezar! 🚀
          </button>
        )}
      </div>

      {/* Indicador numérico */}
      <p className="text-xs text-slate-600 mt-3">{slide + 1} / {total}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE: PANEL DE AYUDA COMPLETO
// ─────────────────────────────────────────────────────────────────────────────
function PanelAyuda({ onCerrar, onVerOnboarding }) {
  const [seccionActiva, setSeccionActiva] = useState("inicio");
  const seccion = AYUDA_SECCIONES.find(s => s.id === seccionActiva);
  const scrollRef = useRef(null);

  const handleSeccion = (id) => {
    setSeccionActiva(id);
    setTimeout(() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }), 50);
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950" style={{ fontFamily: "'DM Sans','Segoe UI',sans-serif" }}>

      {/* Header fijo */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950 flex-shrink-0 pt-safe"
        style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
        <div className="flex items-center gap-2">
          <button onClick={onCerrar}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition text-base leading-none mr-1">
            ←
          </button>
          <div>
            <p className="text-sm font-black text-slate-100">Centro de ayuda</p>
            <p className="text-xs text-slate-500">Guía completa de Prioriza</p>
          </div>
        </div>
        <button onClick={onCerrar}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition text-lg leading-none">
          ✕
        </button>
      </div>

      {/* Nav horizontal de secciones */}
      <div className="flex overflow-x-auto gap-1 px-3 py-2 border-b border-slate-800 flex-shrink-0"
        style={{ scrollbarWidth: "none" }}>
        {AYUDA_SECCIONES.map(s => (
          <button key={s.id} onClick={() => handleSeccion(s.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition flex-shrink-0 ${
              seccionActiva === s.id
                ? "bg-indigo-600 text-white"
                : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
            }`}>
            <span>{s.icono}</span>
            <span>{s.titulo}</span>
          </button>
        ))}
      </div>

      {/* Contenido scrollable */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
        <h2 className="text-lg font-black text-slate-100 flex items-center gap-2">
          <span>{seccion.icono}</span>
          <span>{seccion.titulo}</span>
        </h2>

        {seccion.contenido.map((bloque, i) => (
          <div key={i} className="bg-slate-900 rounded-2xl border border-slate-700/60 p-4">
            <p className="text-sm font-bold text-indigo-300 mb-2">{bloque.subtitulo}</p>
            <p className="text-sm text-slate-300 leading-relaxed">{bloque.texto}</p>
          </div>
        ))}

        {/* CTA ver onboarding */}
        <button onClick={onVerOnboarding}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-indigo-700/50 text-indigo-400 text-sm hover:bg-indigo-950/40 transition mt-2">
          <span>▶</span>
          <span>Ver guía de introducción de nuevo</span>
        </button>

        {/* Botón cerrar al final */}
        <button onClick={onCerrar}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-slate-700 text-slate-400 text-sm hover:bg-slate-800 transition">
          <span>✕</span>
          <span>Cerrar ayuda</span>
        </button>

        <p className="text-xs text-slate-700 text-center pb-4">
          Prioriza · Tu planificador financiero personal
        </p>
      </div>

    </div>
  );
}
