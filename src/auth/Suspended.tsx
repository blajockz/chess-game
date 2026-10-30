import "./AuthScreen.css";
import { useAuth } from "./AuthProvider";

export default function Suspended({ until, reason }: { until: string; reason: string | null }) {
  const { signOut } = useAuth();
  const end = new Date(until);
  const forever = end.getFullYear() >= 9999;
  return (
    <main className="auth">
      <div className="auth-card" role="alert">
        <img className="auth-logo" src="/favicon.svg" alt="" width={56} height={56} />
        <p className="auth-brand">Tempo</p>
        <h1 className="auth-title">Account suspended</h1>
        <p className="auth-text">
          {forever ? "This account has been suspended permanently." : `This account is suspended until ${end.toLocaleString()}.`}
        </p>
        {reason && <p className="auth-error">Reason: {reason}</p>}
        <button className="auth-submit" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </main>
  );
}
