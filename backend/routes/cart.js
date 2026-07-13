const express = require("express");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ci.id, p.name, p.price, ci.quantity
     FROM cart_items ci JOIN products p ON ci.product_id = p.id
     WHERE ci.user_id = $1`,
    [req.userId]
  );
  res.json(rows);
});

router.post("/", async (req, res) => {
  const { productId, quantity } = req.body;
  const { rows } = await pool.query(
    "INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, $3) RETURNING *",
    [req.userId, productId, quantity || 1]
  );
  res.status(201).json(rows[0]);
});

router.delete("/:id", async (req, res) => {
  await pool.query("DELETE FROM cart_items WHERE id = $1 AND user_id = $2", [
    req.params.id,
    req.userId,
  ]);
  res.status(204).send();
});

module.exports = router;
