import { escapeHtml, getSupabase, imageUrl, money } from "./supabase-client.js";
import { renderProductCard, showProductDetail, withProductDescription } from "./product-detail.js";

const page = document.body.dataset.page;
const status = document.getElementById("account-status");

function readStoredArray(key) {
  const value = JSON.parse(localStorage.getItem(key) || "[]");
  if (!Array.isArray(value)) throw new Error(`Saved ${key.replace("eumi-", "")} data is invalid.`);
  return value;
}

function getSavedOrders() {
  return readStoredArray("eumi-orders").filter(order =>
    order && typeof order.order_number === "string" &&
    typeof order.status === "string" &&
    typeof order.created_at === "string" && Number.isFinite(Date.parse(order.created_at)) &&
    Number.isFinite(Number(order.total)) &&
    Array.isArray(order.items) && order.items.every(item =>
      item && typeof item.name === "string" &&
      Number.isFinite(Number(item.price)) &&
      Number.isInteger(item.quantity) && item.quantity > 0 &&
      (item.image_url === undefined || typeof item.image_url === "string")
    )
  );
}

function renderOrders() {
  const savedOrders = getSavedOrders();
  const list = document.getElementById("order-history-list");
  list.innerHTML = savedOrders.length
    ? savedOrders.map(order => `
      <article class="customer-order">
        <div class="customer-order-heading">
          <strong>${escapeHtml(order.order_number)}</strong>
          <strong>${money(order.total)}</strong>
        </div>
        <div class="customer-order-meta">${escapeHtml(new Date(order.created_at).toLocaleString("en-IN"))} · ${escapeHtml(order.status === "pending" ? "Pending confirmation" : order.status.charAt(0).toUpperCase() + order.status.slice(1))}</div>
        <ul class="customer-order-items">${order.items.map(item => `
          <li class="customer-order-item">
            ${item.image_url ? `<img src="${escapeHtml(imageUrl(item.image_url, 180))}" alt="${escapeHtml(item.name)}">` : ""}
            <span><strong>${escapeHtml(item.name)}</strong><br>Quantity: ${item.quantity} · ${money(Number(item.price) * item.quantity)}</span>
          </li>`).join("")}</ul>
      </article>`).join("")
    : '<p class="empty-state">Your order history is empty.</p>';
}

async function refreshOrderStatuses(supabase) {
  const statusLabels = new Set(["pending", "confirmed", "shipped", "delivered", "cancelled"]);
  const savedOrders = getSavedOrders();
  const trackedOrders = savedOrders.filter(order =>
    typeof order.tracking_token === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(order.tracking_token)
  );
  const updates = await Promise.all(trackedOrders.map(async order => {
    const { data, error } = await supabase.rpc("get_order_status", {
      p_order_number: order.order_number,
      p_tracking_token: order.tracking_token
    });
    if (error) throw error;
    return { order, status: data };
  }));
  let changed = false;
  const removedOrderNumbers = new Set();
  for (const { order, status: currentStatus } of updates) {
    if (currentStatus === null) {
      removedOrderNumbers.add(order.order_number);
      changed = true;
      continue;
    }
    if (statusLabels.has(currentStatus) && order.status !== currentStatus) {
      order.status = currentStatus;
      changed = true;
    }
  }
  if (changed) {
    const remainingOrders = savedOrders.filter(order => !removedOrderNumbers.has(order.order_number));
    localStorage.setItem("eumi-orders", JSON.stringify(remainingOrders));
    renderOrders();
  }
  status.textContent = "";
}

function renderWishlist(products, savedIds) {
  const savedProducts = savedIds.map(id => products.find(product => product.id === id)).filter(Boolean);
  document.getElementById("wishlist-count").textContent = `(${savedProducts.length})`;
  const grid = document.getElementById("wishlist-grid");
  grid.innerHTML = savedProducts.length
    ? savedProducts.map(product => renderProductCard(product, { saved: true, showActions: false })).join("")
    : '<p class="empty-state">Save a favorite with the heart on any product.</p>';
}

async function init() {
  try {
    if (page === "orders") {
      renderOrders();
      const supabase = await getSupabase();
      const updateStatuses = () => refreshOrderStatuses(supabase).catch(error => {
        console.error("Could not refresh order statuses.", error);
        status.textContent = "Could not refresh order statuses. Showing the last saved status.";
      });
      updateStatuses();
      const refreshTimer = setInterval(updateStatuses, 30000);
      window.addEventListener("pagehide", () => clearInterval(refreshTimer), { once: true });
      return;
    }

    if (page !== "wishlist") throw new Error("This account page is not recognized.");
    const supabase = await getSupabase();
    let result = await supabase.from("products")
      .select("id,name,category,price,description,tag,image_url")
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    if (result.error?.code === "42703") {
      result = await supabase.from("products")
        .select("id,name,category,price,tag,image_url")
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      status.textContent = "Product descriptions are using defaults until the updated database schema is applied.";
    }
    if (result.error) throw result.error;
    const products = (result.data || []).map(withProductDescription);
    const productDetailsDialog = document.getElementById("product-detail-dialog");
    const savedIds = readStoredArray("eumi-wishlist").filter(id => typeof id === "string");
    renderWishlist(products, savedIds);
    const openProduct = product => showProductDetail(
      productDetailsDialog,
      product,
      products,
      item => renderProductCard(item, { saved: readStoredArray("eumi-wishlist").includes(item.id) }),
      readStoredArray("eumi-wishlist").includes(product.id)
    );
    const addToBag = productId => {
      const cart = readStoredArray("eumi-cart");
      const quantities = new Map(cart.filter(entry =>
        Array.isArray(entry) && typeof entry[0] === "string" &&
        Number.isInteger(entry[1]) && entry[1] > 0 && entry[1] <= 99
      ));
      const quantity = quantities.get(productId) || 0;
      if (quantity >= 99) {
        status.textContent = "You can add up to 99 of one product.";
        return;
      }
      quantities.set(productId, quantity + 1);
      try {
        localStorage.setItem("eumi-cart", JSON.stringify([...quantities]));
        status.textContent = "Added to your bag.";
      } catch (error) {
        console.error("Could not save this item to the bag.", error);
        status.textContent = "Could not save this item to your bag. Please check browser storage and try again.";
      }
    };
    const buyNow = productId => {
      window.location.href = `index.html?buyNow=${encodeURIComponent(productId)}`;
    };
    const handleProductClick = event => {
      const detailButton = event.target.closest("[data-product-detail]");
      const addButton = event.target.closest("[data-add], [data-detail-add]");
      const buyButton = event.target.closest("[data-buy], [data-detail-buy]");
      const wishlistButton = event.target.closest("[data-wishlist], [data-detail-wishlist]");
      if (addButton) {
        addToBag(addButton.dataset.add || addButton.dataset.detailAdd);
      } else if (buyButton) {
        buyNow(buyButton.dataset.buy || buyButton.dataset.detailBuy);
      } else if (wishlistButton) {
        const product = products.find(item => item.id === (wishlistButton.dataset.wishlist || wishlistButton.dataset.detailWishlist));
        if (!product) return;
        const ids = readStoredArray("eumi-wishlist").filter(id => typeof id === "string");
        const nextIds = ids.includes(product.id) ? ids.filter(id => id !== product.id) : [...ids, product.id];
        localStorage.setItem("eumi-wishlist", JSON.stringify(nextIds));
        renderWishlist(products, nextIds);
        status.textContent = nextIds.includes(product.id) ? "Added to your wishlist." : "Removed from your wishlist.";
        if (wishlistButton.hasAttribute("data-detail-wishlist")) openProduct(product);
      } else if (detailButton) {
        const product = products.find(item => item.id === detailButton.dataset.productDetail);
        if (product) openProduct(product);
      }
    };
    document.getElementById("wishlist-grid").addEventListener("click", handleProductClick);
    productDetailsDialog.addEventListener("click", handleProductClick);
    productDetailsDialog.addEventListener("click", event => {
      if (event.target === productDetailsDialog) productDetailsDialog.close();
    });
  } catch (error) {
    console.error("Could not load this account page.", error);
    status.textContent = `${error.message || "Could not load this page."} Please refresh and try again.`;
  }
}

init();
