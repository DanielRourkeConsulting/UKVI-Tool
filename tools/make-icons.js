// Renders icons/icon.svg to icons/16.png, 48.png and 128.png with headless Edge (or Chrome).
// Usage: node tools/make-icons.js   (set BROWSER=path\to\chrome.exe to use another browser)
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const icons = path.join(__dirname, '..', 'icons');
const svg = fs.readFileSync(path.join(icons, 'icon.svg'), 'utf8');
const browser = process.env.BROWSER || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => fs.existsSync(p));
if (!browser) throw new Error('No Edge or Chrome found; set BROWSER.');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ukvi-icons-'));
for (const s of [16, 48, 128]) {
  const html = path.join(tmp, s + '.html');
  fs.writeFileSync(html, `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${s}px;height:${s}px}</style>${svg}`);
  const out = path.join(icons, s + '.png');
  execFileSync(browser, ['--headless', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000',
    `--window-size=${s},${s}`, `--screenshot=${out}`, 'file:///' + html.replace(/\\/g, '/')], { stdio: 'ignore' });
  console.log('wrote', out);
}
fs.rmSync(tmp, { recursive: true, force: true });
