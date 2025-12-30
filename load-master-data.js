// Extracted loadMasterData function (moved from index.html for clarity)
window.loadMasterDataExternal = async function loadMasterDataExternal(forceReload = false) {
  try {
    console.log("loadMasterData called, forceReload=", !!forceReload);
    const rawData = await ipcRenderer.invoke("read-master-data");
    if (!rawData || !rawData.length) {
      console.error("Failed to read master data");
      const sb = document.getElementById("scan-by");
      if (sb) sb.value = "ERROR LOADING MASTER";
      return;
    }

    // Get the headers from the first row
    const headers = rawData[0] || [];
    availableHeaders = headers.map((h) => String(h || ""));
    // Build headerInfos with column addresses and unique keys to avoid duplicate header names
    // First compute normalized name counts so we can make duplicate-safe keys
    const rawHeaderNames = headers.map((h) => String(h || ""));
    const normCounts = rawHeaderNames.reduce((acc, name) => {
      const n = normalizeHeader(name || "");
      acc[n] = (acc[n] || 0) + 1;
      return acc;
    }, {});

    headerInfos = rawHeaderNames.map((h, idx) => {
      const name = String(h || "");
      const col = columnLetter(idx);
      const norm = normalizeHeader(name || "");
      let uniqueKey = name;
      if (normCounts[norm] > 1) {
        uniqueKey = `${name}__${col}`;
      }
      return { name, col, norm, uniqueKey };
    });
    console.log("Headers found:", headers, "headerInfos:", headerInfos);

    // Keep raw rows (arrays) and also build convenience mapped objects for compatibility
    masterRawRows = rawData
      .slice(1)
      .filter(
        (r) =>
          Array.isArray(r) &&
          r.some(
            (c) =>
              c !== undefined &&
              c !== null &&
              String(c || "").trim() !== ""
          )
      );

    // Build masterData rows as objects keyed by column letter, header name and normalized header (legacy compatibility)
    masterData = masterRawRows.map((rowArr) => {
      const obj = {};
      for (let i = 0; i < headerInfos.length; i++) {
        const h = headerInfos[i] || {
          name: "",
          col: columnLetter(i),
          norm: "",
          uniqueKey: columnLetter(i),
        };
        const val = rowArr[i] !== undefined && rowArr[i] !== null ? String(rowArr[i]) : "";
        obj[h.col] = val;
        obj[h.name] = val;
        obj[h.norm] = val;
        if (h.uniqueKey) obj[h.uniqueKey] = val;
      }
      return obj;
    });

    console.log("Processed masterData rows:", masterData.length);

    // Provide detailed debug snapshot for developers to inspect what was loaded
    try {
      globalThis._masterDataDebug = globalThis._masterDataDebug || {};
      globalThis._masterDataDebug.loadedAt = new Date();
      globalThis._masterDataDebug.rawHeaders = headers.slice();
      globalThis._masterDataDebug.headerInfos = headerInfos.map((h) => ({ ...h }));
      globalThis._masterDataDebug.rowCount = masterData.length;
      globalThis._masterDataDebug.sampleRows = masterData.slice(0, 20).map((r) => ({ ...r }));

      console.info("MasterData debug snapshot:", {
        loadedAt: window._masterDataDebug.loadedAt,
        rowCount: window._masterDataDebug.rowCount,
        headers: window._masterDataDebug.rawHeaders,
        headerInfos: window._masterDataDebug.headerInfos,
      });

      window.printMasterDataDebug = function (maxRows = 20) {
        try {
          console.groupCollapsed("MasterData Debug");
          console.info("Loaded at:", window._masterDataDebug.loadedAt);
          console.info("Row count:", window._masterDataDebug.rowCount);
          console.info("Header infos:", window._masterDataDebug.headerInfos);
          const rows = masterData.slice(0, Number(maxRows) || 20).map((r, i) => ({ __rowIndex: i, ...r }));
          console.table(rows);
          if (window._masterDataDebug.lastRenderedParts) {
            console.info("Last rendered parts list (modal):");
            console.table(window._masterDataDebug.lastRenderedParts.map((p, i) => ({ __idx: i, ...p })));
          } else {
            console.info("No parts list snapshot available yet. Open the modal to populate lastRenderedParts.");
          }
          console.groupEnd();
        } catch (e) {
          console.error("printMasterDataDebug error", e);
        }
      };
    } catch (e) {
      console.warn("Failed to prepare masterData debug snapshot", e);
    }

    loadSettings();

    // If there was a previously selected part, try to re-resolve it
    try {
      if (currentSelectedRow) {
        const prevPrimary = getPrimaryValue(currentSelectedRow) || "";
        if (prevPrimary) {
          const foundIdx = masterData.findIndex((m) => {
            const mv = getPrimaryValue(m) || "";
            return mv && String(mv).trim() === String(prevPrimary).trim();
          });
          if (foundIdx >= 0) {
            // Prefer preserving the raw Excel row reference and exact index
            currentSelectedRow = masterRawRows[foundIdx] || masterData[foundIdx];
            try { window.currentSelectedRow = currentSelectedRow; } catch (e) {}
            try { window.currentSelectedRowIndex = foundIdx; } catch (e) {}
            settings.fields.forEach((field) => {
              try {
                if (typeof window.hideFailureRecordBox === "function") window.hideFailureRecordBox();
              } catch (e) {}
              const input = document.getElementById(field.id);
              if (input) input.value = getValueFromRow(currentSelectedRow, field.id) || "";
            });
          } else {
            currentSelectedRow = null;
            try { window.currentSelectedRow = null; } catch (e) {}
            settings.fields.forEach((field) => {
              const input = document.getElementById(field.id);
              if (input) input.value = "";
            });
          }
        }
      }
    } catch (e) {
      console.warn("Failed to reconcile previous selection after loading master data", e);
    }

    // Detect if headers changed compared to saved settings.fields mapping.
    try {
      const loadedNorms = (headerInfos || []).map((h) => h.norm);
      const savedFieldHeaders = (settings.fields || []).map((f) => ({ header: normalizeHeader(f.header || ""), col: f.headerCol || "" }));
      const mismatch = savedFieldHeaders.some((hf) => {
        if (!hf.header && !hf.col) return false;
        if (hf.col && (headerInfos || []).find((h) => h.col === hf.col)) return false;
        if (hf.header && loadedNorms.includes(hf.header)) return false;
        return true;
      });

      if (mismatch) {
        console.warn("Detected header mismatch between master file and saved settings - resetting settings and opening mappings UI");
        settings.fields = (headerInfos || []).map((h, i) => ({ id: `field_${i}`, label: h.name || h.col || `Col ${h.col}`, header: h.name || "", headerCol: h.col || "" }));
        settings.primaryFields = settings.fields.length ? [settings.fields[0].id] : [];
        settings.displayFields = settings.fields.length > 1 ? [settings.fields[0].id, settings.fields[1].id] : settings.fields.map((f) => f.id);
        settings.scanOperation = "equals";
        settings.displayField = settings.displayFields[0] || "";
        settings.removedHeaders = [];
        settings.showMultiScanPanel = true;
        try { saveSettings(); } catch (e) { console.warn("Failed to save reset settings", e); }
        try { if (typeof openSettingsModal === "function") setTimeout(() => { openSettingsModal().catch(() => {}); }, 120); } catch (e) { console.warn("Failed to open settings modal after header change", e); }
      }
    } catch (e) {
      console.warn("Header mismatch detection failed", e);
    }

    // Reconcile saved field mappings against detected headers
    function reconcileFieldMappings() {
      if (!Array.isArray(settings.fields) || !headerInfos) return;
      const infos = headerInfos || [];
      const findByCol = (col) => infos.find((h) => h.col === col);
      const findAllByName = (name) => infos.filter((h) => h.name === name || h.norm === normalizeHeader(name));
      const normLabel = (s) => normalizeHeader(String(s || ""));
      const assigned = new Set();
      settings.fields = settings.fields.map((f, idx) => {
        const out = { ...f };
        if (out.headerCol && findByCol(out.headerCol)) {
          const hi = findByCol(out.headerCol);
          out.header = hi.name; out.headerCol = hi.col; assigned.add(hi.col); return out;
        }
        if (out.header) {
          const candidates = findAllByName(out.header);
          if (candidates && candidates.length > 0) {
            let hi = candidates.find((c) => !assigned.has(c.col)) || candidates[0];
            if (hi) { out.header = hi.name; out.headerCol = hi.col; assigned.add(hi.col); return out; }
          }
        }
        if (out.label) {
          const labelNorm = normLabel(out.label);
          const labelMatches = infos.filter((h) => normLabel(h.name) === labelNorm || normLabel(h.name).includes(labelNorm) || labelNorm.includes(normLabel(h.name)));
          if (labelMatches && labelMatches.length > 0) {
            const hi = labelMatches.find((c) => !assigned.has(c.col)) || labelMatches[0];
            out.header = hi.name; out.headerCol = hi.col; assigned.add(hi.col); return out;
          }
        }
        const m = String(out.id || "").match(/_(\d+)$/);
        if (m) {
          const num = Number(m[1]); if (Number.isInteger(num) && infos[num]) { const hi = infos[num]; out.header = hi.name; out.headerCol = hi.col; assigned.add(hi.col); return out; }
        }
        const unassigned = infos.find((h) => !assigned.has(h.col));
        if (unassigned) { out.header = unassigned.name; out.headerCol = unassigned.col; assigned.add(unassigned.col); return out; }
        return out;
      });
      console.log("Field mappings reconciled:", settings.fields.map((f) => ({ id: f.id, header: f.header, headerCol: f.headerCol })));
    }

    reconcileFieldMappings();

    if (!settings.fields || settings.fields.length === 0) {
      settings.fields = (headerInfos || []).map((h, i) => ({ id: `field_${i}`, label: h.name || h.col || `Col ${h.col}`, header: h.name || "", headerCol: h.col || "" }));
      settings.primaryFields = settings.fields.length ? [settings.fields[0].id] : [];
      settings.displayFields = settings.fields.length > 1 ? [settings.fields[0].id, settings.fields[1].id] : settings.fields.map((f) => f.id);
      console.log("Auto-populated settings.fields from headers");
      try { saveSettings(); } catch (e) { console.warn("Failed to save auto settings", e); }
    }

    try { rebuildInputUI(); } catch (e) { console.warn("rebuildInputUI failed:", e); }

  } catch (error) {
    console.error("Error loading master data:", error);
  }
};

// End of loadMasterData
