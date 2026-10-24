# 👻 Ghost Queue

> **A real-time, contactless virtual queuing and digital signage platform built for restaurants, clinics, retail stores, and service counters.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-ghost--queue--4ddef.web.app-7c3aed?style=for-the-badge&logo=firebase&logoColor=white)](https://ghost-queue-4ddef.web.app)
[![React](https://img.shields.io/badge/React-19.2-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8.0-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Firebase](https://img.shields.io/badge/Firebase-12.11-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)](https://firebase.google.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

---

## 📌 Overview

**Ghost Queue** transforms physical waiting lines into an interactive, frictionless digital experience. Customers join queues seamlessly via QR code or store search, receive real-time ticket updates directly on their mobile browser, and can pass their turn if running late. 

For business operators, Ghost Queue provides an airport-grade TV digital signage mode, an administrative command center with queue intelligence analytics, staff counter management, and zero-cost client-side Firestore architecture compatible with the Firebase Spark plan.

🔗 **Live Deployment:** [https://ghost-queue-4ddef.web.app](https://ghost-queue-4ddef.web.app)  
📂 **Source Code:** [https://github.com/kailasasiddartha/GHOST-QUEUE](https://github.com/kailasasiddartha/GHOST-QUEUE)

---

## ✨ Features

### 📱 Customer Mobile Experience (`/q/:storeId` & `/`)
- **Instant Contactless Join:** Scan a physical or digital QR code to enter the queue without downloading a native mobile app.
- **Live Ticket Status:** Real-time ticket number, current position in line, estimated wait time (ETA), and serving counter allocation.
- **Self-Service Queue Management:**
  - **Pass My Turn / Delay:** Defer turn by a few minutes or skip back 1–5 spots when delayed.
  - **Cancel & Leave:** Voluntarily leave the queue with real-time atomic queue re-indexing.
- **Audio & Push Alerts:** Web Audio API sound alerts (airport chime) and Firebase Cloud Messaging (FCM) web push notifications when called.
- **Multilingual Support:** One-click language switching between **English**, **Telugu (తెలుగు)**, and **Hindi (हिंदी)**.
- **Store Directory & Search:** Browse open stores, filter by category (Restaurant, Clinic, Retail, Banking), check live operating schedules, and pin favorite stores.

### 📺 Digital Signage Display Mode (`/display/:storeId`)
- **Airport Lounge Signage:** Full-screen TV layout with high-visibility **NOW SERVING** ticket callouts and neon status indicators.
- **Up-Next Board:** Live carousel of incoming ticket numbers and party sizes.
- **Offline Join QR Code:** Embedded scannable QR code allowing walk-in customers to join instantly from their camera.
- **Live Digital Clock & Ticker:** Dynamic time display and marquee announcement banner for store alerts and notices.
- **Audio Chime:** Dual-tone airport chime automatically triggered on ticket calls.

### 🛠️ Store Staff & Admin Command Center (`/admin`)
- **Role-Based Authentication:** Secure Google OAuth and Email/Password sign-in via Firebase Authentication.
- **Full Queue Lifecycle Management:**
  - **Call Next:** Summons the next waiting party and sounds the signage chime.
  - **Mark as Served:** Concludes service and logs completed session metrics.
  - **Call Back / Re-serve:** Recall a customer if they stepped away.
  - **Mark as No-Show:** Moves absent customers to the inactive history pool.
  - **Manual Party Check-in:** Create walk-in entries directly for non-smartphone users.
- **Queue Intelligence Engine:**
  - **Queue Health Score (0–100):** Real-time monitoring of queue velocity, backlog, and service stability.
  - **No-Show Risk Predictor:** Identifies parties likely to drop off based on wait times and late signals.
- **Operational Controls:**
  - **One-Click Open/Close:** Pause or resume queue intake at any time.
  - **Capacity Limits:** Set maximum queue sizes to prevent overload.
  - **Weekly Operating Hours:** Configure day-by-day open/close schedules with automatic holiday overrides.
  - **Broadcast Announcements:** Push instant banner messages to all waiting customers.
  - **Excel Export:** Download operational history and party metrics to `.xlsx` spreadsheet files.
  - **Brand Customization:** Personalize primary and secondary brand accent colors.

### 🏢 Store Self-Registration (`/register`)
- Self-service onboarding for new business owners with custom slug IDs, category assignments, and counter configurations.

---

## 🏛️ Architecture & System Design

Ghost Queue is designed around a **Client-Side Spark Architecture**, maximizing performance and eliminating recurring cloud function costs while enforcing strict security rules.

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                             │
│                                                                 │
│   Customer Mobile        TV Digital Signage     Admin Dashboard │
│   (/q/:storeId)          (/display/:storeId)    (/admin)        │
└────────────┬─────────────────────┬─────────────────────┬────────┘
             │                     │                     │
             ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│               OPTIMIZED BUNDLE & CLIENT UTILITIES               │
│                                                                 │
│  • qr-engine (23 kB)       • Sound Effects (Web Audio API)      │
│  • export-excel (424 kB)   • Queue Intelligence & Velocity      │
│  • i18n Localization Engine• Firestore Transactions & Batches   │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                   FIREBASE BACKEND SERVICES                     │
│                                                                 │
│  • Cloud Firestore (Atomic Transactions & Multi-tab IndexedDB)  │
│  • Firestore Security Rules (Strict RBAC & Self-Entry Checks)   │
│  • Firebase Authentication (Google OAuth + Email/Password)      │
│  • Firebase Cloud Messaging (Web Push Notifications)            │
│  • Firebase Hosting (Global CDN Edge Delivery)                  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Technical Highlights
- **Zero-Cloud-Function Spark Architecture:** All queue operations (joining, serving, re-indexing, passing turns) execute via Firestore `runTransaction` and `writeBatch`, ensuring atomic consistency without requiring paid serverless backends.
- **Decoupled Bundle Strategy:** Using Vite's `manualChunks`, the heavy Excel export engine (`xlsx`, 424 kB) is split into a dedicated vendor chunk loaded strictly by store admins, while customer-facing pages load only the compact QR engine (`qrcode`, 23 kB).
- **Hardened Security Rules (`firestore.rules`):** Public customers can only read store metadata and modify their own queue entry (`isSelfEntry`), while write operations on store settings, queue administration, and analytics require verified store staff credentials (`isStoreStaff`).

---

## 💻 Tech Stack

| Domain | Technology | Description |
| :--- | :--- | :--- |
| **Frontend Framework** | [React 19](https://react.dev/) | Component architecture with React Hooks & Suspense |
| **Build Tool & Dev Server**| [Vite 8](https://vitejs.dev/) | Lightning-fast HMR and optimized Rolldown/Rollup bundling |
| **Styling & Design System**| [Tailwind CSS 3](https://tailwindcss.com/) | Curated dark mode, glassmorphism (`backdrop-blur`), and neon glows |
| **Icons** | [Material Symbols](https://fonts.google.com/icons) | Clean, scalable vector iconography |
| **Database & Realtime** | [Cloud Firestore](https://firebase.google.com/docs/firestore) | Real-time multi-tab synchronized NoSQL document database |
| **Authentication** | [Firebase Auth](https://firebase.google.com/docs/auth) | Google OAuth 2.0 & Email/Password authentication |
| **Notifications** | [Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging) | Web push notifications via Service Worker (`sw.js`) |
| **Audio Synthesis** | Web Audio API | Pure programmatic sound generation for airport chimes |
| **Data Export** | [SheetJS (xlsx)](https://sheetjs.com/) | Client-side spreadsheet generation for operational analytics |
| **Package Runtime** | [Bun](https://bun.sh/) / [Node.js](https://nodejs.org/) | Modern, high-performance package management and scripting |

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** (v18.0.0 or higher) or **Bun** (v1.0.0 or higher)
- A **Firebase Project** with Firestore, Authentication, and Hosting enabled

### 1. Clone the Repository
```bash
git clone https://github.com/kailasasiddartha/GHOST-QUEUE.git
cd GHOST-QUEUE
```

### 2. Install Dependencies
Using **Bun** (recommended):
```bash
bun install
```
Or using **npm**:
```bash
npm install
```

### 3. Configure Environment Variables
Copy the template configuration file:
```bash
cp .env.example .env
```
Open `.env` and fill in your Firebase Web App credentials (available in the Firebase Console under **Project Settings > General > Your apps**):
```env
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project_id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project_id.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
VITE_FIREBASE_APP_ID=your_firebase_app_id

# Optional
VITE_FIREBASE_VAPID_KEY=your_vapid_key_here
VITE_RECAPTCHA_SITE_KEY=your_recaptcha_v3_site_key_here
```

### 4. Run the Development Server
```bash
bun run dev
```
Open your browser and navigate to `http://localhost:5173/`.

---

## 🔒 Firebase Setup & Security Rules

### 1. Enable Firebase Authentication
1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Navigate to **Authentication > Sign-in method**.
3. Enable **Google** and **Email/Password** providers.

### 2. Enable Cloud Firestore
1. Navigate to **Firestore Database** and create a database in production mode.
2. Select your desired region (e.g., `asia-south1` or `us-central1`).

### 3. Deploy Security Rules & Indexes
Deploy the pre-configured rules and composite indexes to ensure data integrity and access control:
```bash
npx firebase deploy --only firestore:rules,firestore:indexes
```

### 4. Deploy Web App to Firebase Hosting
```bash
# Build the production bundle
bun run build

# Deploy to Firebase Hosting
npx firebase deploy --only hosting
```

---

## 📂 Project Structure

```
GHOST-QUEUE/
├── .env.example              # Safe environment variable template
├── .gitignore                # Comprehensive exclusions (logs, env, dist, node_modules)
├── firebase.json             # Firebase Hosting and Firestore configuration
├── firestore.rules           # Production security rules (RBAC + Self-Entry restrictions)
├── firestore.indexes.json    # Firestore composite query indexing configuration
├── index.html                # Single-page application root HTML
├── package.json              # Project dependencies and lifecycle scripts
├── tailwind.config.js        # Design tokens, color system, and UI extensions
├── vite.config.js            # Build configuration, alias mappings, and chunk partitioning
│
├── public/                   # Static public assets
│   ├── favicon.svg           # Application logo
│   ├── firebase-messaging-sw.js # Background push notification service worker
│   ├── manifest.webmanifest  # Progressive Web App (PWA) manifest
│   └── sw.js                 # Service worker cache implementation
│
└── src/
    ├── App.jsx               # Application routes, error boundaries, and auth gates
    ├── main.jsx              # Application bootstrap & DOM mounting
    ├── index.css             # Global Tailwind directives & glassmorphic styles
    │
    ├── components/           # Reusable UI Components
    │   ├── AppErrorBoundary.jsx # Isolated route-level crash fallback
    │   ├── ConfirmDialog.jsx    # Modal confirmation dialogues
    │   ├── JoinQueueForm.jsx    # Customer ticket creation form
    │   └── ToastStack.jsx       # Non-intrusive toast notification system
    │
    ├── hooks/                # Custom React Hooks
    │   ├── useQueue.js       # Real-time Firestore queue listener hook
    │   └── useToast.js       # Toast dispatch and lifecycle management
    │
    ├── pages/                # Application Route Views
    │   ├── CustomerHome.jsx  # Main store directory, category filters, and search
    │   ├── QueuePage.jsx     # Customer live ticket pass and queue tracking
    │   ├── DisplayPage.jsx   # Airport TV digital signage display mode
    │   ├── AdminDashboard.jsx# Staff operational dashboard and queue controls
    │   ├── AdminLogin.jsx    # Authentication portal for store staff
    │   ├── RegisterStore.jsx # New store self-onboarding wizard
    │   └── NotFound.jsx      # 404 fallback page
    │
    ├── styles/               # Styling tokens and CSS variables
    │   └── theme.css         # Theme palette, dark tokens, and animations
    │
    └── utils/                # Core Business Logic & Helpers
        ├── auth.js           # Authentication helpers and user session tracking
        ├── firebase.js       # Firebase SDK initialization with multi-tab IndexedDB cache
        ├── firestore.js      # Client-side atomic transaction engine
        ├── heartbeat.js      # Store staff presence and liveness tracking
        ├── i18n.js           # Multilingual translation dictionary (EN, TE, HI)
        ├── pushNotifications.js # Web Push registration and token dispatch
        ├── queueIntelligence.js# Queue health scoring and risk evaluation
        ├── queueTicket.js    # Pass generation and display formatting
        ├── soundEffects.js   # Web Audio API procedural sound synthesizer
        ├── storePreferences.js# Persistent user preferences (favorites, language)
        └── storeStatus.js    # Weekly schedule parsing and open/closed evaluation
```

---

## 🛡️ Security & Quality Assurance

- **Zero Exposed Secrets:** Environment variables and Firebase credentials use `import.meta.env` references. Secret keys and local configs are excluded via `.gitignore`.
- **Role-Based Access Control:** All administrative operations check `isStoreStaff(storeId)` before granting read or write permissions.
- **Client Entry Protection:** Individual queue entries cannot be tampered with by external parties; updates are constrained to `isSelfEntry(entryId)`.
- **Static Analysis & Linting:** Clean ESLint configuration (`bun run lint` passes with 0 warnings).
- **Optimized Assets:** Production bundle size optimized with sub-1.2s builds and lazy chunk evaluation.

---

## 🔮 Roadmap & Future Enhancements

- [ ] **SMS & WhatsApp Dispatch:** Direct automated SMS or WhatsApp notifications when customers are next in line.
- [ ] **Multi-Counter Matrix:** Simultaneous ticket dispatch across numbered service counters and departments.
- [ ] **Surge Predictive AI:** Historical wait time forecasting powered by machine learning trend models.
- [ ] **Customer Feedback Ratings:** One-tap post-service satisfaction surveys.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) — free to use and adapt for commercial and private deployments.

---

## 👨‍💻 Author

**Kailasa Siddartha**  
- **GitHub:** [@kailasasiddartha](https://github.com/kailasasiddartha)  
- **Repository:** [https://github.com/kailasasiddartha/GHOST-QUEUE](https://github.com/kailasasiddartha/GHOST-QUEUE)
