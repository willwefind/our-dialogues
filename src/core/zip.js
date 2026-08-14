window.OD = window.OD || {};

(function(OD){
  function u16(v,o){ return v.getUint16(o,true); }
  function u32(v,o){ return v.getUint32(o,true); }

  async function inflateRaw(bytes) {
    if (!("DecompressionStream" in window)) {
      throw new Error("这个浏览器暂不支持原生 ZIP 解压。请先直接选择 JSON；后续版本会加入兼容 fallback。");
    }
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readZip(file) {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const dec = new TextDecoder("utf-8");
    let eocd = -1;
    const min = Math.max(0, bytes.length - 0xFFFF - 22);
    for (let i = bytes.length - 22; i >= min; i--) {
      if (u32(view, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("不是可识别的 ZIP，或 ZIP 使用了当前 v0.1 尚未支持的结构。");

    const entriesCount = u16(view, eocd + 10);
    const centralOffset = u32(view, eocd + 16);
    let p = centralOffset;
    const entries = new Map();
    for (let i = 0; i < entriesCount; i++) {
      if (u32(view, p) !== 0x02014b50) break;
      const method = u16(view, p + 10);
      const compSize = u32(view, p + 20);
      const uncompSize = u32(view, p + 24);
      const nameLen = u16(view, p + 28);
      const extraLen = u16(view, p + 30);
      const commentLen = u16(view, p + 32);
      const localOffset = u32(view, p + 42);
      const name = dec.decode(bytes.slice(p + 46, p + 46 + nameLen));
      entries.set(name, { name, method, compSize, uncompSize, localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }

    async function read(name) {
      const entry = entries.get(name);
      if (!entry) throw new Error(`ZIP 中找不到 ${name}`);
      const lp = entry.localOffset;
      if (u32(view, lp) !== 0x04034b50) throw new Error(`ZIP 本地头损坏：${name}`);
      const nameLen = u16(view, lp + 26);
      const extraLen = u16(view, lp + 28);
      const dataStart = lp + 30 + nameLen + extraLen;
      const compressed = bytes.slice(dataStart, dataStart + entry.compSize);
      if (entry.method === 0) return compressed;
      if (entry.method === 8) return await inflateRaw(compressed);
      throw new Error(`ZIP 压缩方式 ${entry.method} 暂不支持：${name}`);
    }

    return {
      names: [...entries.keys()],
      has: name => entries.has(name),
      readBytes: read,
      async readText(name) { return dec.decode(await read(name)); },
      async readJSON(name) { return JSON.parse(await this.readText(name)); }
    };
  }

  OD.zip = { readZip };
})(window.OD);
