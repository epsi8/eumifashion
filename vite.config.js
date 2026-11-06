import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: {
        storefront: "index.html",
        admin: "admin.html",
        wishlist: "wishlist.html",
        orders: "my-orders.html"
      }
    }
  }
});
