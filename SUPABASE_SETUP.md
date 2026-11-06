# Eumi store setup

The storefront and admin dashboard use Supabase for product data and orders. Customers can browse and place COD orders without signing in; their bag and wishlist are saved only in their browser. The admin dashboard requires an administrator account. The static pages require a Supabase project before they can load or save store data.

## 1. Create the database

1. Create a Supabase project.
2. Open **SQL Editor**, paste in [`supabase/schema.sql`](./supabase/schema.sql), and run it.
3. This creates the tables, row-level security policies, order RPC, realtime publication entries, and eight starter products.

For an existing project, run the updated schema again to allow guest checkout, update the order RPC, add the product description column used by the product detail pages, and enable saved order images and status tracking. The schema backfills images for existing order items when their products are still present. New orders receive a private tracking token so their status can be refreshed on the customer's My Orders page without exposing order details.
The schema also creates a public `product-images` Storage bucket. Only admins can upload, replace, or delete files; storefront visitors can read images. Product photo uploads accept JPG, PNG, WebP, or GIF files up to 5 MB.

To add just the product description column through **SQL Editor**, run:

```sql
alter table public.products
  add column if not exists description text not null default '';
```

Until the column is added, the store remains usable with built-in descriptions and the admin shows a notice; custom product descriptions cannot be saved.

The order RPC reads product prices and images from the database and creates order and item snapshots in one transaction. It accepts guest COD orders and a direct **Buy Now** order contains only that product. In Admin → Products, choose a photo from your computer; the admin uploads it to Supabase Storage and saves its public URL with the product.

## 2. Configure the public client

Open [`supabase-config.js`](./supabase-config.js) and replace both placeholders with the project's **Project URL** and **publishable key** (or legacy `anon` key) from **Project Settings → API**.

The publishable/anon key is intended for browser use. **Never** put a `service_role` or secret key in this file, in `index.html`, or in any other frontend asset. Database row-level security is what protects private customer and admin data.

## 3. Configure administrator password sign-in

In Supabase **Authentication → Providers**, enable Email/password sign-in. The admin page also offers one-time email-code sign-in for existing accounts; this does not create customer accounts.

## 4. Assign the store administrator

1. Create the administrator account in **Authentication → Users** using the admin's email address and set a password. If the account already exists but has no known password, send a password recovery email and set one.
2. Run this in the SQL Editor, replacing the address with the administrator account:

   ```sql
   update public.profiles
   set role = 'admin'
   where lower(email) = lower('admin@example.com');
   ```

3. Visit `/admin.html` on the deployed site and sign in with that email and password, or choose **Sign in with email code** if password recovery links do not work.

In Supabase **Authentication → URL Configuration**, set the Site URL to the deployed admin page (for example, `https://your-domain.example/admin.html`) and add the deployed admin callback to the redirect allow list (for example, `https://your-domain.example/admin.html*`). Add your local Vite admin URL too when testing locally (for example, `http://localhost:5173/admin.html*`). The wildcard allows the recovery-flow query parameter used to return password-reset links to the admin page. Reset requests made from localhost intentionally use the configured Site URL rather than embedding a localhost link, so emailed links open the deployed page.

For code sign-in, open **Authentication → Email Templates → Magic Link** and ensure the message displays Supabase's `{{ .Token }}` value so the recipient can enter the code in the admin page. The recipient can use the code without opening the link. Keep Supabase's default password-recovery email link (`{{ .ConfirmationURL }}`) in the recovery template, or ensure a customized template sends the recovery token back to the admin page. The admin page supports both Supabase's normal confirmation links and templates that send `token_hash` with `type=recovery`. Reset emails requested before correcting the URL configuration may still contain a localhost callback; request a fresh link after changing these settings. Password and code sign-in both check the database role. Product edits and order status changes are also enforced by row-level security; hiding the dashboard in the browser is not the security boundary.

## 5. Deploy

Deploy the project root on Vercel or Render. The included deployment configuration builds the static site to `dist` with `npm ci` and `npm run build`. Serve over HTTPS. For local testing, run `npm install` once and `npm run dev`, then open the Vite URL it prints; opening the pages directly with `file://` does not support the app modules.

Before announcing the store, verify guest checkout, admin password sign-in, admin status updates, and realtime notifications on the deployed URL.

## Included behavior and limitations

- Products and guest orders are stored in Supabase.
- Cart and wishlist are saved in the visitor's browser and do not sync across devices.
- Customers place COD orders without creating an account; provide an email and phone number at checkout so the store can contact them.
- Guest order history is saved in the same browser after checkout; it does not sync across browsers or devices. New orders include a private token that lets My Orders refresh the status every 30 seconds. Orders already saved in a browser before tracking was added keep showing their saved status.
- Every delivery field is required and validated in both the browser and database; Indian PIN codes must have six digits.
- COD is the only order payment method. New orders start as **Pending confirmation**; admins can change them to **Confirmed**, **Shipped**, **Delivered**, or **Cancelled**. Admins can permanently delete orders; deleted orders and their items cannot be restored.
- The admin dashboard receives live order updates while it is open. Optional browser notifications require permission and a supported HTTPS browser. This setup does not send order-notification emails or background push notifications when the admin dashboard is closed.
- A static host and Supabase project must be configured/deployed before the app can accept real orders. Store launch also needs the owner to confirm shipping charges, delivery coverage, and applicable taxes; the current checkout total is the product subtotal.
- Product deletion removes that product from active carts and wishlists. Order items retain snapshots of their name, image, and price.
