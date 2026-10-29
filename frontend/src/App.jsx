import React, { useEffect, useState } from "react";

export default function App() {
  const [products, setProducts] = useState([]);
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(window.location.hash === "#/cart" ? "cart" : "products");
  const [cart, setCart] = useState(null);
  const [cartStatus, setCartStatus] = useState("idle");
  const [attempt, setAttempt] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const navigate = () => { setPage(window.location.hash === "#/cart" ? "cart" : "products"); setDismissed(false); };
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);

  useEffect(() => {
    if (page !== "cart" || !token) return;
    const controller = new AbortController();
    setCart(null);
    setCartStatus("loading");
    fetch("/api/cart", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal })
      .then(async res => {
        if (res.status === 401) {
          localStorage.removeItem("token");
          setToken(""); setMessage("Your session expired. Please sign in again to view your cart.");
          setCartStatus("auth"); return;
        }
        if (!res.ok) throw new Error("Cart unavailable");
        const data = await res.json();
        if (data.currency !== "CAD" || !Array.isArray(data.items) || !Number.isSafeInteger(data.subtotalCents) ||
            !["active", "empty", "expired"].includes(data.state) || data.items.some(item =>
              !Number.isSafeInteger(item.unitPriceCents) || !Number.isSafeInteger(item.lineTotalCents))) throw new Error("Invalid response");
        if (!controller.signal.aborted) { setCart(data); setCartStatus("ready"); }
      })
      .catch(error => { if (error.name !== "AbortError" && !controller.signal.aborted) setCartStatus("error"); });
    return () => controller.abort();
  }, [page, token, attempt]);

  useEffect(() => {
    fetch("/api/products")
      .then((r) => r.json())
      .then(setProducts)
      .catch(() => setMessage("Could not reach backend API"));
  }, []);

  async function login(e) {
    e.preventDefault();
    try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) {
      const data = await res.json();
      setToken(data.token);
      localStorage.setItem("token", data.token);
      setMessage(`Logged in as ${data.user.name}`);
      setPassword("");
    } else {
      setMessage("Login failed");
    }
    } catch { setMessage("Could not sign in. Please try again."); }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon">🛍️</span>
          <span className="brand-name">ShopStack</span>
        </div>

        {!token ? (
          <form onSubmit={login} className="login-form">
            <input
              aria-label="Email"
              type="email"
              autoComplete="username"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              aria-label="Password"
              autoComplete="current-password"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="submit">Log in</button>
          </form>
        ) : (
          <div className="header-actions"><span className="logged-in-pill">✓ Logged in</span><a className="cart-link" href="#/cart">View cart</a></div>
        )}
      </header>

      {message && <p className="status-message" role="status">{message}</p>}

      {page === "cart" ? (
        <main className="cart-page" aria-labelledby="cart-heading">
          <h1 id="cart-heading">Your cart</h1>
          {!token && <p>Please sign in to view your saved cart.</p>}
          {token && cartStatus === "loading" && <p role="status">Loading your cart…</p>}
          {token && cartStatus === "error" && <div role="alert"><p>Couldn't load your cart. Please try again.</p><button className="cart-button" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>}
          {token && cartStatus === "ready" && cart && <>
            {cart.state === "expired" && !dismissed && <div className="cart-notice"><p role="status">Your saved cart expired after 30 days without changes.</p><button className="cart-button" onClick={() => setDismissed(true)}>Dismiss expiry notice</button></div>}
            {cart.items.length === 0 ? <p role="status">Cart is empty</p> : (
              <ul className="cart-lines">{cart.items.map(item => <li className="cart-line" key={item.id}>
                <h2>{item.name}</h2><dl>
                  <div><dt>Quantity</dt><dd>{item.quantity}</dd></div>
                  <div><dt>Unit price</dt><dd>{formatCents(item.unitPriceCents)}</dd></div>
                  <div><dt>Line total</dt><dd>{formatCents(item.lineTotalCents)}</dd></div>
                </dl>
              </li>)}</ul>
            )}
            <p className="cart-subtotal"><span>Subtotal</span><strong>{formatCents(cart.subtotalCents)}</strong></p>
          </>}
          <a className="cart-link continue-shopping" href="#/products">Continue shopping</a>
          <p className="cart-demo">Cart subtotal only. Tax and shipping are calculated at demo checkout. No payment is taken.</p>
          <p className="cart-demo">This increment supports cart viewing only. Changes and demo checkout are not enabled.</p>
        </main>
      ) : (
      <main className="product-section">
        <p className="section-label">{products.length} products</p>
        <div className="product-grid">
          {products.map((p) => (
            <div key={p.id} className="product-card">
              <div className="product-thumb">{categoryIcon(p.category)}</div>
              <div className="product-info">
                <p className="product-name">{p.name}</p>
                <p className="product-price">${p.price}</p>
                <button className="add-to-cart-btn" disabled>
                  Cart changes coming later
                </button>
              </div>
            </div>
          ))}
        </div>
      </main>
      )}
    </div>
  );
}

function formatCents(cents) {
  return `CAD ${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function categoryIcon(category) {
  const icons = {
    Electronics: "💻",
    Sports: "👟",
    "Home & Living": "☕",
  };
  return icons[category] || "📦";
}
