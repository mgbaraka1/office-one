// One-off icon generator. Renders build/icon.svg in an offscreen Electron
// window, then writes build/icon.ico (multi-size, PNG-compressed entries) and
// build/icon.png (256). Run with: npx electron build/gen-icon.js
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const SVG = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
const SIZES = [256, 128, 64, 48, 32, 16];
const RENDER = 512; // render big, downscale for crisp small sizes

function buildIco(pngs) {
  // pngs: [{ size, buf }]. ICONDIR (6) + N*ICONDIRENTRY (16) + image data.
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);          // reserved
  head.writeUInt16LE(1, 2);          // type = icon
  head.writeUInt16LE(pngs.length, 4);

  const entries = [];
  const datas = [];
  let offset = 6 + pngs.length * 16;
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width  (0 == 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height (0 == 256)
    e.writeUInt8(0, 2);              // palette
    e.writeUInt8(0, 3);              // reserved
    e.writeUInt16LE(1, 4);           // color planes
    e.writeUInt16LE(32, 6);          // bits per pixel
    e.writeUInt32LE(buf.length, 8);  // image size
    e.writeUInt32LE(offset, 12);     // offset
    entries.push(e);
    datas.push(buf);
    offset += buf.length;
  }
  return Buffer.concat([head, ...entries, ...datas]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: RENDER, height: RENDER, show: false,
    transparent: true, frame: false,
    webPreferences: { offscreen: true },
  });

  const html = `<!doctype html><html><head><meta charset="utf8">
    <style>html,body{margin:0;padding:0;background:transparent}
    img{display:block;width:${RENDER}px;height:${RENDER}px}</style></head>
    <body><img src="data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}"></body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise(r => setTimeout(r, 300));

  const full = await win.webContents.capturePage();

  const pngs = [];
  for (const size of SIZES) {
    const img = full.resize({ width: size, height: size, quality: 'best' });
    pngs.push({ size, buf: img.toPNG() });
  }

  fs.writeFileSync(path.join(__dirname, 'icon.ico'), buildIco(pngs));
  fs.writeFileSync(path.join(__dirname, 'icon.png'),
    pngs.find(p => p.size === 256).buf);

  console.log('wrote build/icon.ico and build/icon.png');
  app.quit();
});
