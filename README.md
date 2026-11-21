# CULTIVA Coffee & Company

A TypeScript / Next.js application for a café with pickup orders, walk-in POS, a one-cart-per-day event rental calendar, reusable equipment assignments, payments, analytics, and role-based Customer / Staff / Admin access. Staff and Admin require a password plus a TOTP code compatible with Google Authenticator. Customers sign in using a password. This is a first working version with placeholder branding, products, packages, images, and business copy to replace with client-approved details.

The Admin overview has 7-, 30-, and 90-day analytics based on actual completed café orders: sales trends, average order value, change from the previous equivalent period, top five coffee and meals by units, category sales, walk-in versus pickup performance, and orders by two-hour window in Philippine time. It also reports rental revenue and bookings by event date, and exports the selected period to CSV. New orders save the item category at sale time; older orders use the current catalog category for grouping. No demonstration sales are inserted. Café payment history stores each amount, method, reference, timestamp, and recording team member, including signed refund entries. Older orders retain their paid total but cannot recover references that were never stored. Gross sales stay based on completed order totals; collections reflect payments net of refunds.

## Setup locally

Use Node 22+ and PostgreSQL. Copy `.env.example` to `.env`, set `DATABASE_URL` to your PostgreSQL connection string, generate a fresh 32-byte hex `AUTH_ENCRYPTION_KEY`, and set `APP_URL` to the site origin. Do not commit `.env`.

```sh
npm ci
npx prisma migrate deploy
npm run db:seed
npm run admin:create
npm run build
npm start
```

`npm run admin:create` requires `ADMIN_EMAIL`, `ADMIN_PASSWORD` (12 characters or longer), and optionally `ADMIN_NAME` in the process environment. Alternatively, set a 64-character random hex `ADMIN_SETUP_TOKEN` and use the separate **Staff & Admin** sign-in page at `/operations/login` to set up the first Admin. The setup code works only while no Admin account exists. The owner chooses their email and password in the form, then enrolls Google Authenticator before the Admin workspace at `/operations` opens. Admin can create Staff accounts from **User access**. Staff and Admin recovery codes are shown once after setup. Store them safely. An Admin can reset an active Staff member’s password in User access after entering their own password, and may reset the Staff Authenticator when both device and recovery codes are unavailable. The temporary password is shown once, all Staff sessions are revoked, and the Staff member must enroll a new Authenticator if reset. Share the temporary password through a trusted channel and have the Staff member change it in Account & security.

Admins can edit menu names, prices, availability, and photos in **Menu & packages**. Uploaded JPEG, PNG, and WebP photos are capped at 1 MB and stored in PostgreSQL, so they survive web service restarts. The original sample photos remain available as choices.

For local development with an existing PostgreSQL service, use `npm run dev:app`. `npm run dev` is a preview helper that starts a local ephemeral database and serves the production build if no `DATABASE_URL` is set; it is not the production process. To run the automated checks: `npm test`, `npm run typecheck`, `npm run build`, and `node scripts/integration-test.mjs` (the latter starts an isolated local PostgreSQL process and the production app).

## Pickup scheduling, rental quotes, and notifications

Customers select an available 30-minute pickup slot up to 14 Philippine calendar days ahead. Availability is rechecked under a database lock when the order is placed, so concurrent checkouts cannot exceed the configured capacity. Staff and Admin have a preparation board with live due timers, and Admin can edit each weekday's pickup opening hours, closing hours, and orders per slot under **Pickup hours**. The initial schedule is 08:00–18:00, five orders per 30-minute slot, every day; change those defaults in Admin to match actual service.

Admin can set a fixed transport fee per coffee cart package in **Menu & packages**. Each new reservation stores the package price and fee separately, displays the combined total, 50% deposit, and remaining balance. Earlier reservations retain their original totals and show a zero fee.

Order creation, order status changes, cart requests, and cart status changes appear in customer in-app **Updates** (alongside My Orders/My Reservations). If email is configured, the same key events are sent by email after saving the database change. Email failures are logged without undoing an order or booking.

## Railway deployment

Create a **new, separate** Railway project and connect a GitHub repository containing this code. Add a PostgreSQL database to the project. On the web service set:

- `DATABASE_URL`: reference the Railway PostgreSQL connection string.
- `AUTH_ENCRYPTION_KEY`: a fresh 64-character random hex string, kept private.
- `APP_URL`: the exact public HTTPS origin for this site.
- `ADMIN_SETUP_TOKEN`: a separate random 64-character hex one-time setup code. Never commit it. Remove this variable from Railway after the first Admin is created.
- `NODE_ENV`: `production`.
- `RESEND_API_KEY` and `RESET_FROM_EMAIL`: optional customer password recovery email. Set `UPDATES_FROM_EMAIL` to an approved sender on the same verified domain for customer order and booking notifications (or reuse `RESET_FROM_EMAIL`). Verify the sender domain in Resend, use its API key, and set `RESET_FROM_EMAIL` to an address on that domain. Until both are configured, the customer sign-in page hides **Forgot password?**; Staff and Admin continue using recovery codes and Admin-mediated Staff recovery. Customer reset links expire after 30 minutes, work once, and revoke previous sessions. Never commit the key.

Build: `npm run build`. Start: `npm start`. Pre-deploy command: `npm run db:migrate && npm run db:seed` (seed upserts sample catalog without overwriting existing edits). Set the web service public domain, set `APP_URL` to that origin, and redeploy. For the first Admin, open `/operations/login`, choose **Set up the first Admin account**, and enter the setup code from the Railway variable, your own email, and your own password. Complete Google Authenticator enrollment and save the one-time recovery codes. Then remove `ADMIN_SETUP_TOKEN` from Railway. Ensure you can sign in, create a Staff account, and complete a test order and booking before launch. Railway's managed Postgres needs backups and your project's cost settings reviewed before handling live client data.

## Business assumptions to confirm

- One cart can serve one event per Philippine calendar day. Pending booking requests do not hold the date; a verified 50% deposit and Admin confirmation make it unavailable. Dates manually blocked by Admin are also unavailable.
- Event dates are shown publicly without customer names. Frontend and backend both enforce availability; confirmation serializes competing bookings in PostgreSQL.
- Orders are for pickup or in-person POS. Customers see a five-stage progress tracker in My Orders, and customer and operations order and reservation lists refresh roughly every five seconds while the page is visible. Reservation requests and status changes create in-app updates in the relevant account; updates refresh every 15 seconds while the page is visible. These updates do not send email or SMS. Staff records payments manually; rental payments are recorded by Admin after verification. No online payment gateway or automatic ingredient deduction is included.
- Reusable cups, glasses, trays, and pitchers are tracked by assignments and returned condition. Staff manually records the return; no inventory changes arise from coffee or meal orders.
- Initial products, prices, packages, and images are demonstration content. Business name and address, policies, packaging, transport fees, actual product photos, payment instructions, and accessibility copy require client approval.

## Security behavior

Customer self-registration always creates a CUSTOMER account. Only Admin creates STAFF or ADMIN accounts. Privileged sessions remain unverified until a valid TOTP or one-time recovery code is submitted. TOTP secrets use AES-GCM encryption, recovery codes are stored as hashes, sessions are opaque and stored server-side, and operations are checked against the role on every API request. Reservation confirmation and asset assignments use PostgreSQL transaction locks. All mutations reject cross-origin JSON requests. Deploy behind HTTPS with a strong encryption key; changing that key invalidates stored authenticator secrets and will require a controlled recovery process.
