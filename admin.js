import { escapeHtml, getSupabase, imageUrl, money } from "./supabase-client.js";
import { withProductDescription } from "./product-detail.js";

const elements = {
  loginPanel: document.getElementById("login-panel"),
  passwordResetPanel: document.getElementById("password-reset-panel"),
  dashboard: document.getElementById("dashboard"),
  emailForm: document.getElementById("admin-email-form"),
  codeForm: document.getElementById("admin-code-form"),
  passwordResetForm: document.getElementById("password-reset-form"),
  signInButton: document.getElementById("admin-sign-in"),
  forgotPasswordButton: document.getElementById("forgot-password"),
  sendEmailCodeButton: document.getElementById("send-email-code"),
  verifyEmailCodeButton: document.getElementById("verify-email-code"),
  emailCodeLabel: document.getElementById("email-code-label"),
  loginStatus: document.getElementById("login-status"),
  passwordResetStatus: document.getElementById("password-reset-status"),
  setupError: document.getElementById("setup-error"),
  dashboardStatus: document.getElementById("dashboard-status"),
  productForm: document.getElementById("product-form"),
  productList: document.getElementById("product-list"),
  productStatus: document.getElementById("product-status"),
  orderList: document.getElementById("order-list"),
  toast: document.getElementById("toast")
};

const searchParams = new URLSearchParams(window.location.search);
const hashParams = new URLSearchParams(window.location.hash.slice(1));
const recoveryToken = searchParams.get("token_hash");
let isPasswordRecovery = searchParams.get("flow") === "recovery"
  || searchParams.get("type") === "recovery"
  || hashParams.get("type") === "recovery";
const categories = ["Jewelry", "Women's Wear", "Men's Wear", "Other"];
const statuses = ["pending", "confirmed", "shipped", "delivered", "cancelled"];
let supabase;
let products = [];
let orders = [];
let editingId = null;
let orderChannel;
let productChannel;
let ordersPollTimer;
let knownOrderIds = new Set();
let hasLoadedOrders = false;
let productDescriptionSchemaAvailable = true;
let productImagePreviewObjectUrl = null;

function setProductImagePreview(source) {
  const preview = document.getElementById("product-image-preview");
  if (productImagePreviewObjectUrl) {
    URL.revokeObjectURL(productImagePreviewObjectUrl);
    productImagePreviewObjectUrl = null;
  }
  if (!source) {
    preview.removeAttribute("src");
    preview.hidden = true;
    return;
  }
  if (source instanceof File) {
    productImagePreviewObjectUrl = URL.createObjectURL(source);
    preview.src = productImagePreviewObjectUrl;
  } else {
    preview.src = imageUrl(source, 360);
  }
  preview.hidden = false;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => elements.toast.classList.remove("show"), 4500);
}

function showError(context, error) {
  console.error(context, error);
  showToast(`${context}: ${error.message || "Please try again."}`);
}

function renderProducts() {
  document.getElementById("product-count").textContent = `(${products.length})`;
  elements.productList.innerHTML = products.length ? products.map(product => `
    <article class="product-row">
      <img src="${escapeHtml(imageUrl(product.image_url, 180))}" alt="">
      <div>
        <div class="product-name">${escapeHtml(product.name)}</div>
        <div class="product-meta">${escapeHtml(product.category)} · ${money(product.price)} · ${product.is_active ? "Available" : "Hidden"}${product.tag ? `<br>${escapeHtml(product.tag)}` : ""}</div>
      </div>
      <div class="row-actions">
        <button class="button secondary" type="button" data-edit-product="${escapeHtml(product.id)}">Edit</button>
        <button class="button danger" type="button" data-delete-product="${escapeHtml(product.id)}">Delete</button>
      </div>
    </article>`).join("") : '<p class="empty">No products yet. Add one using the form above.</p>';
}

function renderOrders() {
  document.getElementById("order-count").textContent = `(${orders.length})`;
  elements.orderList.innerHTML = orders.length ? orders.map(order => `
    <article class="order-card">
      <div class="order-heading">
        <div>
          <div class="order-number">${escapeHtml(order.order_number)} · ${money(order.total)}</div>
          <div class="order-meta">${escapeHtml(new Date(order.created_at).toLocaleString("en-IN"))} · ${escapeHtml(order.customer_email)} · Cash on delivery</div>
        </div>
        <div class="order-controls">
          <label class="order-status">Order status
            <select data-order-status="${escapeHtml(order.id)}" aria-label="Status for ${escapeHtml(order.order_number)}">
              ${statuses.map(status => `<option value="${status}" ${status === order.status ? "selected" : ""}>${status === "pending" ? "Pending confirmation" : status.charAt(0).toUpperCase() + status.slice(1)}</option>`).join("")}
            </select>
          </label>
          <button class="button danger" type="button" data-delete-order="${escapeHtml(order.id)}">DELETE ORDER</button>
        </div>
      </div>
      <div class="order-details">
        <strong>${escapeHtml(order.full_name)}</strong> · ${escapeHtml(order.phone)}
        <div class="order-address">${escapeHtml(order.address)}, ${escapeHtml(order.city)}, ${escapeHtml(order.state)} ${escapeHtml(order.postal_code)}</div>
        <strong>Items</strong>
        <ul class="order-item-list">${(order.order_items || []).map(item => {
          const product = products.find(product => product.id === item.product_id);
          const itemImage = item.image_url || product?.image_url;
          return `
            <li class="order-item">
              ${itemImage ? `<img src="${escapeHtml(imageUrl(itemImage, 180))}" alt="${escapeHtml(item.product_name)}">` : ""}
              <span>${escapeHtml(item.product_name)} × ${Number(item.quantity)}${item.size ? ` · Size: ${escapeHtml(item.size)}` : ""} — ${money(Number(item.unit_price) * Number(item.quantity))}</span>
            </li>`;
        }).join("")}</ul>
      </div>
    </article>`).join("") : '<p class="empty">No orders yet. New customer orders will appear here.</p>';
}

async function loadProducts() {
  let result = await supabase.from("products")
    .select("id,name,category,price,description,tag,image_url,is_active")
    .order("created_at", { ascending: false });
  if (result.error?.code === "42703") {
    productDescriptionSchemaAvailable = false;
    result = await supabase.from("products")
      .select("id,name,category,price,tag,image_url,is_active")
      .order("created_at", { ascending: false });
    elements.productStatus.textContent = "Run the updated supabase/schema.sql to save product descriptions. Existing product management remains available.";
  } else {
    productDescriptionSchemaAvailable = true;
  }
  if (result.error) throw result.error;
  products = (result.data || []).map(withProductDescription);
  elements.productForm.elements.description.disabled = !productDescriptionSchemaAvailable;
  renderProducts();
  renderOrders();
}

function notifyNewOrders(newOrders) {
  for (const order of newOrders) {
    const message = `New COD order ${order.order_number} · ${money(order.total)}`;
    showToast(message);
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("New Eumi order", { body: message, tag: order.id });
    }
  }
}

async function loadOrders({ notifyNew = false } = {}) {
  const { data, error } = await supabase.from("orders")
    .select("id,order_number,customer_email,full_name,phone,address,city,state,postal_code,payment_method,status,total,created_at,order_items(product_id,product_name,image_url,unit_price,quantity,size)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  orders = data || [];
  if (notifyNew && hasLoadedOrders) {
    notifyNewOrders(orders.filter(order => !knownOrderIds.has(order.id)));
  }
  knownOrderIds = new Set(orders.map(order => order.id));
  hasLoadedOrders = true;
  renderOrders();
}

async function startRealtime() {
  if (orderChannel) await supabase.removeChannel(orderChannel);
  if (productChannel) await supabase.removeChannel(productChannel);
  clearInterval(ordersPollTimer);
  orderChannel = supabase.channel("admin-orders")
    .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
      loadOrders({ notifyNew: true }).catch(error => showError("Could not refresh orders", error));
    })
    .subscribe((state, error) => {
      const stateLabel = document.getElementById("realtime-state");
      if (state === "SUBSCRIBED") stateLabel.textContent = "Live order updates connected";
      else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
        stateLabel.textContent = "Live updates unavailable";
        if (error) console.error("Order notifications could not connect.", error);
      }
    });
  productChannel = supabase.channel("admin-products")
    .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () => {
      loadProducts().catch(error => showError("Could not refresh products", error));
    })
    .subscribe();
  ordersPollTimer = setInterval(() => {
    loadOrders({ notifyNew: true }).catch(error => showError("Could not refresh orders", error));
  }, 30000);
}

function resetProductForm() {
  elements.productForm.reset();
  elements.productForm.elements.id.value = "";
  elements.productForm.elements.image_url.value = "";
  elements.productForm.elements.is_active.checked = true;
  setProductImagePreview("");
  editingId = null;
  document.getElementById("products-heading").textContent = "Products";
  document.getElementById("save-product").textContent = "ADD PRODUCT";
  document.getElementById("cancel-edit").hidden = true;
}

async function startAdminSession(user) {
  const { data: profile, error } = await supabase.from("profiles")
    .select("role").eq("id", user.id).single();
  if (error) throw error;
  if (profile.role !== "admin") {
    await supabase.auth.signOut();
    throw new Error("This email is not assigned the admin role.");
  }
  await Promise.all([loadProducts(), loadOrders()]);
  elements.loginPanel.hidden = true;
  elements.dashboard.hidden = false;
  document.getElementById("admin-email").textContent = user.email;
  document.getElementById("admin-email").hidden = false;
  document.getElementById("admin-sign-out").hidden = false;
  await startRealtime();
}

function setupError(message) {
  elements.setupError.textContent = message;
  elements.setupError.hidden = false;
}

function showPasswordReset() {
  elements.loginPanel.hidden = true;
  elements.dashboard.hidden = true;
  elements.passwordResetPanel.hidden = false;
  elements.passwordResetForm.hidden = false;
  elements.passwordResetStatus.textContent = "";
  document.getElementById("password-reset-title").textContent = "Set a new password";
  elements.passwordResetPanel.querySelector(".intro").textContent = "Choose a new password for your admin account.";
  document.getElementById("admin-email").hidden = true;
  document.getElementById("admin-sign-out").hidden = true;
}

function showExpiredPasswordReset() {
  showPasswordReset();
  elements.passwordResetForm.hidden = true;
  document.getElementById("password-reset-title").textContent = "Password reset link expired";
  elements.passwordResetPanel.querySelector(".intro").textContent = "Request a fresh link from the admin sign-in page.";
  elements.passwordResetStatus.textContent = "This link is invalid or expired. Go back to admin sign in and choose Forgot password.";
}

function clearAuthCallback() {
  window.history.replaceState(null, "", window.location.pathname);
}

function isLocalDevelopmentHost() {
  const hostname = window.location.hostname;
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname) || hostname.endsWith(".localhost");
}

async function init() {
  try {
    supabase = await getSupabase();
    elements.setupError.hidden = true;
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        isPasswordRecovery = true;
        showPasswordReset();
        return;
      }
      if (!session?.user) {
        if (isPasswordRecovery) {
          showExpiredPasswordReset();
          return;
        }
        elements.dashboard.hidden = true;
        elements.passwordResetPanel.hidden = true;
        elements.loginPanel.hidden = false;
        elements.emailForm.reset();
        elements.loginStatus.textContent = "";
        document.getElementById("admin-email").hidden = true;
        document.getElementById("admin-sign-out").hidden = true;
        clearInterval(ordersPollTimer);
        if (orderChannel) supabase.removeChannel(orderChannel);
        if (productChannel) supabase.removeChannel(productChannel);
      }
    });
    if (recoveryToken && searchParams.get("type") === "recovery") {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: recoveryToken,
        type: "recovery"
      });
      if (error) {
        showExpiredPasswordReset();
        clearAuthCallback();
        return;
      }
      isPasswordRecovery = true;
    }
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (isPasswordRecovery && data.session?.user) showPasswordReset();
    else if (isPasswordRecovery) {
      showExpiredPasswordReset();
      clearAuthCallback();
    } else if (data.session?.user) await startAdminSession(data.session.user);
    elements.signInButton.disabled = false;
    elements.forgotPasswordButton.disabled = false;
    document.getElementById("show-email-code").disabled = false;
    elements.sendEmailCodeButton.disabled = false;
    elements.verifyEmailCodeButton.disabled = false;
  } catch (error) {
    console.error("Could not initialize the admin dashboard.", error);
    setupError(`${error.message || "Could not connect to Supabase."} Check the project configuration and database setup.`);
  }
}

document.getElementById("show-email-code").addEventListener("click", () => {
  elements.codeForm.elements.email.value = elements.emailForm.elements.email.value;
  elements.emailForm.hidden = true;
  elements.codeForm.hidden = false;
  elements.loginStatus.textContent = "";
});

document.getElementById("show-password-sign-in").addEventListener("click", () => {
  elements.codeForm.hidden = true;
  elements.emailForm.hidden = false;
  elements.loginStatus.textContent = "";
});

elements.sendEmailCodeButton.addEventListener("click", async () => {
  if (!supabase) {
    elements.loginStatus.textContent = "Still connecting to the store. Please try again.";
    return;
  }
  const emailField = elements.codeForm.elements.email;
  if (!emailField.reportValidity()) return;

  elements.sendEmailCodeButton.disabled = true;
  elements.loginStatus.textContent = "Sending sign-in code…";
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: emailField.value.trim(),
      options: { shouldCreateUser: false }
    });
    if (error) throw error;
    elements.emailCodeLabel.hidden = false;
    elements.codeForm.elements.code.disabled = false;
    elements.verifyEmailCodeButton.hidden = false;
    elements.loginStatus.textContent = "If an account exists for that email, a sign-in code has been sent. Enter the code from the email.";
    elements.codeForm.elements.code.focus();
  } catch (error) {
    elements.loginStatus.textContent = error.message || "Could not send a sign-in code.";
    showError("Could not send admin sign-in code", error);
  } finally {
    elements.sendEmailCodeButton.disabled = false;
  }
});

elements.codeForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!supabase) {
    elements.loginStatus.textContent = "Still connecting to the store. Please try again.";
    return;
  }
  if (!elements.codeForm.reportValidity()) return;

  const email = String(elements.codeForm.elements.email.value).trim();
  const code = String(elements.codeForm.elements.code.value).trim();
  elements.verifyEmailCodeButton.disabled = true;
  elements.loginStatus.textContent = "Verifying code…";
  try {
    const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    if (error) throw error;
    if (!data.user) throw new Error("Could not verify the admin account.");
    await startAdminSession(data.user);
    elements.codeForm.reset();
    elements.loginStatus.textContent = "";
  } catch (error) {
    elements.loginStatus.textContent = error.message || "Could not verify the sign-in code.";
    showError("Admin code sign-in failed", error);
  } finally {
    elements.verifyEmailCodeButton.disabled = false;
  }
});

elements.passwordResetForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!supabase) {
    elements.passwordResetStatus.textContent = "Still connecting to the store. Please try again.";
    return;
  }
  const formData = new FormData(elements.passwordResetForm);
  const password = String(formData.get("password"));
  if (password !== String(formData.get("confirm_password"))) {
    elements.passwordResetStatus.textContent = "The passwords do not match.";
    return;
  }

  elements.passwordResetStatus.textContent = "Updating password…";
  let updatedUser;
  try {
    const { data, error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    if (!data.user) throw new Error("Could not verify the recovered admin account.");
    updatedUser = data.user;
  } catch (error) {
    elements.passwordResetStatus.textContent = error.message || "Could not update the password.";
    showError("Could not update admin password", error);
    return;
  }

  isPasswordRecovery = false;
  const { error: signOutError } = await supabase.auth.signOut();
  if (signOutError) console.error("Could not end the password recovery session.", signOutError);
  elements.passwordResetPanel.hidden = true;
  elements.loginPanel.hidden = false;
  elements.emailForm.elements.email.value = updatedUser.email || "";
  elements.loginStatus.textContent = "Password updated. Sign in with your new password.";
  clearAuthCallback();
  showToast("Admin password updated.");
});

document.getElementById("forgot-password").addEventListener("click", async () => {
  if (!supabase) {
    elements.loginStatus.textContent = "Still connecting to the store. Please try again.";
    return;
  }
  const emailField = elements.emailForm.elements.email;
  if (!emailField.reportValidity()) return;
  elements.forgotPasswordButton.disabled = true;
  elements.loginStatus.textContent = "Sending password reset email…";
  try {
    const redirectUrl = new URL("admin.html", window.location.href);
    redirectUrl.searchParams.set("flow", "recovery");
    const { error } = await supabase.auth.resetPasswordForEmail(emailField.value.trim(), {
      ...(isLocalDevelopmentHost() ? {} : { redirectTo: redirectUrl.href })
    });
    if (error) throw error;
    elements.loginStatus.textContent = isLocalDevelopmentHost()
      ? "If an account exists for that email, a reset link has been sent. From localhost, Supabase uses its configured Site URL; set that to your deployed admin page before requesting a fresh link."
      : "If an account exists for that email, a password reset link has been sent.";
  } catch (error) {
    elements.loginStatus.textContent = error.message || "Could not send a password reset email.";
    showError("Could not send password reset email", error);
  } finally {
    elements.forgotPasswordButton.disabled = false;
  }
});

elements.emailForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!supabase) {
    elements.loginStatus.textContent = "Still connecting to the store. Please try again.";
    return;
  }
  const formData = new FormData(elements.emailForm);
  const email = String(formData.get("email")).trim();
  const password = String(formData.get("password"));
  elements.signInButton.disabled = true;
  elements.loginStatus.textContent = "Signing in…";
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const { data, error: sessionError } = await supabase.auth.getUser();
    if (sessionError) throw sessionError;
    await startAdminSession(data.user);
    elements.emailForm.reset();
    elements.loginStatus.textContent = "";
  } catch (error) {
    elements.loginStatus.textContent = error.message;
    showError("Admin sign-in failed", error);
  } finally {
    elements.signInButton.disabled = false;
  }
});

document.getElementById("admin-sign-out").addEventListener("click", async () => {
  const { error } = await supabase.auth.signOut();
  if (error) showError("Could not sign out", error);
});

document.getElementById("enable-notifications").addEventListener("click", async event => {
  if (!("Notification" in window)) {
    elements.dashboardStatus.textContent = "This browser does not support desktop notifications. Live alerts will still appear in the dashboard.";
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    event.currentTarget.textContent = permission === "granted" ? "BROWSER NOTIFICATIONS ENABLED" : "ENABLE BROWSER NOTIFICATIONS";
    elements.dashboardStatus.textContent = permission === "granted"
      ? "Browser notifications enabled while this dashboard is open."
      : "Browser notifications were not enabled. Keep the dashboard open to see live alerts.";
  } catch (error) {
    elements.dashboardStatus.textContent = "Could not enable browser notifications. Live alerts will still appear in the dashboard.";
    console.error("Could not enable browser notifications.", error);
  }
});

document.getElementById("product-image-file").addEventListener("change", event => {
  const file = event.currentTarget.files[0];
  if (!file) {
    setProductImagePreview(elements.productForm.elements.image_url.value);
    return;
  }
  setProductImagePreview(file);
});

elements.productForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!elements.productForm.reportValidity()) return;
  const data = new FormData(elements.productForm);
  const imageFile = data.get("image_file");
  if (imageFile instanceof File && imageFile.size > 5 * 1024 * 1024) {
    elements.productStatus.textContent = "The product photo must be 5 MB or smaller.";
    return;
  }
  if (imageFile instanceof File && imageFile.size > 0 &&
    !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(imageFile.type)) {
    elements.productStatus.textContent = "Choose a JPG, PNG, WebP, or GIF image.";
    return;
  }
  const product = {
    name: String(data.get("name")).trim(),
    category: String(data.get("category")),
    price: Number(data.get("price")),
    ...(productDescriptionSchemaAvailable ? { description: String(data.get("description")).trim() } : {}),
    tag: String(data.get("tag")).trim(),
    image_url: String(data.get("image_url")).trim(),
    is_active: elements.productForm.elements.is_active.checked
  };
  if (!product.name || !categories.includes(product.category) ||
    (productDescriptionSchemaAvailable && !product.description) ||
    !Number.isFinite(product.price) || product.price <= 0 ||
    (!(imageFile instanceof File) || imageFile.size === 0) && !product.image_url) {
    elements.productStatus.textContent = "Check the product name, category, description, price, and photo.";
    return;
  }

  const id = elements.productForm.elements.id.value;
  const saveButton = document.getElementById("save-product");
  saveButton.disabled = true;
  try {
    if (imageFile instanceof File && imageFile.size > 0) {
      elements.productStatus.textContent = "Uploading product photo…";
      const extension = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif"
      }[imageFile.type];
      const filePath = `${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from("product-images")
        .upload(filePath, imageFile, {
          cacheControl: "3600",
          contentType: imageFile.type,
          upsert: false
        });
      if (uploadError) throw uploadError;
      product.image_url = supabase.storage.from("product-images").getPublicUrl(filePath).data.publicUrl;
    }
    const result = id
      ? await supabase.from("products").update(product).eq("id", id).select().single()
      : await supabase.from("products").insert(product).select().single();
    if (result.error) throw result.error;
    elements.productStatus.textContent = id ? "Product updated." : "Product added.";
    resetProductForm();
    await loadProducts();
  } catch (error) {
    elements.productStatus.textContent = error.message || "Could not save product.";
    showError("Could not save product", error);
  } finally {
    saveButton.disabled = false;
  }
});

document.getElementById("cancel-edit").addEventListener("click", () => {
  resetProductForm();
  elements.productStatus.textContent = "";
});

elements.productList.addEventListener("click", async event => {
  const editButton = event.target.closest("[data-edit-product]");
  const deleteButton = event.target.closest("[data-delete-product]");
  if (editButton) {
    const product = products.find(item => item.id === editButton.dataset.editProduct);
    if (!product) return;
    editingId = product.id;
    elements.productForm.elements.id.value = product.id;
    elements.productForm.elements.name.value = product.name;
    elements.productForm.elements.category.value = product.category;
    elements.productForm.elements.price.value = product.price;
    elements.productForm.elements.description.value = product.description || "";
    elements.productForm.elements.tag.value = product.tag || "";
    elements.productForm.elements.image_url.value = product.image_url;
    elements.productForm.elements.is_active.checked = product.is_active;
    setProductImagePreview(product.image_url);
    document.getElementById("products-heading").textContent = "Edit product";
    document.getElementById("save-product").textContent = "SAVE CHANGES";
    document.getElementById("cancel-edit").hidden = false;
    elements.productForm.scrollIntoView({ behavior: "smooth", block: "center" });
    elements.productForm.elements.name.focus();
    return;
  }
  if (!deleteButton) return;
  const product = products.find(item => item.id === deleteButton.dataset.deleteProduct);
  if (!product || !window.confirm(`Permanently delete "${product.name}"?`)) return;
  try {
    const { error } = await supabase.from("products").delete().eq("id", product.id);
    if (error) throw error;
    if (editingId === product.id) resetProductForm();
    elements.productStatus.textContent = "Product deleted.";
    await loadProducts();
  } catch (error) {
    showError("Could not delete product", error);
  }
});

elements.orderList.addEventListener("change", async event => {
  const select = event.target.closest("[data-order-status]");
  if (!select) return;
  const previous = orders.find(order => order.id === select.dataset.orderStatus)?.status;
  try {
    const { error } = await supabase.from("orders")
      .update({ status: select.value })
      .eq("id", select.dataset.orderStatus);
    if (error) throw error;
    showToast(`Order status updated to ${select.value}.`);
    await loadOrders();
  } catch (error) {
    showError("Could not update order status", error);
    select.value = previous || "pending";
  }
});

elements.orderList.addEventListener("click", async event => {
  const button = event.target.closest("[data-delete-order]");
  if (!button) return;
  const order = orders.find(item => item.id === button.dataset.deleteOrder);
  if (!order || !window.confirm(`Permanently delete order ${order.order_number} and its items? This cannot be undone.`)) return;
  button.disabled = true;
  try {
    const { error } = await supabase.from("orders")
      .delete()
      .eq("id", order.id)
      .select("id")
      .single();
    if (error) throw error;
    showToast(`Order ${order.order_number} deleted.`);
    await loadOrders();
  } catch (error) {
    showError("Could not delete order", error);
    button.disabled = false;
  }
});

init();
