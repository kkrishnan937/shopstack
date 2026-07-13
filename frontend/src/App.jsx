import React, { useEffect, useState } from "react";

export default function App() {
  const [products, setProducts] = useState([]);
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/products")
      .then((r) => r.json())
      .then(setProducts)
      .catch(() => setMessage("Could not reach backend API"));
  }, []);

  async function login(e) {
    e.preventDefault();
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
    } else {
      setMessage("Login failed");
    }
  }

  async function addToCart(productId) {
    if (!token) return setMessage("Log in first to add items to your cart");
    const res = await fetch("/api/cart", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ productId, quantity: 1 }),
    });
    setMessage(res.ok ? "Added to cart" : "Failed to add to cart");
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
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="submit">Log in</button>
          </form>
        ) : (
          <span className="logged-in-pill">✓ Logged in</span>
        )}
      </header>

      {message && <p className="status-message">{message}</p>}

      <main className="product-section">
        <p className="section-label">{products.length} products</p>
        <div className="product-grid">
          {products.map((p) => (
            <div key={p.id} className="product-card">
              <div className="product-thumb">{categoryIcon(p.category)}</div>
              <div className="product-info">
                <p className="product-name">{p.name}</p>
                <p className="product-price">${p.price}</p>
                <button className="add-to-cart-btn" onClick={() => addToCart(p.id)}>
                  Add to cart
                </button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

function categoryIcon(category) {
  const icons = {
    Electronics: "💻",
    Sports: "👟",
    "Home & Living": "☕",
  };
  return icons[category] || "📦";
}
