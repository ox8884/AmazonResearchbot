import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const css = await readFile(new URL('../packages/ui/src/tokens.css', import.meta.url), 'utf8');
function token(name) {
  const key = '--' + name + ':';
  const i = css.indexOf(key);
  assert.ok(i >= 0, name + ' token missing');
  const slice = css.slice(i + key.length).trimStart();
  assert.equal(slice[0], '#', name + ' is not a hex color');
  return slice.slice(0, 7).toLowerCase();
}
function px(name) {
  const key = '--' + name + ':';
  const i = css.indexOf(key);
  assert.ok(i >= 0, name + ' size missing');
  const slice = css.slice(i + key.length).trimStart();
  const value = Number.parseInt(slice, 10);
  assert.ok(Number.isFinite(value), name + ' is not px');
  return value;
}
function luminance(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function ratio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
const canvas = token('canvas');
const ink = token('ink');
const surface = token('surface');
const muted = token('muted');
const action = token('action');
const pairs = [
  ['ink/canvas', ink, canvas, 4.5],
  ['ink/surface', ink, surface, 4.5],
  ['muted/canvas', muted, canvas, 4.5],
  ['surface/action', surface, action, 4.5],
  ['action/canvas', action, canvas, 4.5],
  ['ok/ok-bg', token('ok'), token('ok-bg'), 4.5],
  ['warn/warn-bg', token('warn'), token('warn-bg'), 4.5],
  ['danger/danger-bg', token('danger'), token('danger-bg'), 4.5],
];
const measured = {};
for (const [name, fg, bg, min] of pairs) {
  const value = ratio(fg, bg);
  measured[name] = Number(value.toFixed(2));
  assert.ok(value >= min, name + ' contrast ' + value.toFixed(2) + ' < ' + min);
}
assert.equal(px('control'), 44);
assert.equal(px('small'), 14);
assert.equal(px('space-8'), 8);
assert.equal(action, '#164e63');
assert.equal(canvas, '#f4f6f8');
assert.equal(ink, '#172b3a');
console.log(JSON.stringify({ scenario: 'contrast', result: 'PASS', aa: measured, controlPx: 44, minTypePx: 14 }));
