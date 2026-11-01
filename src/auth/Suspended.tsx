import "./AuthScreen.css";
import { useAuth } from "./AuthProvider";

export default function Suspended({ until, reason, guest = false }: { until: string; reason: string | null; guest?: boolean }) {
  const { signOut } = useAuth();
  const end = new Date(until);
  const forever = end.getFullYear() >= 9999;
  return (
    <main className="auth">
      <div className="auth-card" role="alert">
        <img className="auth-logo" src="/favicon.svg" alt="" width={56} height={56} />
        <p className="auth-brand">Tempo</p>
        <h1 className="auth-title">{guest ? "Guest play suspended" : "Account suspended"}</h1>
        <p className="auth-text">
          {guest
            ? forever
              ? "Guest play from your network has been suspended permanently."
              : `Guest play from your network is suspended until ${end.toLocaleString()}.`
            : forever
              ? "This account has been suspended permanently."
              : `This account is suspended until ${end.toLocaleString()}.`}
        </p>
        {reason && <p className="auth-error">Reason: {reason}</p>}
        {guest && <p className="auth-text">You can still sign in with an account.</p>}
        <button className="auth-submit" onClick={() => void signOut()}>
          {guest ? "Sign in instead" : "Sign out"}
        </button>
      </div>
    </main>
  );
}