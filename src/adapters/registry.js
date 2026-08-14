window.OD = window.OD || {};

(function(OD){
  function adapters() { return OD.adapters || []; }

  async function parseJSON(data) {
    for (const adapter of adapters()) {
      if (adapter.detectJSON && adapter.detectJSON(data)) {
        return { archive: await adapter.parseJSON(data), adapter };
      }
    }
    throw new Error("暂时无法识别这个 JSON 格式。保留原文件，把样本交给我们新增 adapter 就好。");
  }

  async function parseZIP(file) {
    const zip = await OD.zip.readZip(file);
    for (const adapter of adapters()) {
      if (adapter.detectZIP && await adapter.detectZIP(zip)) {
        const parsed = await adapter.parseZIP(zip);
        if (parsed && typeof parsed === "object" && parsed.archive) {
          return { ...parsed, adapter };
        }
        return { archive: parsed, adapter };
      }
    }

    const candidates = zip.names.filter(n => /\.json$/i.test(n)).slice(0, 30);
    for (const name of candidates) {
      try {
        const data = await zip.readJSON(name);
        const parsed = await parseJSON(data);
        return { ...parsed, innerFile: name };
      } catch (_) {}
    }

    throw new Error("ZIP 打开了，但里面暂时没有找到可识别的对话数据。");
  }

  OD.registry = { parseJSON, parseZIP };
})(window.OD);
