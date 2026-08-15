window.OD = window.OD || {};

(function(OD){
  function adapters() {
    const contract = OD.adapterContract;
    if (!contract) throw new Error("Adapter capability contract is not loaded.");
    return (OD.adapters || []).map(contract.validateAdapter);
  }

  async function matchingAdapters(kind, payload) {
    const method = kind === "zip" ? "detectZIP" : "detectJSON";
    const matches = [];
    for (const adapter of adapters()) {
      if (!adapter.capabilities[kind]) continue;
      try {
        if (await adapter[method](payload)) matches.push(adapter);
      } catch (_) {
        console.warn(`Adapter ${adapter.id} detection failed; no source values were logged.`);
      }
    }
    return matches;
  }

  async function inspectJSON(data) {
    const matches = await matchingAdapters("json", data);
    if (matches.length === 1) {
      return {
        recognized: true,
        kind: "json",
        adapter: matches[0],
        diagnostics: null
      };
    }
    return {
      recognized: false,
      kind: "json",
      adapter: null,
      diagnostics: OD.adapterContract.jsonDiagnostics(data, {
        reason: matches.length > 1 ? "ambiguous-format" : "unknown-format",
        matchedAdapterIds: matches.map(adapter => adapter.id)
      })
    };
  }

  async function parseJSON(data) {
    const inspection = await inspectJSON(data);
    if (!inspection.recognized) {
      return { archive: null, adapter: null, recognized: false, diagnostics: inspection.diagnostics };
    }
    return {
      archive: await inspection.adapter.parseJSON(data),
      adapter: inspection.adapter,
      recognized: true,
      diagnostics: null
    };
  }

  async function inspectZIP(zip) {
    const matches = await matchingAdapters("zip", zip);
    if (matches.length === 1) {
      return { recognized: true, kind: "zip", adapter: matches[0], diagnostics: null };
    }
    return {
      recognized: false,
      kind: "zip",
      adapter: null,
      diagnostics: OD.adapterContract.zipDiagnostics(zip, {
        reason: matches.length > 1 ? "ambiguous-format" : "unknown-format",
        matchedAdapterIds: matches.map(adapter => adapter.id)
      })
    };
  }

  async function parseZIP(file) {
    const zip = await OD.zip.readZip(file);
    const outer = await inspectZIP(zip);
    if (outer.recognized) {
      const parsed = await outer.adapter.parseZIP(zip);
      if (parsed && typeof parsed === "object" && parsed.archive) {
        return { ...parsed, adapter: outer.adapter, recognized: true, diagnostics: null };
      }
      return { archive: parsed, adapter: outer.adapter, recognized: true, diagnostics: null };
    }
    if (outer.diagnostics.reason === "ambiguous-format") {
      return { archive: null, adapter: null, recognized: false, diagnostics: outer.diagnostics };
    }

    const jsonNames = zip.names.filter(name => /\.json$/i.test(name)).slice(0, 30);
    const recognizedCandidates = [];
    const candidateJSON = [];
    for (const name of jsonNames) {
      try {
        const data = await zip.readJSON(name);
        const inspection = await inspectJSON(data);
        const shape = OD.adapterContract.jsonDiagnostics(data, {
          reason: inspection.recognized ? "recognized-candidate" : inspection.diagnostics.reason,
          matchedAdapterIds: inspection.recognized
            ? [inspection.adapter.id]
            : inspection.diagnostics.matchedAdapterIds
        });
        candidateJSON.push({
          filename: name,
          rootType: shape.rootType,
          topLevelKeys: shape.topLevelKeys,
          arrayLength: shape.arrayLength,
          candidateKeyPatterns: shape.candidateKeyPatterns,
          matchedAdapterIds: shape.matchedAdapterIds
        });
        if (inspection.recognized) recognizedCandidates.push({ name, data, adapter: inspection.adapter });
      } catch (_) {
        candidateJSON.push({ filename: name, invalidJSON: true });
      }
    }

    if (recognizedCandidates.length === 1) {
      const candidate = recognizedCandidates[0];
      return {
        archive: await candidate.adapter.parseJSON(candidate.data),
        adapter: candidate.adapter,
        recognized: true,
        diagnostics: null,
        innerFile: candidate.name
      };
    }

    const diagnostics = OD.adapterContract.zipDiagnostics(zip, {
      reason: recognizedCandidates.length > 1 ? "ambiguous-format" : "unknown-format",
      matchedAdapterIds: [...new Set(recognizedCandidates.map(candidate => candidate.adapter.id))],
      candidateJSON
    });
    return { archive: null, adapter: null, recognized: false, diagnostics };
  }

  function capabilities() {
    return adapters().map(adapter => ({
      id: adapter.id,
      label: adapter.label,
      ...adapter.capabilities
    }));
  }

  OD.registry = {
    parseJSON,
    parseZIP,
    inspectJSON,
    inspectZIP,
    capabilities,
    formatDiagnostics: OD.adapterContract.formatDiagnostics
  };
})(window.OD);
