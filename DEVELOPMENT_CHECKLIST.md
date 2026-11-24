# Development Checklist

## Implemented in the current update
- [x] Existing Express + SQLite platform foundation retained
- [x] Buyer/Tenant search, favourites, enquiries, visits and loan APIs retained
- [x] Owner/Admin/Super Admin-only direct property creation enforced server-side
- [x] Builder project creation and unit inventory APIs + connected dashboard page
- [x] Channel Partner referral APIs + connected dashboard page
- [x] Investor enquiry APIs + connected dashboard page
- [x] Admin Partner Leads and Investor Enquiries pages
- [x] Rental fields: monthly rent, deposit, availability date and tenant preference
- [x] PG fields: PG gender, meals, room type and sharing type
- [x] Rent and PG search filters connected to property search API
- [x] Partner commission ledger APIs and partner/admin pages
- [x] Admin Featured Offer creation page and active offer API
- [x] Homepage uses active offers in the featured horizontal scroller, with approved-property fallback
- [x] Official logo, brand styling, hover interactions and page entrance animations
- [x] JavaScript syntax checks pass for app.js and server.js

## Still required before production-ready completion
- [ ] Runtime database/API integration test using a clean copy of the user's DB
- [ ] Browser test of every role and page using real test accounts
- [ ] Secure image/video/document upload with file type/size validation and storage
- [ ] Email/mobile OTP and password reset delivery via configured providers
- [ ] Builder project edit/delete, inventory update and admin approval/rejection UI
- [ ] Referral conversion workflow, configurable commission policy and payout reconciliation
- [ ] Investor opportunity catalogue with admin-managed verified opportunities
- [ ] Featured offer edit/deactivate UI, date validation and property detail discount display
- [ ] PG-specific listing cards and all PG filter edge cases
- [ ] State/district/city/village/PIN master data and maps integration
- [ ] CRM lead assignment, follow-ups and reporting
- [ ] Payment gateway/subscription integration if required
- [ ] External lender integration; EMI remains an estimate
- [ ] Automated API/UI/security tests, production deployment, backups and monitoring
- [ ] Legal review for RERA, DPDP, consumer and platform obligations

Do not mark pending items complete until implemented and tested with valid services/data.
