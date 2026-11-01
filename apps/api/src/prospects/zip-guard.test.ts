import { crc32, deflateRawSync } from 'node:zlib';
import { Workbook } from 'exceljs';
import { describe, expect, it } from 'vitest';
import { assertSafeZip, UnsafeZipError } from './zip-guard';

/** A minimal ZIP writer for tests; `declare` lets an entry claim a smaller size than it really unpacks to. */
function zip(entries: { name: string; data: Buffer; declare?: number }[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const packed = deflateRawSync(e.data);
    const size = e.declare ?? e.data.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc32(e.data), 14);
    lh.writeUInt32LE(packed.length, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc32(e.data), 16);
    ch.writeUInt32LE(packed.length, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, packed);
    central.push(ch, name);
    offset += 30 + name.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

describe('assertSafeZip', () => {
  it('accepts a real spreadsheet', async () => {
    const wb = new Workbook();
    wb.addWorksheet('People').addRows([['Name', 'Email'], ['Ana Lima', 'ana@bluefin.test']]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    expect(() => assertSafeZip(buf)).not.toThrow();
  });

  it('refuses a small file that unpacks too large, even when it declares a small size', () => {
    const big = Buffer.alloc(8 * 1024 * 1024);
    const honest = zip([{ name: 'xl/worksheets/sheet1.xml', data: big }]);
    expect(honest.length).toBeLessThan(64 * 1024);
    expect(() => assertSafeZip(honest, 4 * 1024 * 1024)).toThrow(new UnsafeZipError('unpacks too large'));
    const lying = zip([{ name: 'xl/worksheets/sheet1.xml', data: big, declare: 100 }]);
    expect(() => assertSafeZip(lying, 4 * 1024 * 1024)).toThrow(new UnsafeZipError('unpacks too large'));
    // Many entries that are each small but add up.
    const many = zip(Array.from({ length: 5 }, (_, i) => ({ name: `s${i}.xml`, data: Buffer.alloc(1024 * 1024) })));
    expect(() => assertSafeZip(many, 4 * 1024 * 1024)).toThrow(new UnsafeZipError('unpacks too large'));
    expect(() => assertSafeZip(many, 6 * 1024 * 1024)).not.toThrow();
  });

  it('refuses files that are not ZIPs or have too many entries', () => {
    expect(() => assertSafeZip(Buffer.from('Name,Email\nAna,ana@x.test\n'))).toThrow(new UnsafeZipError('not a ZIP file'));
    const lots = zip(Array.from({ length: 30 }, (_, i) => ({ name: `f${i}`, data: Buffer.from('x') })));
    expect(() => assertSafeZip(lots, 1024 * 1024, 20)).toThrow(new UnsafeZipError('too many entries'));
  });
});
