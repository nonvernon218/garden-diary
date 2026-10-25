import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'qa');
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = path.resolve(root, 'dist', '.' + pathname);
  if (!file.startsWith(path.join(root, 'dist') + path.sep) && file !== path.join(root, 'dist')) { response.writeHead(403).end(); return; }
  const actual = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(root, 'dist', 'index.html');
  const type = actual.endsWith('.js') ? 'text/javascript' : actual.endsWith('.css') ? 'text/css' : 'text/html';
  response.writeHead(200, { 'content-type': type }).end(fs.readFileSync(actual));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Local preview did not start');
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'domcontentloaded' });
await page.locator('#pin').waitFor();
await page.screenshot({ path: path.join(output, 'auth.png'), fullPage: true });
await page.locator('#pin').fill('1234');
await page.locator('#pin-confirm').fill('1234');
await page.locator('#auth-form button[type=submit]').click();
await page.getByText('身体地图').waitFor();
await page.screenshot({ path: path.join(output, 'home.png'), fullPage: true });
const homeBox = await page.locator('#body-view canvas').boundingBox();
for (let attempt = 0; attempt < 5; attempt++) {
  await page.touchscreen.tap(homeBox.x + homeBox.width / 2, homeBox.y + homeBox.height * 0.51);
  await page.locator('#view-point').waitFor();
  await page.locator('.overlay-backdrop').click({ position: { x: 2, y: 2 } });
  await page.locator('#body-view canvas').waitFor();
}
await page.touchscreen.tap(homeBox.x + homeBox.width / 2, homeBox.y + homeBox.height * 0.51);
await page.locator('#view-point').click();
await page.getByText('该部位的全部记录').waitFor();
await page.locator('[data-go="home"]').last().click();
const touchBox = await page.locator('#body-view canvas').boundingBox();
await page.locator('[data-zoom="in"]').click();
await page.locator('[data-zoom="in"]').click();
await page.waitForTimeout(300);
const beforePan = await page.locator('#body-view canvas').screenshot();
const cdp = await page.context().newCDPSession(page);
const fingers = (dy) => [
  { x: Math.round(touchBox.x + touchBox.width * 0.42), y: Math.round(touchBox.y + touchBox.height * 0.5 + dy), id: 1 },
  { x: Math.round(touchBox.x + touchBox.width * 0.58), y: Math.round(touchBox.y + touchBox.height * 0.5 + dy), id: 2 },
];
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(0) });
for (const dy of [10, 20, 30, 40]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(dy) });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(350);
const afterPan = await page.locator('#body-view canvas').screenshot();
if (beforePan.equals(afterPan)) throw new Error('Two-finger pan did not move the model');
if (await page.locator('#overlay').textContent()) throw new Error('Two-finger pan unexpectedly selected a body part');
await page.locator('#new-event').click();
await page.locator('#event-description').fill('测试事件经过');
await page.locator('#event-place').fill('测试地点');
await page.locator('#add-mark').click();
await page.locator('#picker-body canvas').waitFor();
await page.screenshot({ path: path.join(output, 'picker.png'), fullPage: true });
const box = await page.locator('#picker-body canvas').boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.44);
await page.locator('.mark-editor').waitFor();
await page.locator('[data-mark-field="action-select"]').selectOption('被抓');
await page.locator('[data-mark-field="actors"]').fill('甲、乙');
await page.locator('[data-mark-field="severity"]').fill('8');
await page.locator('#add-mark').click();
const secondBox = await page.locator('#picker-body canvas').boundingBox();
await page.mouse.click(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height * 0.28);
await page.locator('.mark-editor').nth(1).waitFor();
await page.locator('[data-mark-field="action-select"]').nth(1).selectOption('被掐');
await page.locator('[data-mark-field="actors"]').nth(1).fill('乙');
await page.locator('[data-mark-field="severity"]').nth(1).fill('4');
await page.screenshot({ path: path.join(output, 'editor.png'), fullPage: true });
await page.locator('#save-event').click();
await page.getByText('事件记录', { exact: true }).waitFor();
await page.screenshot({ path: path.join(output, 'detail.png'), fullPage: true });
await page.locator('#add-followup').click();
await page.locator('#followup-text').fill('第二天的补充');
await page.locator('#save-followup').click();
await page.getByText('第二天的补充').waitFor();
await page.locator('[data-edit-followup]').click();
await page.locator('#followup-text').fill('第二天的补充，已修改');
await page.locator('#save-followup').click();
await page.getByText('第二天的补充，已修改').waitFor();
await page.locator('#edit-event').click();
await page.locator('#event-description').fill('测试事件经过，已修改');
await page.locator('#save-event').click();
await page.getByText('测试事件经过，已修改').waitFor();
await page.locator('[data-go="events"]').last().click();
await page.locator('#calendar-toggle').click();
await page.locator('.calendar-popover').waitFor();
await page.screenshot({ path: path.join(output, 'calendar.png'), fullPage: true });
await page.locator('[data-calendar-today]').click();
await page.locator('.event-card').first().waitFor();
await page.locator('[data-go="people"]').last().click();
await page.locator('[data-person="甲"]').waitFor();
await page.locator('[data-person="乙"]').waitFor();
await page.locator('[data-go="settings"]').click();
await page.locator('input[name="old"]').fill('1234');
await page.locator('input[name="new"]').fill('654321');
await page.locator('#change-pin button[type=submit]').click();
await page.getByText('当前使用 6 位数字密码').waitFor();
await page.locator('#logout').click();
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('#pin').fill('654321');
await page.locator('#auth-form button[type=submit]').click();
await page.getByText('身体地图').waitFor();
console.log(JSON.stringify({ result: 'passed', errors, screenshots: output }));
await browser.close();
server.close();
if (errors.length) process.exitCode = 1;
