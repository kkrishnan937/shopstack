const { transaction } = require("../db");

async function readCart(userId) {
  return transaction(async db => {
    // Historical line change-times are unknown. Start legacy retention on first
    // read after migration instead of guessing when the items were added.
    await db.query("INSERT INTO cart_state (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
    const { rows: [meta] } = await db.query(
      `SELECT *, last_changed_at <= CURRENT_TIMESTAMP - INTERVAL '720 hours' AS elapsed
       FROM cart_state WHERE user_id = $1 FOR UPDATE`, [userId]
    );
    if (meta.elapsed && !meta.expired) {
      await db.query("DELETE FROM cart_items WHERE user_id = $1", [userId]);
      await db.query("UPDATE cart_state SET expired = TRUE, version = version + 1 WHERE user_id = $1", [userId]);
      meta.expired = true;
      meta.version += 1;
    }
    const { rows } = await db.query(
      `SELECT ci.id, ci.product_id, p.name, ci.quantity,
              (p.price * 100)::BIGINT AS unit_cents,
              ((p.price * 100)::BIGINT * ci.quantity)::BIGINT AS line_cents
       FROM cart_items ci JOIN products p ON ci.product_id = p.id
       WHERE ci.user_id = $1 ORDER BY ci.id`, [userId]
    );
    const items = rows.map(row => ({
      id: row.id, productId: row.product_id, name: row.name,
      quantity: row.quantity, unitPriceCents: Number(row.unit_cents), lineTotalCents: Number(row.line_cents),
    }));
    if (items.some(i => !Number.isSafeInteger(i.unitPriceCents) || !Number.isSafeInteger(i.lineTotalCents) || i.unitPriceCents < 0 || i.quantity < 1)) throw new Error("Invalid cart data");
    const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
    if (!Number.isSafeInteger(subtotalCents)) throw new Error("Invalid subtotal");
    return {
      id: `cart-${userId}`, version: meta.version, currency: "CAD",
      state: meta.expired ? "expired" : items.length ? "active" : "empty",
      expiryReason: meta.expired ? "retention_elapsed" : null, items, subtotalCents,
    };
  });
}
module.exports = { readCart };
