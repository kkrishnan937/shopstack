// Real React build + Express routes + file-backed embedded PostgreSQL.
// No browser request mocking; the test-only hook fails the real cart read.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "../..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runRoot = path.join(root, ".local", "cart-uat", runId);
const evidence = path.resolve(process.env.EVIDENCE_DIR || path.join(runRoot, "evidence"));
fs.mkdirSync(evidence, { recursive: true });
process.env.NODE_ENV = "test";
const postgresUrl = process.env.CART_UAT_PG_URL;
const pgConfig = postgresUrl ? new URL(postgresUrl) : null;
if (pgConfig && (!['localhost', '127.0.0.1', '[::1]'].includes(pgConfig.hostname) || pgConfig.pathname !== '/postgres')) {
  throw new Error("CART_UAT_PG_URL must name a loopback test server's postgres maintenance database");
}
process.env.DB_ENGINE = postgresUrl ? "postgres" : "pglite";
if (pgConfig) {
  process.env.DB_HOST = pgConfig.hostname;
  process.env.DB_PORT = pgConfig.port || '5432';
  process.env.DB_USER = decodeURIComponent(pgConfig.username);
  process.env.DB_PASSWORD = decodeURIComponent(pgConfig.password);
  process.env.DB_NAME = `shopstack_uat_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}
process.env.PGLITE_DATA_DIR = path.join(runRoot, "database");
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
const { pool, initSchema } = require("../db");
const { createApp } = require("../server");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const express = require("express");
const results = [];
const network = [];
const observedCarts = [];
let server, browser, databaseClosed = false;
let admin, postgresCreated = false, postgresVersion;
let failRead = false;
let failCatalog = false;
const noticeStates = new Set();
let coreAfter;
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const sourceFiles = ["backend/db.js", "backend/server.js", "backend/routes/cart.js", "backend/services/cart-read.js", "backend/middleware/auth.js", "backend/routes/auth.js", "backend/test/cart-view.e2e.cjs", "frontend/src/App.jsx", "frontend/src/styles.css", "frontend/vite.config.js", "backend/package.json", "backend/pnpm-lock.yaml"];
const manifest = Object.fromEntries(sourceFiles.map(file => [file, hash(fs.readFileSync(path.join(root, file)))]));
manifest["frontend/dist/index.html"] = hash(fs.readFileSync(path.join(root, "frontend/dist/index.html")));
const assetDir = path.join(root, "frontend/dist/assets");
for (const file of fs.readdirSync(assetDir)) manifest[`frontend/dist/assets/${file}`] = hash(fs.readFileSync(path.join(assetDir, file)));
const buildFingerprint = hash(JSON.stringify(manifest));
async function step(id, title, work) {
  const startedAt = new Date().toISOString();
  try { const detail = await work(); results.push({ id, title, status: "Pass", startedAt, detail }); }
  catch (error) { results.push({ id, title, status: "Fail", startedAt, actual: error.message }); throw error; }
}
async function snapshot(userId) {
  return {
    items: (await pool.query("SELECT id, user_id, product_id, quantity FROM cart_items WHERE user_id = $1 ORDER BY id", [userId])).rows,
    metadata: (await pool.query("SELECT * FROM cart_state WHERE user_id = $1", [userId])).rows,
  };
}
async function main() {
  if (postgresUrl) {
    admin = new (require('pg').Client)({ connectionString: postgresUrl });
    await admin.connect();
    // Generated identifier only; never reset an existing user database.
    assert.match(process.env.DB_NAME, /^shopstack_uat_[a-z0-9_]+$/);
    await admin.query(`CREATE DATABASE "${process.env.DB_NAME}"`);
    postgresCreated = true;
  }
  await initSchema();
  if (postgresUrl) postgresVersion = (await pool.query('SELECT version()')).rows[0].version;
  const password = crypto.randomBytes(18).toString("base64url");
  const email = "cart-review@example.test";
  const { rows: [user] } = await pool.query("INSERT INTO users (name, email, password_hash) VALUES ($1,$2,$3) RETURNING id", ["Synthetic Cart Reviewer", email, await bcrypt.hash(password, 10)]);
  const { rows: products } = await pool.query("SELECT id, name FROM products ORDER BY id");
  const mug = products.find(p => p.name === "Coffee Mug");
  const mouse = products.find(p => p.name === "Wireless Mouse");
  await pool.query("INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1,$2,2), ($1,$3,1)", [user.id, mug.id, mouse.id]);
  await pool.query("INSERT INTO cart_state (user_id, last_changed_at) VALUES ($1, CURRENT_TIMESTAMP - INTERVAL '20 days')", [user.id]);
  const before = await snapshot(user.id);
  const app = express();
  app.get('/api/products', (req,res,next) => failCatalog ? res.status(503).json({error:'Controlled catalog failure'}) : next());
  app.use(createApp({ beforeCartRead: () => { if (failRead) throw new Error("Controlled cart-read failure"); } }));
  app.use(express.static(path.join(root, "frontend/dist")));
  server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.EDGE_EXECUTABLE || (process.platform === "win32" ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" : undefined);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const browserErrors = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  page.on("response", response => {
    if (new URL(response.url()).pathname === "/api/cart") network.push({ method: response.request().method(), path: "/api/cart", status: response.status(), observedAt: new Date().toISOString() });
  });
  await page.goto(base);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  const loginResponse = page.waitForResponse(r => new URL(r.url()).pathname === "/api/auth/login");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  assert.equal((await loginResponse).status(), 200);
  await page.getByText("Logged in as Synthetic Cart Reviewer").waitFor();
  const capture = async (name, state) => {
    if (state) {
      await page.getByText('Cart subtotal only. Tax and shipping are calculated at demo checkout. No payment is taken.', {exact:true}).waitFor();
      noticeStates.add(state);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.locator(".app-shell").screenshot({ path: path.join(evidence, name) });
    return name;
  };
  async function openCart() {
    const response = page.waitForResponse(r => new URL(r.url()).pathname === "/api/cart");
    await page.getByRole("link", { name: "View cart", exact: true }).click();
    const result = await response;
    await page.getByRole("heading", { name: "Your cart", exact: true }).waitFor();
    return result;
  }
  await step("CART-T-04", "Controlled cart-read failure is not shown as empty", async () => {
    failRead = true;
    const response = await openCart();
    assert.equal(response.status(), 503);
    await page.getByText("Couldn't load your cart. Please try again.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Retry", exact: true }).count(), 1);
    assert.equal(await page.getByText("Cart is empty", { exact: true }).count(), 0);
    assert.equal(await page.locator(".cart-subtotal").count(), 0);
    assert.deepEqual(await snapshot(user.id), before);
    return { responseStatus: 503, noEmptyClaim: true, noConfirmedSubtotal: true, savedStateUnchanged: true, screenshot: await capture("01-cart-load-failure.png", 'error') };
  });
  await step("CART-T-05", "Retry fails safely, then recovers when failure is removed", async () => {
    let response = page.waitForResponse(r => new URL(r.url()).pathname === "/api/cart");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    assert.equal((await response).status(), 503);
    await page.getByRole("button", { name: "Retry", exact: true }).waitFor();
    assert.deepEqual(await snapshot(user.id), before);
    const repeatedFailure = await capture("02-retry-still-failing.png");
    failRead = false;
    response = page.waitForResponse(r => new URL(r.url()).pathname === "/api/cart");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    const recovered = await response;
    assert.equal(recovered.status(), 200);
    const data = await recovered.json(); observedCarts.push(data);
    assert.equal(data.subtotalCents, 4999);
    await page.getByText("CAD 49.99", { exact: true }).waitFor();
    assert.equal(await page.getByText("Couldn't load your cart. Please try again.", { exact: true }).count(), 0);
    assert.deepEqual(await snapshot(user.id), before);
    assert(network.every(r => r.method === "GET"));
    return { retryStatuses: [503, 200], subtotalCents: 4999, savedStateUnchanged: true, onlyCartReads: true, screenshots: [repeatedFailure, await capture("03-cart-recovered.png", 'active')] };
  });
  await step("CART-T-01", "Saved products and integer-cent amounts match rendered cart", async () => {
    const data = observedCarts[0];
    assert.equal(data.currency, "CAD"); assert.equal(data.items.length, 2);
    const mugLine = page.locator(".cart-line").filter({ has: page.getByRole("heading", { name: "Coffee Mug", exact: true }) });
    await mugLine.getByText("2", { exact: true }).waitFor();
    assert.match(await mugLine.innerText(), /CAD 12\.50/); assert.match(await mugLine.innerText(), /CAD 25\.00/);
    const mouseLine = page.locator(".cart-line").filter({ has: page.getByRole("heading", { name: "Wireless Mouse", exact: true }) });
    assert.match(await mouseLine.innerText(), /CAD 24\.99/);
    return { products: ["Coffee Mug", "Wireless Mouse"], amountsComeFromAPI: true };
  });
  await step("CART-T-02", "Two-mug/one-mouse subtotal is CAD 49.99", async () => {
    assert.deepEqual(observedCarts[0].items.map(i => [i.quantity, i.unitPriceCents, i.lineTotalCents]), [[2, 1250, 2500], [1, 2499, 2499]]);
    assert.equal(await page.locator(".cart-subtotal strong").innerText(), "CAD 49.99");
    return { quantities: [2, 1], unitCents: [1250, 2499], lineCents: [2500, 2499], subtotalCents: 4999 };
  });
  await step("CART-T-29", "Read at day 20 does not restart retention", async () => {
    assert.deepEqual((await snapshot(user.id)).metadata, before.metadata);
    return { lastChangedUnchanged: true, activeAtTwentyDays: observedCarts[0].state === "active" };
  });
  coreAfter = await snapshot(user.id);
  const token = await page.evaluate(() => localStorage.getItem("token"));
  await step("SUP-AUTH-WRITES", "Unauthenticated reads rejected and mutation gates enforced", async () => {
    assert.equal((await fetch(base+"/api/cart")).status, 401);
    for (const [method, url] of [["POST", "/api/cart"], ["DELETE", "/api/cart/1"], ["POST", "/api/orders"]]) {
      const response = await fetch(base+url, { method, headers: { Authorization: `Bearer ${token}` } });
      assert.equal(response.status, 501);
    }
    assert.deepEqual(await snapshot(user.id), before);
    return { unauthenticatedRead: 401, mutationResponses: [501,501,501], savedStateUnchanged: true };
  });
  await step("CART-T-06", "Continue shopping preserves nonempty and empty fixtures", async () => {
    await page.getByRole("link", { name: "Continue shopping", exact: true }).click();
    await page.locator(".product-section").waitFor();
    assert.deepEqual(await snapshot(user.id), before);
    await openCart(); await page.getByText("CAD 49.99", { exact: true }).waitFor();
    // Explicit controlled fixture change, not a customer/cart API mutation.
    await pool.query("DELETE FROM cart_items WHERE user_id = $1", [user.id]);
    await page.reload(); await page.getByText("Cart is empty", { exact: true }).waitFor();
    await page.getByRole("link", { name: "Continue shopping", exact: true }).click();
    await page.locator(".product-section").waitFor();
    assert.equal((await snapshot(user.id)).items.length, 0);
    await openCart(); await page.getByText("Cart is empty", { exact: true }).waitFor();
    return { nonemptyAndEmptyVariants: "Pass", noNavigationMutation: true };
  });
  await step("CART-T-03", "Confirmed empty cart shows zero and continuation", async () => {
    await page.getByText("Cart is empty", { exact: true }).waitFor();
    assert.equal(await page.locator(".cart-subtotal strong").innerText(), "CAD 0.00");
    assert.equal(await page.getByText("Your saved cart expired after 30 days without changes.", { exact: true }).count(), 0);
    return { subtotalCents: 0, expiryNoticeAbsent: true, screenshot: await capture("04-empty-cart.png", 'empty') };
  });
  await step("CART-T-28", "Expired saved items removed with persistent explanation", async () => {
    await pool.query("INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1,$2,2)", [user.id,mug.id]);
    await pool.query("UPDATE cart_state SET last_changed_at = CURRENT_TIMESTAMP - INTERVAL '721 hours', expired = FALSE WHERE user_id = $1", [user.id]);
    await page.reload();
    await page.getByText("Your saved cart expired after 30 days without changes.", { exact: true }).waitFor();
    assert.equal(await page.locator(".cart-subtotal strong").innerText(), "CAD 0.00");
    const expiredState = await snapshot(user.id);
    assert.equal(expiredState.items.length, 0); assert.equal(expiredState.metadata[0].expired, true);
    const screenshot = await capture("05-expired-cart.png", 'expired');
    await page.getByRole("button", { name: "Dismiss expiry notice", exact: true }).click();
    assert.equal(await page.getByText("Your saved cart expired after 30 days without changes.", { exact: true }).count(), 0);
    assert.equal((await snapshot(user.id)).metadata[0].expired, true);
    await page.getByRole("link", { name: "Continue shopping", exact: true }).click();
    await page.locator(".product-section").waitFor(); await openCart();
    await page.getByText("Your saved cart expired after 30 days without changes.", { exact: true }).waitFor();
    assert.deepEqual(await snapshot(user.id), expiredState);
    return { expiredAfter721Hours: true, savedItemsRemoved: true, persistentReason: true, viewLocalDismissal: true, screenshot };
  });
  await step("CART-T-07", "Pricing notice present in implemented cart states", async () => {
    assert.deepEqual([...noticeStates].sort(), ['active','empty','error','expired']);
    await page.getByText("Cart subtotal only. Tax and shipping are calculated at demo checkout. No payment is taken.", { exact: true }).waitFor();
    return { notice: "Cart subtotal only. Tax and shipping are calculated at demo checkout. No payment is taken.", checkedStates: [...noticeStates].sort(), scope: "Four implemented states; mutations/checkout not enabled" };
  });
  await step("SUP-SESSION", "Expired token requests sign-in without expiring cart", async () => {
    const prior = await snapshot(user.id);
    const expiredToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: -1 });
    await page.evaluate(value => localStorage.setItem("token", value), expiredToken);
    await page.reload();
    await page.getByText("Your session expired. Please sign in again to view your cart.", { exact: true }).waitFor();
    assert.equal(await page.getByText("Your saved cart expired after 30 days without changes.", { exact: true }).count(), 0);
    assert.equal(await page.locator(".cart-subtotal").count(), 0);
    assert.deepEqual(await snapshot(user.id), prior);
    await capture("06-session-expired.png");
    // Restore the legitimate test login for the narrow-screen smoke check.
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await page.getByRole("textbox", { name: "Password" }).fill(password);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page.getByText("Your saved cart expired after 30 days without changes.", { exact: true }).waitFor();
    return { cartReadStatus: 401, noCartStateChange: true, noExpiryNoticeFromTokenLapse: true };
  });
  await step("SUP-MOBILE", "Cart view fits 320px viewport", async () => {
    await page.setViewportSize({width:320,height:850});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    return { width: 320, horizontalOverflow: false, screenshot: await capture("07-mobile-cart.png") };
  });
  await step("SUP-OWNERSHIP", "Another customer's saved line cannot appear in this cart", async () => {
    const {rows:[other]} = await pool.query("INSERT INTO users (name,email,password_hash) VALUES ($1,$2,$3) RETURNING id", ["Other Synthetic Customer", "other@example.test", await bcrypt.hash(password,10)]);
    await pool.query("INSERT INTO cart_items (user_id,product_id,quantity) VALUES ($1,$2,7)", [other.id, mouse.id]);
    const response = await fetch(base+"/api/cart", {headers:{Authorization:`Bearer ${token}`}});
    const body = await response.json();
    assert.equal(response.status,200); assert.equal(body.items.length,0);
    assert.equal((await pool.query("SELECT quantity FROM cart_items WHERE user_id=$1",[other.id])).rows[0].quantity,7);
    return {otherCustomerItemsNotExposed:true,otherCustomerStateUnchanged:true};
  });
  await step("SUP-CATALOG", "Catalog outage does not crash the cart page", async () => {
    failCatalog = true;
    await page.reload();
    await page.getByText('Could not reach backend API', {exact:true}).waitFor();
    await page.getByRole('heading', {name:'Your cart',exact:true}).waitFor();
    await page.getByText('Cart is empty', {exact:true}).waitFor();
    assert.equal(await page.locator('.cart-subtotal strong').innerText(), 'CAD 0.00');
    assert.deepEqual(browserErrors, []);
    failCatalog = false;
    return {catalogStatus:503,cartStillRendered:true,noUncaughtErrors:true};
  });
  // Restore original known fixture for the durable close/reopen verification.
  for(const item of before.items) await pool.query("INSERT INTO cart_items (id,user_id,product_id,quantity) VALUES ($1,$2,$3,$4)", [item.id,item.user_id,item.product_id,item.quantity]);
  await pool.query("UPDATE cart_state SET version=$2, last_changed_at=$3, expired=$4 WHERE user_id=$1", [user.id,before.metadata[0].version,before.metadata[0].last_changed_at,before.metadata[0].expired]);
  await step("SUP-PERSIST", postgresUrl ? "Reopen PostgreSQL connection and verify committed fixture" : "Close and reopen file-backed database without losing fixture", async () => {
    assert.deepEqual(await snapshot(user.id), before);
    await pool.end(); databaseClosed = true;
    const reopened = postgresUrl
      ? new (require('pg').Pool)({host:process.env.DB_HOST, port:Number(process.env.DB_PORT), user:process.env.DB_USER, password:process.env.DB_PASSWORD, database:process.env.DB_NAME})
      : new (require("@electric-sql/pglite").PGlite)(process.env.PGLITE_DATA_DIR);
    try {
      const items = (await reopened.query("SELECT id, user_id, product_id, quantity FROM cart_items WHERE user_id = $1 ORDER BY id", [user.id])).rows;
      assert.deepEqual(items, before.items);
      return { ...(postgresUrl ? {persistedAfterConnectionReopen:true} : {persistedAfterDatabaseReopen:true}), quantities: items.map(i => i.quantity) };
    } finally { if (postgresUrl) await reopened.end(); else await reopened.close(); }
  });
  assert.deepEqual(browserErrors, []);
  fs.writeFileSync(path.join(evidence, "cart-response.json"), JSON.stringify(observedCarts[0], null, 2));
  fs.writeFileSync(path.join(evidence, "saved-state-before.json"), JSON.stringify(before, null, 2));
  // Snapshot equality was asserted before close and after a durable reopen.
  fs.writeFileSync(path.join(evidence, "saved-state-after.json"), JSON.stringify(coreAfter, null, 2));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (!databaseClosed) await pool.end();
  if (admin) {
    if (postgresCreated) await admin.query(`DROP DATABASE "${process.env.DB_NAME}"`);
    await admin.end();
  }
  const report = {
    runId, observedAt: new Date().toISOString(), buildFingerprint,
    environment: { node: process.version, database: postgresUrl ? postgresVersion : "PGlite 0.3.14, file-backed embedded PostgreSQL", browser: process.platform === 'win32' ? 'Microsoft Edge headless' : 'Chromium headless', frontend: "Vite production build served by Express on loopback", syntheticOnly: true, isolatedDatabaseDropped: postgresUrl ? true : undefined },
    results, cartRequests: network,
    caveats: ["Automated acceptance checks; no independent business sign-off", postgresUrl ? "Isolated PostgreSQL server test; not production deployment" : "Not a conventional PostgreSQL server deployment", "No mutations, checkout, logout revocation or unresolved recovery release claimed"],
  };
  fs.writeFileSync(path.join(evidence, "run-results.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(evidence, "build-manifest.json"), JSON.stringify({ buildFingerprint, files: manifest }, null, 2));
  console.log(JSON.stringify({ evidence, buildFingerprint, results: results.map(({ id, status }) => ({ id, status })) }, null, 2));
});
