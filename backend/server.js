require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { initSchema } = require("./db");

const authRoutes = require("./routes/auth");
const productRoutes = require("./routes/products");
const cartRoutes = require("./routes/cart");
const orderRoutes = require("./routes/orders");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);

const PORT = process.env.PORT || 8080;

// Retry schema init a few times in case Postgres isn't ready yet
// (relevant on first container boot, especially in Kubernetes where the
// backend pod can start before the database pod finishes initializing).
async function start() {
  let attempts = 0;
  while (attempts < 10) {
    try {
      await initSchema();
      break;
    } catch (err) {
      attempts++;
      console.log(`DB not ready yet (attempt ${attempts}/10), retrying in 3s...`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  app.listen(PORT, () => console.log(`ShopStack API listening on port ${PORT}`));
}

start();
