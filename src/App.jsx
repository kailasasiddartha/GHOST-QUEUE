import React, { Component, Suspense, lazy, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, useParams } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./firebase";
import "./styles/theme.css";

const QueuePage = lazy(() => import("./pages/QueuePage"));
const AdminLogin = lazy(() => import("./pages/AdminLogin"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const RegisterStore = lazy(() => import("./pages/RegisterStore"));
const CustomerHome = lazy(() => import("./pages/CustomerHome"));
const DisplayPage = lazy(() => import("./pages/DisplayPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

function AppLoading() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", gap: 16, flexDirection: "column" }}>
      <span className="material-symbols-outlined" style={{ fontSize: 48, color: "#7c3aed", animation: "spin 1s linear infinite" }}>blur_on</span>
      <p className="font-label" style={{ color: "var(--on-surface-variant)", textTransform: "uppercase", letterSpacing: "0.1em", fontSize: "0.75rem" }}>Loading...</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/**
 * RouteErrorBoundary — per-route isolation so one route crash doesn't kill the whole app.
 */
class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("[RouteErrorBoundary]", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background text-on-background flex items-center justify-center p-6">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-surface-container p-8 text-center">
            <span className="material-symbols-outlined text-5xl text-error">error</span>
            <h1 className="mt-4 text-2xl font-headline font-bold">{this.props.title || "Something went wrong"}</h1>
            <p className="mt-3 text-sm text-on-surface-variant">{this.props.description || "An unexpected error occurred. Reload to recover."}</p>
            {this.state.error && (
              <div className="mt-4 p-4 rounded-xl bg-black/60 border border-red-500/30 text-left overflow-auto max-h-60 text-xs font-mono text-red-300">
                <p className="font-bold text-red-400 mb-1">{this.state.error.name}: {this.state.error.message}</p>
                <pre className="text-[10px] text-white/50 whitespace-pre-wrap">{this.state.error.stack}</pre>
              </div>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 w-full rounded-xl bg-gradient-to-r from-primary-container to-secondary py-3 font-headline font-bold text-white cursor-pointer"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Route param wrappers — pull :storeId from react-router and pass to existing page components
function QueuePageWrapper() {
  const { storeId } = useParams();
  return <QueuePage storeIdParam={storeId || null} />;
}

function DisplayPageWrapper() {
  const { storeId } = useParams();
  return <DisplayPage storeIdParam={storeId || null} />;
}

function AdminRoute({ adminUser }) {
  return (
    <RouteErrorBoundary title="Admin Dashboard Error" description="The admin dashboard encountered an error. Your queue data is safe. Reload to recover.">
      <Suspense fallback={<AppLoading />}>
        {!adminUser ? <AdminLogin onLogin={() => {}} /> : <AdminDashboard adminUser={adminUser} />}
      </Suspense>
    </RouteErrorBoundary>
  );
}

export default function App() {
  const [adminUser, setAdminUser] = useState(undefined);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setAdminUser(user && !user.isAnonymous ? user : null);
    });
    return unsub;
  }, []);

  if (adminUser === undefined) {
    return <AppLoading />;
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Admin — auth-gated */}
        <Route path="/admin" element={<AdminRoute adminUser={adminUser} />} />
        <Route path="/admin/*" element={<AdminRoute adminUser={adminUser} />} />

        {/* Store registration */}
        <Route
          path="/register"
          element={
            <RouteErrorBoundary title="Registration Error" description="Store registration encountered an error. Reload to try again.">
              <Suspense fallback={<AppLoading />}>
                <RegisterStore />
              </Suspense>
            </RouteErrorBoundary>
          }
        />

        {/* Digital signage display */}
        <Route
          path="/display/:storeId"
          element={
            <RouteErrorBoundary title="Display Error" description="The signage display encountered an error. Reload to reconnect.">
              <Suspense fallback={<AppLoading />}>
                <DisplayPageWrapper />
              </Suspense>
            </RouteErrorBoundary>
          }
        />
        <Route
          path="/display"
          element={
            <RouteErrorBoundary title="Display Error" description="The signage display encountered an error. Reload to reconnect.">
              <Suspense fallback={<AppLoading />}>
                <DisplayPage storeIdParam={null} />
              </Suspense>
            </RouteErrorBoundary>
          }
        />

        {/* Customer queue page */}
        <Route
          path="/q/:storeId"
          element={
            <RouteErrorBoundary title="Queue Page Error" description="This queue page crashed. Your position is safe — reload to reconnect.">
              <Suspense fallback={<AppLoading />}>
                <QueuePageWrapper />
              </Suspense>
            </RouteErrorBoundary>
          }
        />
        <Route
          path="/q"
          element={
            <RouteErrorBoundary title="Queue Page Error" description="This queue page crashed. Your position is safe — reload to reconnect.">
              <Suspense fallback={<AppLoading />}>
                <QueuePage storeIdParam={null} />
              </Suspense>
            </RouteErrorBoundary>
          }
        />

        {/* Customer home / store search */}
        <Route
          path="/"
          element={
            <RouteErrorBoundary title="Page Error" description="Something went wrong loading this page. Reload to try again.">
              <Suspense fallback={<AppLoading />}>
                <CustomerHome />
              </Suspense>
            </RouteErrorBoundary>
          }
        />

        {/* 404 catch-all */}
        <Route
          path="*"
          element={
            <Suspense fallback={<AppLoading />}>
              <NotFound />
            </Suspense>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
