# Secondary School – Student Information Management System

A full-stack web application for managing students, teachers, classes, attendance, assessments, reports, and school communications.

## Features
- Public landing page with responsive navigation to onboarding, About Us, and Contact Us
- Persistent multilingual interface, Arabic right-to-left layout, and localized Addis Ababa clock
- Account-bound profile photo upload, camera capture, replacement, and removal
- Persistent light/dark theme switch
- Secure login with role-based access for admin, teacher, student, and parent
- Role-specific, protected dashboards after sign-in
- Real dashboard metrics powered by SQLite data
- Student, teacher, class, and subject management
- Attendance tracking and exam mark entry
- Announcements and school settings management

## Run locally
1. `npm install`
2. Copy `.env.example` to `.env` and set a long random `SESSION_SECRET`.
3. Configure `APP_BASE_URL` and, when needed, Google OAuth and SMTP values described below.
4. `npm start`
5. Open `http://localhost:3000`

Tailwind styles are authored in `public/css/tailwind.input.css` with shared tokens in `tailwind.config.js`. `npm start` builds `public/css/app.css` before starting Express; run `npm run build:css` after changing styles.

The landing page opens first. **Get Started** opens the login page; About Us and Contact Us are available from public navigation. Self-registration is limited to student and parent accounts. Teacher and administrator accounts must be provisioned by the school and cannot be selected publicly. Language and theme selections are saved in the browser. Translations use the Google Translate web endpoint and require an internet connection; original English text remains available when the service is unreachable. Camera capture requires a secure browser context (HTTPS or localhost) and camera permission.

## Google sign-in and password recovery
Create a Google Cloud OAuth 2.0 **Web application** client. Add the app origin (for example `http://localhost:3000`) to its authorized JavaScript origins, then set `GOOGLE_CLIENT_ID` in `.env`. Google Identity Services sends an ID token to the server; the server verifies its signature, audience, issuer, and verified email. Google sign-in links only to an existing account with the same verified email; it does not create accounts or elevate roles.

For password recovery, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`. Set `APP_BASE_URL` to the canonical HTTPS origin in production so reset links cannot be built from an untrusted request host. Reset tokens are stored as SHA-256 hashes, expire after 30 minutes, and are single-use. The application does not send reset links until SMTP is configured.

Development users are seeded idempotently at startup only outside production. Existing accounts are not overwritten, and legacy `@bemilew.edu` addresses are migrated to unique Gmail addresses without changing account IDs or relationships. Production runs require `SESSION_SECRET` to be set in the environment.

## Demo credentials
- Admin: `admin@gmail.com` / `Admin123!`
- Teacher: `teacher@gmail.com` / `Teacher123!`
- Student: `student@gmail.com` / `Student123!`
- Parent: `parent@gmail.com` / `Parent123!`
