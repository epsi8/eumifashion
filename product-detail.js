import { escapeHtml, imageUrl, money } from "./supabase-client.js";

const starterDescriptions = {
  "sunday-tote": "A roomy everyday tote for market mornings, errands, and all the little things you like to keep close.",
  "ceramic-mug": "A simple ceramic mug for slow coffee, warm tea, and a quieter start to the day.",
  "soft-days-candle": "Bring a softer glow to your evening with a candle made for unhurried moments at home.",
  "weekend-knit": "An easy, comfortable knit layer for weekend plans and cooler everyday moments.",
  "little-bloom-vase": "A lovely home for fresh stems or a single garden bloom, made to brighten a small corner.",
  "slow-morning-journal": "A little space for your lists, thoughts, plans, and the ideas that arrive with a slow morning.",
  "sunday-market-bag": "A versatile carryall for market finds, daily essentials, and easy days out.",
  "daily-trinket-tray": "Keep your everyday jewelry and little keepsakes together in a thoughtful catch-all tray."
};

export function withProductDescription(product) {
  return {
    ...product,
    description: product.description || starterDescriptions[product.id]
      || `A thoughtfully chosen ${product.category.toLowerCase()} piece for your everyday.`
  };
}

export function renderProductCard(product, { saved = false, showActions = true } = {}) {
  return `
    <article class="product-card">
      <div class="product-image">
        <button class="product-image-open" type="button" data-product-detail="${escapeHtml(product.id)}" aria-label="View ${escapeHtml(product.name)}">
          <img src="${escapeHtml(imageUrl(product.image_url))}" alt="${escapeHtml(product.name)}" loading="lazy">
        </button>
        ${product.tag ? `<span class="product-tag">${escapeHtml(product.tag)}</span>` : ""}
        <button class="wishlist-toggle${saved ? " saved" : ""}" type="button" data-wishlist="${escapeHtml(product.id)}" aria-pressed="${saved}" aria-label="${saved ? "Remove" : "Add"} ${escapeHtml(product.name)} ${saved ? "from" : "to"} wishlist">${saved ? "♥" : "♡"}</button>
        ${showActions ? `<button class="buy-now" type="button" data-buy="${escapeHtml(product.id)}">BUY NOW</button>
        <button class="quick-add" type="button" data-add="${escapeHtml(product.id)}" aria-label="Add ${escapeHtml(product.name)} to bag">ADD TO BAG&nbsp; +</button>` : ""}
      </div>
      <div class="product-details">
        <div>
          <button class="product-name product-name-open" type="button" data-product-detail="${escapeHtml(product.id)}">${escapeHtml(product.name)}</button>
          <div class="product-category">${escapeHtml(product.category)}</div>
        </div>
        <span class="product-price">${money(product.price)}</span>
      </div>
    </article>`;
}

export function showProductDetail(dialog, product, products, renderCard, saved) {
  const similar = products.filter(item => item.id !== product.id && item.category === product.category);
  const recommendations = (similar.length ? similar : products.filter(item => item.id !== product.id)).slice(0, 4);
  dialog.innerHTML = `
    <div class="product-detail-heading">
      <span class="eyebrow">Product details</span>
      <button class="product-detail-close" type="button" aria-label="Close product details">×</button>
    </div>
    <div class="product-detail-main">
      <div class="product-detail-image-wrap">
        <img class="product-detail-image" src="${escapeHtml(imageUrl(product.image_url, 1200))}" alt="${escapeHtml(product.name)}">
      </div>
      <div class="product-detail-copy">
        ${product.tag ? `<span class="product-tag-label">${escapeHtml(product.tag)}</span>` : ""}
        <span class="eyebrow">${escapeHtml(product.category)}</span>
        <h2>${escapeHtml(product.name)}</h2>
        <p class="product-detail-price">${money(product.price)}</p>
        <p class="product-detail-description">${escapeHtml(withProductDescription(product).description)}</p>
        <div class="product-detail-actions">
          <button class="button" type="button" data-detail-buy="${escapeHtml(product.id)}">BUY NOW</button>
          <button class="button secondary" type="button" data-detail-add="${escapeHtml(product.id)}">ADD TO BAG</button>
          <button class="wishlist-toggle${saved ? " saved" : ""}" type="button" data-detail-wishlist="${escapeHtml(product.id)}" aria-pressed="${saved}" aria-label="${saved ? "Remove" : "Add"} ${escapeHtml(product.name)} ${saved ? "from" : "to"} wishlist">${saved ? "♥" : "♡"}</button>
        </div>
      </div>
    </div>
    <section class="product-recommendations" aria-labelledby="product-recommendations-title">
      <span class="eyebrow">Picked to go with it</span>
      <h3 id="product-recommendations-title">You may also like</h3>
      <div class="product-grid">${recommendations.length ? recommendations.map(renderCard).join("") : '<p class="empty-state">More lovely finds coming soon.</p>'}</div>
    </section>`;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  dialog.querySelector(".product-detail-close").addEventListener("click", () => dialog.close());
}
