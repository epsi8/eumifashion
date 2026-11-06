import { escapeHtml, getSupabase, imageUrl, money } from "./supabase-client.js";
import { renderProductCard, showProductDetail, withProductDescription } from "./product-detail.js";

const recoveryType = new URLSearchParams(window.location.hash.slice(1)).get("type")
  || new URLSearchParams(window.location.search).get("type");
const isPasswordRecovery = recoveryType === "recovery";
if (isPasswordRecovery) {
  const recoveryUrl = new URL("admin.html", window.location.href);
  recoveryUrl.search = window.location.search;
  recoveryUrl.searchParams.set("type", "recovery");
  recoveryUrl.hash = window.location.hash;
  window.location.replace(recoveryUrl.href);
}

const elements = {
  appStatus: document.getElementById("app-status"),
  productGrid: document.getElementById("product-grid"),
  cartItems: document.getElementById("cart-items"),
  checkoutDialog: document.getElementById("checkout-dialog"),
  productDetailDialog: document.getElementById("product-detail-dialog"),
  checkoutForm: document.getElementById("checkout-form"),
  checkoutSuccess: document.getElementById("checkout-success"),
  toast: document.getElementById("toast")
};

let supabase;
let products = [];
let cart = new Map();
let wishlist = new Set();
let orderHistory = [];
let activeFilter = "All";
let buyNowProduct = null;
let orderRequestId = null;
let productChannel;
let productDescriptionSchemaAvailable = true;
let productDescriptionNotice = "";

function showStatus(message) {
  elements.appStatus.textContent = message;
  elements.appStatus.hidden = !message;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => elements.toast.classList.remove("show"), 4000);
}

function displayError(context, error) {
  console.error(context, error);
  showToast(`${context}: ${error.message || "Please try again."}`);
}

function renderProducts() {
  const query = document.getElementById("product-search").value.trim().toLowerCase();
  const matches = products.filter(product =>
    (activeFilter === "All" || product.category === activeFilter) &&
    `${product.name} ${product.category}`.toLowerCase().includes(query)
  );
  elements.productGrid.innerHTML = matches.length
    ? matches.map(product => renderProductCard(product, { saved: wishlist.has(product.id) })).join("")
    : '<p class="empty-state">Nothing in the edit just yet. Try another search.</p>';
}

function renderWishlist() {
  const savedProducts = products.filter(product => wishlist.has(product.id));
  document.getElementById("wishlist-count").textContent = `(${savedProducts.length})`;
}

function renderCart() {
  const entries = products.filter(product => (cart.get(product.id) || 0) > 0);
  const count = entries.reduce((sum, product) => sum + cart.get(product.id), 0);
  const subtotal = entries.reduce((sum, product) => sum + Number(product.price) * cart.get(product.id), 0);
  document.getElementById("cart-count").textContent = count;
  document.getElementById("cart-title-count").textContent = `(${count})`;
  document.getElementById("cart-subtotal").textContent = money(subtotal);
  elements.cartItems.innerHTML = entries.length ? entries.map(product => `
    <div class="cart-item">
      <img src="${escapeHtml(imageUrl(product.image_url))}" alt="">
      <div>
        <div class="cart-item-name">${escapeHtml(product.name)}</div>
        <div class="cart-item-price">${money(product.price)}</div>
        <div class="quantity-controls">
          <button type="button" data-quantity="-1" data-id="${escapeHtml(product.id)}" aria-label="Remove one ${escapeHtml(product.name)}">−</button>
          <span>${cart.get(product.id)}</span>
          <button type="button" data-quantity="1" data-id="${escapeHtml(product.id)}" aria-label="Add one ${escapeHtml(product.name)}" ${cart.get(product.id) >= 99 ? "disabled" : ""}>+</button>
        </div>
      </div>
      <button class="remove-item" type="button" data-remove="${escapeHtml(product.id)}" aria-label="Remove ${escapeHtml(product.name)}">Remove</button>
    </div>`).join("") : '<p class="cart-empty">Your bag is empty. Add something lovely to get started.</p>';
  document.getElementById("checkout-button").disabled = count === 0;
  document.getElementById("checkout-button").style.opacity = count ? "1" : ".55";
}

function renderStoreState() {
  renderWishlist();
  renderCart();
}

function setCartOpen(open) {
  const panel = document.getElementById("cart-panel");
  const backdrop = document.getElementById("cart-backdrop");
  panel.classList.toggle("open", open);
  backdrop.classList.toggle("open", open);
  panel.setAttribute("aria-hidden", String(!open));
  document.body.style.overflow = open ? "hidden" : "";
  if (open) document.getElementById("close-cart").focus();
}

async function loadProducts() {
  let result = await supabase
    .from("products")
    .select("id,name,category,price,description,tag,image_url")
    .eq("is_active", true)
    .order("created_at", { ascending: false });
  if (result.error?.code === "42703") {
    productDescriptionSchemaAvailable = false;
    productDescriptionNotice = "Product descriptions are using defaults. Run the updated supabase/schema.sql to enable saved descriptions.";
    result = await supabase.from("products")
      .select("id,name,category,price,tag,image_url")
      .eq("is_active", true)
      .order("created_at", { ascending: false });
  }
  if (result.error) throw result.error;
  products = (result.data || []).map(withProductDescription);
  renderProducts();
  renderStoreState();
}

function saveStoreState() {
  localStorage.setItem("eumi-cart", JSON.stringify([...cart]));
  localStorage.setItem("eumi-wishlist", JSON.stringify([...wishlist]));
}

function loadStoreState() {
  const savedCart = JSON.parse(localStorage.getItem("eumi-cart") || "[]");
  const savedWishlist = JSON.parse(localStorage.getItem("eumi-wishlist") || "[]");
  const savedOrderHistory = JSON.parse(localStorage.getItem("eumi-orders") || "[]");
  if (!Array.isArray(savedCart) || !Array.isArray(savedWishlist) || !Array.isArray(savedOrderHistory)) {
    throw new Error("Saved bag, wishlist, or order history data is invalid. Clear this site's saved data and reload.");
  }
  cart = new Map(savedCart.filter(entry =>
    Array.isArray(entry) && typeof entry[0] === "string" &&
    Number.isInteger(entry[1]) && entry[1] >= 1 && entry[1] <= 99
  ));
  wishlist = new Set(savedWishlist.filter(id => typeof id === "string"));
  orderHistory = savedOrderHistory.filter(order =>
    order && typeof order.order_number === "string" &&
    typeof order.status === "string" &&
    typeof order.created_at === "string" && Number.isFinite(Date.parse(order.created_at)) &&
    Number.isFinite(Number(order.total)) &&
    Array.isArray(order.items) && order.items.every(item =>
      item && typeof item.name === "string" &&
      Number.isFinite(Number(item.price)) &&
      Number.isInteger(item.quantity) && item.quantity > 0
    )
  );
}

async function setCartQuantity(productId, quantity) {
  if (quantity <= 0) cart.delete(productId);
  else cart.set(productId, Math.min(quantity, 99));
  saveStoreState();
  renderStoreState();
}

async function addToCart(productId) {
  const quantity = cart.get(productId) || 0;
  if (quantity >= 99) {
    showToast("You can add up to 99 of one product.");
    return;
  }
  await setCartQuantity(productId, quantity + 1);
  showToast("Added to your bag.");
}

async function toggleWishlist(productId) {
  if (wishlist.has(productId)) wishlist.delete(productId);
  else wishlist.add(productId);
  saveStoreState();
  renderProducts();
  renderStoreState();
}

async function openCheckout(product = null) {
  buyNowProduct = product;
  if (!orderRequestId) orderRequestId = crypto.randomUUID();
  if (product) {
    document.getElementById("checkout-summary").innerHTML =
      `${escapeHtml(product.name)} × 1 — ${money(product.price)}<br><strong>Total: ${money(product.price)}</strong>`;
  } else {
    if (!cart.size) {
      showToast("Your bag is empty.");
      return;
    }
    const rows = products.filter(item => cart.has(item.id));
    const total = rows.reduce((sum, item) => sum + Number(item.price) * cart.get(item.id), 0);
    document.getElementById("checkout-summary").innerHTML =
      `${rows.map(item => `${escapeHtml(item.name)} × ${cart.get(item.id)} — ${money(Number(item.price) * cart.get(item.id))}`).join("<br>")}<br><strong>Total: ${money(total)}</strong>`;
  }
  setCartOpen(false);
  elements.checkoutForm.hidden = false;
  elements.checkoutSuccess.hidden = true;
  elements.checkoutDialog.showModal();
}

function openProductDetail(product) {
  showProductDetail(
    elements.productDetailDialog,
    product,
    products,
    item => renderProductCard(item, { saved: wishlist.has(item.id) }),
    wishlist.has(product.id)
  );
}

async function submitOrder(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const orderedItems = buyNowProduct
      ? [{
        name: buyNowProduct.name,
        image_url: buyNowProduct.image_url,
        price: Number(buyNowProduct.price),
        quantity: 1
      }]
      : [...cart].map(([id, quantity]) => {
        const product = products.find(item => item.id === id);
        return product ? {
          name: product.name,
          image_url: product.image_url,
          price: Number(product.price),
          quantity
        } : null;
      }).filter(Boolean);
    const { data: result, error } = await supabase.rpc("create_order", {
      p_full_name: String(data.get("full_name")).trim(),
      p_phone: String(data.get("phone")).trim(),
      p_address: String(data.get("address")).trim(),
      p_city: String(data.get("city")).trim(),
      p_state: String(data.get("state")).trim(),
      p_postal_code: String(data.get("postal_code")).trim(),
      p_customer_email: String(data.get("email")).trim(),
      p_request_id: orderRequestId,
      p_items: buyNowProduct
        ? [{ product_id: buyNowProduct.id, quantity: 1 }]
        : [...cart].map(([product_id, quantity]) => ({ product_id, quantity }))
    });
    if (error) throw error;
    const order = {
      order_number: result.order_number,
      status: result.status,
      total: Number(result.total),
      created_at: new Date().toISOString(),
      tracking_token: orderRequestId,
      items: orderedItems
    };
    let orderHistorySaved = true;
    orderHistory.unshift(order);
    try {
      localStorage.setItem("eumi-orders", JSON.stringify(orderHistory));
    } catch (storageError) {
      orderHistory.shift();
      orderHistorySaved = false;
      console.error("The order was placed but could not be saved to this browser's order history.", storageError);
    }
    if (!buyNowProduct) {
      cart.clear();
      saveStoreState();
      renderStoreState();
    }
    buyNowProduct = null;
    form.hidden = true;
    document.querySelector(".checkout-note").hidden = true;
    elements.checkoutSuccess.hidden = false;
    const statusLabels = {
      pending: "Pending confirmation",
      confirmed: "Confirmed",
      shipped: "Shipped",
      delivered: "Delivered",
      cancelled: "Cancelled"
    };
    elements.checkoutSuccess.innerHTML = `
      <h3>Order confirmed!</h3>
      <p>Your order <strong>${escapeHtml(result.order_number)}</strong> has been placed with Cash on Delivery.</p>
      <p>Current status: <strong>${escapeHtml(statusLabels[result.status] || result.status)}</strong></p>
      <p>Total: <strong>${money(result.total)}</strong></p>
      <p>We’ll use your email and phone to contact you about delivery.</p>
      <p>${orderHistorySaved ? "This order is saved in My orders on this browser." : "Your order was placed, but this browser could not save it to My orders."}</p>`;
    orderRequestId = null;
  } finally {
    if (!form.hidden) submitButton.disabled = false;
  }
}

async function init() {
  try {
    supabase = await getSupabase();
    loadStoreState();
    await loadProducts();
    productChannel = supabase.channel("store-products")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () => {
        loadProducts().catch(error => displayError("Could not refresh products", error));
      })
      .subscribe();
    showStatus(productDescriptionNotice);
    const buyNowId = new URLSearchParams(window.location.search).get("buyNow");
    const buyNowProduct = products.find(product => product.id === buyNowId);
    if (buyNowProduct) {
      window.history.replaceState(null, "", window.location.pathname);
      await openCheckout(buyNowProduct);
    }
  } catch (error) {
    console.error("Could not initialize the Eumi storefront.", error);
    showStatus(`${error.message || "Could not connect to the store."} Check the Supabase configuration and database setup.`);
  }
}

document.querySelectorAll(".filter-button").forEach(button => button.addEventListener("click", () => {
  activeFilter = button.dataset.filter;
  document.querySelectorAll(".filter-button").forEach(item => item.classList.toggle("active", item === button));
  renderProducts();
}));

document.getElementById("product-search").addEventListener("input", renderProducts);
document.getElementById("search-focus").addEventListener("click", () => {
  document.getElementById("shop").scrollIntoView({ behavior: "smooth" });
  setTimeout(() => document.getElementById("product-search").focus(), 350);
});

function handleProductGridClick(event) {
  const addButton = event.target.closest("[data-add]");
  const buyButton = event.target.closest("[data-buy]");
  const wishlistButton = event.target.closest("[data-wishlist]");
  const detailAddButton = event.target.closest("[data-detail-add]");
  const detailBuyButton = event.target.closest("[data-detail-buy]");
  const detailWishlistButton = event.target.closest("[data-detail-wishlist]");
  const detailButton = event.target.closest("[data-product-detail]");
  if (addButton) addToCart(addButton.dataset.add).catch(error => displayError("Could not update your bag", error));
  else if (buyButton) {
    const product = products.find(item => item.id === buyButton.dataset.buy);
    if (product) openCheckout(product).catch(error => displayError("Could not start checkout", error));
  } else if (wishlistButton) toggleWishlist(wishlistButton.dataset.wishlist)
    .catch(error => displayError("Could not update your wishlist", error));
  else if (detailAddButton) addToCart(detailAddButton.dataset.detailAdd)
    .catch(error => displayError("Could not update your bag", error));
  else if (detailBuyButton) {
    const product = products.find(item => item.id === detailBuyButton.dataset.detailBuy);
    if (product) {
      elements.productDetailDialog.close();
      openCheckout(product).catch(error => displayError("Could not start checkout", error));
    }
  } else if (detailWishlistButton) {
    const product = products.find(item => item.id === detailWishlistButton.dataset.detailWishlist);
    if (product) toggleWishlist(product.id)
      .then(() => openProductDetail(product))
      .catch(error => displayError("Could not update your wishlist", error));
  } else if (detailButton) {
    const product = products.find(item => item.id === detailButton.dataset.productDetail);
    if (product) openProductDetail(product);
  }
}

elements.productGrid.addEventListener("click", handleProductGridClick);
elements.productDetailDialog.addEventListener("click", handleProductGridClick);
elements.productDetailDialog.addEventListener("click", event => {
  if (event.target === elements.productDetailDialog) elements.productDetailDialog.close();
});

elements.cartItems.addEventListener("click", event => {
  const quantityButton = event.target.closest("[data-quantity]");
  const removeButton = event.target.closest("[data-remove]");
  if (quantityButton) {
    const id = quantityButton.dataset.id;
    setCartQuantity(id, (cart.get(id) || 0) + Number(quantityButton.dataset.quantity))
      .catch(error => displayError("Could not update your bag", error));
  } else if (removeButton) {
    setCartQuantity(removeButton.dataset.remove, 0)
      .catch(error => displayError("Could not remove this product", error));
  }
});

document.getElementById("open-cart").addEventListener("click", () => setCartOpen(true));
document.getElementById("close-cart").addEventListener("click", () => setCartOpen(false));
document.getElementById("cart-backdrop").addEventListener("click", () => setCartOpen(false));
document.getElementById("checkout-button").addEventListener("click", () =>
  openCheckout().catch(error => displayError("Could not start checkout", error)));
document.getElementById("close-checkout").addEventListener("click", () => elements.checkoutDialog.close());
elements.checkoutDialog.addEventListener("close", () => {
  elements.checkoutForm.reset();
  elements.checkoutForm.querySelector('button[type="submit"]').disabled = false;
  elements.checkoutForm.hidden = false;
  elements.checkoutSuccess.hidden = true;
  document.querySelector(".checkout-note").hidden = false;
  buyNowProduct = null;
  orderRequestId = null;
});
elements.checkoutForm.addEventListener("submit", event =>
  submitOrder(event).catch(error => displayError("Could not place your order", error)));

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && elements.checkoutDialog.open) elements.checkoutDialog.close();
});

document.getElementById("year").textContent = new Date().getFullYear();
renderProducts();
renderWishlist();
renderCart();
if (!isPasswordRecovery) init();
