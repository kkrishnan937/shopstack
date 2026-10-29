require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { initSchema } = require("./db");

const authRoutes = require("./routes/auth");
const productRoutes = require("./routes/products");
const cartRoutes = require("./routes/cart");
const orderRoutes = require("./routes/orders");

function createApp({ beforeCartRead } = {}) {
  if (beforeCartRead && process.env.NODE_ENV !== "test") throw new Error("Failure control is test-only");
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.get("/health", (req, res) => res.json({ status: "ok" }));
  app.use("/api/auth", authRoutes);
  app.use("/api/products", productRoutes);
  app.use("/api/cart", cartRoutes({ beforeRead: beforeCartRead }));
  app.use("/api/orders", (req, res, next) => {
    if (req.method !== "GET") return res.status(501).json({ error: "Order submission is not enabled in this increment" });
    next();
  }, orderRoutes);
  return app;
}

const PORT = process.env.PORT || 8080;

// Retry schema init a few times in case Postgres isn't ready yet
// (relevant on first container boot, especially in Kubernetes where the
// backend pod can start before the database pod finishes initializing).
async function start() {
  let attempts = 0;
  let ready = false;
  while (attempts < 10) {
    try {
      await initSchema();
      ready = true;
      break;
    } catch (err) {
      attempts++;
      console.log(`DB not ready yet (attempt ${attempts}/10), retrying in 3s...`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  if (!ready) throw new Error("Database initialization failed");
  createApp().listen(PORT, process.env.HOST || "0.0.0.0", () => console.log(`ShopStack API listening on port ${PORT}`));
}

if (require.main === module) start().catch(() => { console.error("Backend startup failed"); process.exitCode = 1; });
module.exports = { createApp };
