'use strict';
const zlib = require('node:zlib');

/* DOCX 是 Open XML 包，不能只凭 ZIP 魔数放行。逐项核验目录、解压上限与 CRC，
 * 并要求标准正文及关系文件，拒绝宏、嵌入程序和加密 ZIP，避免把任意压缩包当成工程文档。 */
function isDocx(bytes, name) {
  if (!/\.docx$/i.test(name) || bytes.length < 22) return false;
  try {
    let end = -1;
    for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
      if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) { end = offset; break; }
    }
    if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) return false;
    const count = bytes.readUInt16LE(end + 10), centralSize = bytes.readUInt32LE(end + 12), centralOffset = bytes.readUInt32LE(end + 16);
    if (!count || count > 2000 || count !== bytes.readUInt16LE(end + 8) || centralOffset + centralSize !== end) return false;
    const entries = new Map(), ranges = [];
    let offset = centralOffset, total = 0;
    for (let i = 0; i < count; i++) {
      if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) return false;
      const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10);
      const checksum = bytes.readUInt32LE(offset + 16), compressed = bytes.readUInt32LE(offset + 20), expanded = bytes.readUInt32LE(offset + 24);
      const nameSize = bytes.readUInt16LE(offset + 28), extraSize = bytes.readUInt16LE(offset + 30), commentSize = bytes.readUInt16LE(offset + 32);
      const local = bytes.readUInt32LE(offset + 42);
      if (flags & 0x2041 || ![0, 8].includes(method) || bytes.readUInt16LE(offset + 34) || expanded > 16 * 1024 * 1024) return false;
      if (offset + 46 + nameSize + extraSize + commentSize > end) return false;
      const entryName = bytes.subarray(offset + 46, offset + 46 + nameSize).toString('utf8');
      if (!entryName || /[\\\0]/.test(entryName) || entryName.startsWith('/') || entryName.split('/').includes('..') || entries.has(entryName.toLowerCase())) return false;
      if (/(vbaproject|activex|embeddings|customui)/i.test(entryName) || /\.(exe|dll|com|scr|bat|cmd|ps1|js|vbs|hta|html?|bin)$/i.test(entryName)) return false;
      if (local + 30 > centralOffset || bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method) return false;
      const localNameSize = bytes.readUInt16LE(local + 26), localExtra = bytes.readUInt16LE(local + 28), start = local + 30 + localNameSize + localExtra;
      if (start + compressed > centralOffset || bytes.subarray(local + 30, local + 30 + localNameSize).toString('utf8') !== entryName) return false;
      if (!(flags & 8) && (bytes.readUInt32LE(local + 14) !== checksum || bytes.readUInt32LE(local + 18) !== compressed || bytes.readUInt32LE(local + 22) !== expanded)) return false;
      ranges.push([local, start + compressed]);
      const packed = bytes.subarray(start, start + compressed);
      const content = method === 0 ? packed : zlib.inflateRawSync(packed, { maxOutputLength: 16 * 1024 * 1024 });
      if (content.length !== expanded || crc32(content) !== checksum) return false;
      total += content.length; if (total > 32 * 1024 * 1024) return false;
      if (/\.(xml|rels)$/i.test(entryName) && /<!DOCTYPE|<!ENTITY|macroEnabled|vbaProject/i.test(content.toString('utf8'))) return false;
      entries.set(entryName.toLowerCase(), content);
      offset += 46 + nameSize + extraSize + commentSize;
    }
    ranges.sort((a, b) => a[0] - b[0]);
    if (offset !== end || ranges[0]?.[0] !== 0 || ranges.some((range, i) => i && range[0] < ranges[i - 1][1])) return false;
    const types = entries.get('[content_types].xml')?.toString('utf8') || '';
    const relationships = entries.get('_rels/.rels')?.toString('utf8') || '';
    const document = entries.get('word/document.xml')?.toString('utf8') || '';
    const override = [...types.matchAll(/<(?:\w+:)?Override\b([^>]*)\/?>/g)].some(match => {
      const attrs = attributes(match[1]);
      return attrs.PartName === '/word/document.xml' && attrs.ContentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
    });
    const office = [...relationships.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?>/g)].some(match => {
      const attrs = attributes(match[1]);
      return /^https?:\/\/(?:schemas\.openxmlformats\.org\/officeDocument\/2006|purl\.oclc\.org\/ooxml\/officeDocument)\/relationships\/officeDocument$/.test(attrs.Type || '') && ['word/document.xml', '/word/document.xml'].includes(attrs.Target) && attrs.TargetMode !== 'External';
    });
    return override && office && /<(?:\w+:)?document\b/.test(document) && /(?:schemas\.openxmlformats\.org\/wordprocessingml\/2006\/main|purl\.oclc\.org\/ooxml\/wordprocessingml\/main)/.test(document);
  } catch { return false; }
}
function attributes(source) {
  return Object.fromEntries([...source.matchAll(/([\w:]+)\s*=\s*["']([^"']*)["']/g)].map(match => [match[1], match[2]]));
}
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let value = i; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); return value >>> 0;
});
function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255]; return (value ^ 0xffffffff) >>> 0; }
module.exports = { isDocx, crc32 };
