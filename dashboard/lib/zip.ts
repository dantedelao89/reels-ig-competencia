// Construcción de archivos ZIP sin dependencias externas.
//
// Vive aquí y no dentro de una ruta porque lo usan dos: la descarga de un carrusel y la de una
// secuencia de historias. Método STORE (sin compresión) a propósito: imágenes y videos ya vienen
// comprimidos, así que comprimir solo gastaría CPU para ganar ~0%.

// CRC32 (requerido por el formato ZIP).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

interface Entry {
  name: Buffer;
  data: Buffer;
  crc: number;
  offset: number;
}

export function buildZip(files: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const entries: Entry[] = [];
  let offset = 0;

  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // firma local file header
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // método 0 = STORE
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.data.length, 18); // comp size
    local.writeUInt32LE(f.data.length, 22); // uncomp size
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    parts.push(local, name, f.data);
    entries.push({ name, data: f.data, crc, offset });
    offset += local.length + name.length + f.data.length;
  }

  const central: Buffer[] = [];
  let centralSize = 0;
  for (const e of entries) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0); // firma central directory
    h.writeUInt16LE(20, 4); // version made by
    h.writeUInt16LE(20, 6); // version needed
    h.writeUInt16LE(0, 8); // flags
    h.writeUInt16LE(0, 10); // método STORE
    h.writeUInt16LE(0, 12); // time
    h.writeUInt16LE(0x21, 14); // date
    h.writeUInt32LE(e.crc, 16);
    h.writeUInt32LE(e.data.length, 20);
    h.writeUInt32LE(e.data.length, 24);
    h.writeUInt16LE(e.name.length, 28);
    h.writeUInt16LE(0, 30); // extra
    h.writeUInt16LE(0, 32); // comment
    h.writeUInt16LE(0, 34); // disk
    h.writeUInt16LE(0, 36); // internal attrs
    h.writeUInt32LE(0, 38); // external attrs
    h.writeUInt32LE(e.offset, 42); // offset del local header
    central.push(h, e.name);
    centralSize += h.length + e.name.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // firma end of central directory
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16); // offset del central directory
  end.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([...parts, ...central, end]);
}
