import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase-config.js";

let client;

export function getSupabase() {
  if (!SUPABASE_URL.startsWith("https://") || SUPABASE_ANON_KEY.startsWith("YOUR_")) {
    throw new Error("Supabase is not configured. Follow SUPABASE_SETUP.md to connect your project.");
  }

  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    });
  }
  return client;
}

export function money(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(Number(amount) || 0);
}

export function imageUrl(image, width = 700) {
  if (/^https:\/\//i.test(image)) return image;
  return `https://images.unsplash.com/${encodeURIComponent(image)}?auto=format&fit=crop&w=${width}&q=80`;
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}
