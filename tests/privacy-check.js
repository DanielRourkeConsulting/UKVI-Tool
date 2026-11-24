// Fails if any shipped file contains a way to reach the network, load remote code, or run dynamic code.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const files = ['background.js', 'lib.js', 'content.js', 'options.js', 'options.html', 'options.css'];
const banned = [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /EventSource/, /\beval\s*\(/, /new Function/, /importScripts/,
  /https?:\/\/(?!www\.w3\.org)/, /<script[^>]+src=["'](?!lib\.js|options\.js)/, /<link[^>]+href=["']https?:/, /chrome\.runtime\.connect/, /chrome\.identity/, /chrome\.cookies/];
let bad = 0;
for (const f of files) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  for (const re of banned) { const m = re.exec(src); if (m) { bad++; console.log('BANNED in ' + f + ': ' + m[0]); } }
}
const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const okPerms = ['storage', 'activeTab', 'scripting'];
if (m.permissions.some((p) => !okPerms.includes(p))) { bad++; console.log('Unexpected permission: ' + m.permissions); }
if (m.host_permissions || m.optional_host_permissions || m.content_scripts || m.externally_connectable || m.web_accessible_resources) { bad++; console.log('manifest has host access / auto scripts / external exposure'); }
if (!/connect-src 'none'/.test(m.content_security_policy.extension_pages)) { bad++; console.log('CSP should block connect-src'); }
console.log(bad ? bad + ' privacy problem(s)' : 'privacy check passed: no network APIs, no remote code, no host permissions, no auto-run scripts');
process.exit(bad ? 1 : 0);
