import { useEffect, useState } from "react";

type Item = {
  code: string;
  name: string;
  location: string;
};

type CartItem = Item & {
  quantity: number;
};

export default function App() {
  const [catalog, setCatalog] = useState<Item[]>([]);
  const [search, setSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);

  // 🔹 Chargement depuis localStorage
  useEffect(() => {
    const data = localStorage.getItem("catalog");
    if (data) {
      setCatalog(JSON.parse(data));
    }
  }, []);

  // 🔹 Recherche simple
  const filtered = catalog.filter(item =>
    item.code.toLowerCase().includes(search.toLowerCase()) ||
    item.name.toLowerCase().includes(search.toLowerCase())
  );

  // 🔹 Ajouter au panier
  const addToCart = (item: Item) => {
    setCart(prev => {
      const existing = prev.find(p => p.code === item.code);

      if (existing) {
        return prev.map(p =>
          p.code === item.code
            ? { ...p, quantity: p.quantity + 1 }
            : p
        );
      }

      return [...prev, { ...item, quantity: 1 }];
    });
  };

  // 🔹 Modifier quantité
  const updateQuantity = (code: string, delta: number) => {
    setCart(prev =>
      prev
        .map(item =>
          item.code === code
            ? { ...item, quantity: item.quantity + delta }
            : item
        )
        .filter(item => item.quantity > 0)
    );
  };

  // 🔹 Supprimer article
  const removeItem = (code: string) => {
    setCart(prev => prev.filter(item => item.code !== code));
  };

  // 🔹 Génération mail
  const generateMail = () => {
    if (cart.length === 0) return;

    const body = cart
      .map(item =>
        `- Article ${item.code} – ${item.name} – Quantité : ${item.quantity} – Emplacement : ${item.location}`
      )
      .join("%0D%0A");

    const subject = "Demande sortie magasin";

    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  // 🔹 Vider panier
  const clearCart = () => setCart([]);

  return (
    <div style={{ padding: 20, fontFamily: "Arial" }}>
      <h2>Catalogue magasin</h2>

      {/* 🔍 Recherche */}
      <input
        type="text"
        placeholder="Rechercher article..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ padding: 8, width: "100%", marginBottom: 10 }}
      />

      {/* 📋 Résultats */}
      <div>
        {filtered.slice(0, 20).map(item => (
          <div
            key={item.code}
            style={{
              border: "1px solid #ccc",
              padding: 10,
              marginBottom: 5
            }}
          >
            <strong>{item.code}</strong> - {item.name}
            <br />
            📍 {item.location}

            <br />

            <button onClick={() => addToCart(item)}>
              Ajouter au panier
            </button>
          </div>
        ))}
      </div>

      {/* 🛒 Panier */}
      <div
        style={{
          position: "fixed",
          bottom: 10,
          right: 10,
          background: "#fff",
          border: "2px solid #000",
          padding: 10,
          width: 300,
          maxHeight: 400,
          overflow: "auto"
        }}
      >
        <h3>🛒 Panier ({cart.length})</h3>

        {cart.length === 0 && <p>Panier vide</p>}

        {cart.map(item => (
          <div
            key={item.code}
            style={{ borderBottom: "1px solid #ccc", marginBottom: 5 }}
          >
            <strong>{item.code}</strong>
            <br />
            {item.name}
            <br />
            📍 {item.location}
            <br />

            <button onClick={() => updateQuantity(item.code, -1)}>
              -
            </button>

            {item.quantity}

            <button onClick={() => updateQuantity(item.code, 1)}>
              +
            </button>

            <button onClick={() => removeItem(item.code)}>
              ❌
            </button>
          </div>
        ))}

        {cart.length > 0 && (
          <>
            <button onClick={generateMail} style={{ marginTop: 10 }}>
              📧 Envoyer
            </button>

            <button onClick={clearCart} style={{ marginLeft: 10 }}>
              🗑️ Vider
            </button>
          </>
        )}
      </div>
    </div>
  );
