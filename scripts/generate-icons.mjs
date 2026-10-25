import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'assets', 'icon.svg');
const res = path.join(root, 'android', 'app', 'src', 'main', 'res');
const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [density, size] of Object.entries(densities)) {
  const dest = path.join(res, `mipmap-${density}`);
  await sharp(source).resize(size, size).png().toFile(path.join(dest, 'ic_launcher.png'));
  await sharp(source).resize(size, size).png().toFile(path.join(dest, 'ic_launcher_round.png'));
  const foreground = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><g transform="translate(32 32) scale(.75)">${fs.readFileSync(source, 'utf8').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '')}</g></svg>`;
  await sharp(Buffer.from(foreground)).resize(size, size).png().toFile(path.join(dest, 'ic_launcher_foreground.png'));
}

const splashFiles = fs.readdirSync(res, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && entry.name.startsWith('drawable'))
  .map(entry => path.join(res, entry.name, 'splash.png'))
  .filter(file => fs.existsSync(file));
for (const file of splashFiles) {
  const { width, height } = await sharp(file).metadata();
  const emblemSize = Math.round(Math.min(width, height) * 0.34);
  const emblem = await sharp(source).resize(emblemSize, emblemSize).png().toBuffer();
  await sharp({ create: { width, height, channels: 4, background: '#0c0f0e' } })
    .composite([{ input: emblem, left: Math.round((width - emblemSize) / 2), top: Math.round((height - emblemSize) / 2) }])
    .png().toFile(file + '.new');
  fs.renameSync(file + '.new', file);
}
