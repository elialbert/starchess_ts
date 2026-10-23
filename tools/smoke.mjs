// Headless smoke test: serves dist/ (or uses a given URL), watches a fast bot
// game, then drives the controls: pause, step, new game. Then plays a few
// moves against a bot by clicking, with undo and as black. Checks the board
// shows exactly the game's pieces, and fails on any console error.
// Usage: node tools/smoke.mjs [width] [height] [--shots] [url]
// Screenshots go to $SMOKE_SHOT_DIR (default /tmp).
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../dist");
const SHOT_DIR = process.env.SMOKE_SHOT_DIR ?? "/tmp";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const args = process.argv.slice(2);
const shots = args.includes("--shots");
const [w = "1280", h = "800", urlArg] = args.filter((a) => a !== "--shots");

let server = null;
if (!urlArg) {
  server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = join(ROOT, p);
    if (!existsSync(file)) {
      res.writeHead(404);
      res.end("nf");
      return;
    }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(8898, r));
}
const target = new URL(urlArg ?? "http://localhost:8898/");
target.searchParams.set("speed", "fast");
target.searchParams.set("white", "magpie");
target.searchParams.set("black", "tactician");
target.searchParams.set("opponent", "magpie");

const exe = [process.env.CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(
  (p) => p && existsSync(p)
);
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2 });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
};
const shot = async (name) => shots && (await page.screenshot({ path: `${SHOT_DIR}/starchess-${name}-${w}x${h}.png` }));
const sc = (fn) => page.evaluate(fn);

/** The board shows exactly the pieces the game has, on the right spaces. */
async function checkBoard(when) {
  // let slides and fades finish
  await page.waitForTimeout(600);
  const problem = await sc(() => {
    const cells = window.__sc.game.cells;
    const shown = [...document.querySelectorAll(".piece:not(.gone)")];
    const want = cells.filter(Boolean).length;
    if (shown.length !== want) return `${shown.length} pieces shown, game has ${want}`;
    for (const g of shown) {
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(g.style.transform);
      const hex = [...document.querySelectorAll(".hex")].find((h) => {
        const t = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(h.getAttribute("transform"));
        return Math.abs(+t[1] - +m[1]) < 0.1 && Math.abs(+t[2] - +m[2]) < 0.1;
      });
      if (!hex) return "a piece sits off the board";
      const space = +hex.dataset.space;
      if (String(cells[space]) !== g.dataset.piece) return `space ${space} shows ${g.dataset.piece}, game has ${cells[space]}`;
      const black = cells[space] >> 3 === 1;
      if (g.classList.contains("black") !== black || g.classList.contains("white") === black) return `space ${space} is drawn in the wrong colour (${g.getAttribute("class")})`;
    }
    return null;
  });
  if (problem) fail(`${when}: ${problem}`);
}

await page.goto(target.href, { waitUntil: "networkidle" });
if ((await page.locator(".hex").count()) !== 37) fail("the board doesn't have 37 spaces");
await shot("start");

await page.waitForFunction(() => window.__sc.plies >= 18 || window.__sc.over, null, { timeout: 60000 });
await checkBoard("mid-game");
if (!(await sc(() => window.__sc.over)) && (await page.locator("#banner").isVisible())) fail("the game-over banner shows mid-game");
await shot("playing");
const fullMoves = Math.ceil((await sc(() => window.__sc.plies)) / 2);
if ((await page.locator("#moves li").count()) < fullMoves) fail("the move list isn't filling in");

// pause holds the game still; step plays exactly one move
await page.click("#play");
await page.waitForTimeout(1500);
const held = await sc(() => window.__sc.plies);
await page.waitForTimeout(1500);
if ((await sc(() => window.__sc.plies)) !== held) fail("the game kept going while paused");
if (!(await sc(() => window.__sc.over))) {
  await page.click("#step");
  await page.waitForFunction((n) => window.__sc.plies === n + 1, held, { timeout: 10000 });
  await checkBoard("after a step");
}

// a new game resets the board
await page.click("#new");
await page.waitForTimeout(300);
const fresh = await sc(() => ({ plies: window.__sc.plies, pieces: window.__sc.game.cells.filter(Boolean).length }));
if (fresh.plies !== 0 || fresh.pieces !== 20) fail(`new game didn't reset: ${JSON.stringify(fresh)}`);
await page.click("#play");

// play on to the end of a game
await page.waitForFunction(() => window.__sc.over, null, { timeout: 180000 });
await checkBoard("at the end");
if (!(await page.locator("#banner").isVisible())) fail("no banner at the end of the game");
await shot("over");
const over = await sc(() => window.__sc.over);
console.log(`game over: ${JSON.stringify(over)} after ${await sc(() => window.__sc.game.ply)} plies`);

// play mode: click a piece, then where it goes; the bot answers
const pressed = (sel) => page.locator(sel).getAttribute("aria-pressed");
const yourTurn = () => page.waitForFunction(() => window.__sc.yourMoves.length > 0, null, { timeout: 15000 });
async function clickMove() {
  const m = await sc(() => window.__sc.yourMoves.find((m) => !m.promo));
  await page.click(`.hex[data-space="${m.from}"]`);
  if ((await page.locator(".hex.target").count()) < 1) fail("picking up a piece shows nowhere to go");
  await page.click(`.hex[data-space="${m.to}"]`);
}
await page.click('[data-mode="play"]');
if ((await pressed('[data-mode="play"]')) !== "true") fail("play mode isn't selected");
if (!(await page.locator("#play").isHidden()) || (await page.locator("#undo").isHidden())) fail("play mode shows the wrong controls");
await page.click('[data-side="white"]');
await yourTurn();
if ((await sc(() => window.__sc.plies)) !== 0) fail("as white, someone moved before you");
await clickMove();
await page.waitForFunction(() => window.__sc.plies === 2, null, { timeout: 15000 });
await yourTurn();
await checkBoard("after your move and the reply");
await shot("play");
await page.click("#undo");
await yourTurn();
if ((await sc(() => window.__sc.plies)) !== 0) fail("undo didn't take back your move and the reply");
await checkBoard("after undo");

await page.click('[data-side="black"]');
if (!(await page.locator("svg.board.flipped").count())) fail("playing black doesn't turn the board round");
await page.waitForFunction(() => window.__sc.plies === 1 && window.__sc.yourMoves.length > 0, null, { timeout: 15000 });
await clickMove();
await page.waitForFunction(() => window.__sc.plies === 3, null, { timeout: 15000 });
await checkBoard("playing black");
await shot("play-black");

// and back to watching
await page.click('[data-mode="watch"]');
if (await page.locator("svg.board.flipped").count()) fail("the board stays turned round when watching");
await page.waitForFunction(() => window.__sc.plies >= 4, null, { timeout: 30000 });
await checkBoard("watching again");

if (errors.length) fail(`console errors:\n${errors.join("\n")}`);
await browser.close();
server?.close();
if (!process.exitCode) console.log(`smoke ok at ${w}x${h}`);
