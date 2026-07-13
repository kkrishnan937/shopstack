const express = require("express");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// Places an order from everything currently in the user's cart, then clears it.
router.post("/", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: cartRows } = await client.query(
      `SELECT ci.id, ci.product_id, ci.quantity, p.price
       FROM cart_items ci JOIN products p ON ci.product_id = p.id
       WHERE ci.user_id = $1`,
      [req.userId]
    );

    if (cartRows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Cart is empty" });
    }

    const total = cartRows.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const { rows: orderRows } = await client.query(
      "INSERT INTO orders (user_id, total_amount, status) VALUES ($1, $2, 'confirmed') RETURNING *",
      [req.userId, total]
    );

    await client.query("DELETE FROM cart_items WHERE user_id = $1", [req.userId]);
    await client.query("COMMIT");

    res.status(201).json(orderRows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Failed to place order" });
  } finally {
    client.release();
  }
});

router.get("/", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC",
    [req.userId]
  );
  res.json(rows);
});

module.exports = router;
