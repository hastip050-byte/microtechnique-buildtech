# Microtechnique Buildtech

India-focused real-estate portal built with Node.js, Express and SQLite.

## Run locally
1. Use Node.js 24.x.
2. Copy `.env.example` to `.env`.
3. Set a unique random SESSION_SECRET and a strong ADMIN_PASSWORD in `.env`.
4. Run `npm install`.
5. Run `npm start`.
6. Open `http://localhost:3000`.

This archive excludes `.env`, `node_modules`, session SQLite files and transient WAL/SHM files. Keep a backup of your existing database before replacing project files.

## Connected modules
- Public homepage, buy/rent/commercial/plots/new projects/PG search, property details.
- Login and registration, buyer/tenant favourites, enquiries and visit requests.
- Owner property submission and management.
- Builder project and inventory management (separate from direct property posting).
- Channel Partner referrals and commission ledger.
- Investor enquiries.
- Admin property review, users, verification, loans, services, partner leads, investor enquiries, commissions and featured offers.
- Rent filters for monthly rent, deposit, furnishing, availability and tenant preference.
- PG filters for audience, room type and meals.
- Home loan EMI estimate and loan enquiry workflow.

## Property posting permissions
Direct property creation API is restricted to `owner`, `admin`, and `super_admin`. Buyer and tenant cannot post. Builder accounts manage builder projects and inventory through separate endpoints.

## External services / production
OTP, email delivery, maps, secure media storage, payment gateway and lender integrations require approved providers and credentials. This project is not certified production-ready; follow `DEVELOPMENT_CHECKLIST.md` and obtain legal/security review before launch.
