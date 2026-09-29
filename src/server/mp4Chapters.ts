import { open } from 'node:fs/promises';
import { AppError } from './paths.js';

type Atom = { start: number; body: number; end: number; type: string };
function atoms(buffer: Buffer, start: number, end: number): Atom[] {
  const result: Atom[] = [];
  for (let offset = start; offset < end;) {
    if (offset + 8 > end) throw new AppError('Incomplete MP4 chapter metadata.');
    let size = buffer.readUInt32BE(offset),
      header = 8;
    if (size === 1) {
      if (offset + 16 > end) throw new AppError('Incomplete MP4 atom header.');
      size = Number(buffer.readBigUInt64BE(offset + 8));
      header = 16;
    }
    if (size === 0) size = end - offset;
    if (!Number.isSafeInteger(size) || size < header || offset + size > end)
      throw new AppError('Invalid MP4 chapter metadata bounds.');
    result.push({
      start: offset,
      body: offset + header,
      end: offset + size,
      type: buffer.toString('ascii', offset + 4, offset + 8),
    });
    offset += size;
  }
  return result;
}

/** Some FFmpeg builds force QuickTime's first chapter to zero. Keep the accurate
 * Nero chapter table in that case. Only the newly prepared output is touched;
 * replacing atom types with free preserves all sizes and media packet offsets. */
export async function useNeroChapters(file: string) {
  const handle = await open(file, 'r+');
  try {
    const size = (await handle.stat()).size;
    let offset = 0;
    while (offset + 8 <= size) {
      const header = Buffer.alloc(16);
      const { bytesRead } = await handle.read(header, 0, 16, offset);
      const length32 = header.readUInt32BE(0);
      const length = length32 === 1 ? Number(header.readBigUInt64BE(8)) : length32 || size - offset;
      const headerSize = length32 === 1 ? 16 : 8;
      if (
        bytesRead < headerSize ||
        !Number.isSafeInteger(length) ||
        length < headerSize ||
        offset + length > size
      )
        throw new AppError('Invalid MP4 metadata bounds.');
      if (header.toString('ascii', 4, 8) !== 'moov') {
        offset += length;
        continue;
      }
      if (length > 64 * 1024 * 1024)
        throw new AppError('MP4 chapter metadata exceeds the safe editing limit.');
      const buffer = Buffer.alloc(length);
      const read = await handle.read(buffer, 0, length, offset);
      if (read.bytesRead !== length) throw new AppError('Incomplete MP4 metadata read.');
      const children = (atom: Atom) => atoms(buffer, atom.body, atom.end);
      const root = atoms(buffer, 0, length)[0];
      const contents = children(root),
        tracks = contents.filter((a) => a.type === 'trak');
      const nero = contents
        .filter((a) => a.type === 'udta')
        .flatMap(children)
        .find((a) => a.type === 'chpl');
      if (!nero)
        throw new AppError(
          'This container cannot preserve a first chapter after time zero. Use export-only markers.',
        );
      const ids = new Set<number>();
      const remove: Atom[] = [];
      for (const track of tracks) {
        for (const ref of children(track)
          .filter((a) => a.type === 'tref')
          .flatMap(children)
          .filter((a) => a.type === 'chap')) {
          for (let i = ref.body; i + 4 <= ref.end; i += 4) ids.add(buffer.readUInt32BE(i));
          remove.push(ref);
        }
      }
      for (const track of tracks) {
        const tkhd = children(track).find((a) => a.type === 'tkhd');
        if (!tkhd) continue;
        const idOffset = tkhd.body + (buffer[tkhd.body] === 1 ? 20 : 12);
        if (idOffset + 4 > tkhd.end) throw new AppError('Invalid MP4 track header.');
        if (ids.has(buffer.readUInt32BE(idOffset))) remove.push(track);
      }
      for (const atom of remove)
        await handle.write(Buffer.from('free'), 0, 4, offset + atom.start + 4);
      return;
    }
    throw new AppError('MP4 metadata was not found.');
  } finally {
    await handle.close();
  }
}
