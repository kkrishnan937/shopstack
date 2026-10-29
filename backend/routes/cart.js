const express = require("express");
const { readCart } = require("../services/cart-read");
const { requireAuth } = require("../middleware/auth");

module.exports = function cartRoutes({ beforeRead } = {}) {
const router = express.Router();
router.use((req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    if (beforeRead) await beforeRead(req);
    res.json(await readCart(req.userId));
  } catch {
    res.status(503).json({ error: "Could not load cart" });
  }
});

// Read-only increment: the mutation release gates have not been closed.
router.use((req, res) => res.status(501).json({ error: "Cart changes are not enabled in this increment" }));
return router;
};
