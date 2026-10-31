import { useEffect, useState } from "react";
import { OFFLINE_MESSAGE, useStudy } from "./data/StudyProvider";
import "./styles/vault.css";

const AT_RISK_MS = 30000;

// Says something only when work is at risk or needs attention: the service is away,
// a change hasn't saved for 30 s, or a clash kept two versions.
export default function VaultBanner() {
  const { vault } = useStudy();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!vault.unsavedSince) return undefined;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [vault.unsavedSince]);

  const waited = vault.unsavedSince ? now - vault.unsavedSince : 0;
  const message = vault.offline
    ? OFFLINE_MESSAGE
    : waited > AT_RISK_MS
      ? `Not saved for ${Math.round(waited / 1000)} s, still trying`
      : null;

  if (!message && !vault.notice) return null;
  return (
    <div className="st-vault-banner" role="status">
      {message && <p>{message}</p>}
      {vault.notice && (
        <p>
          {vault.notice}{" "}
          <button className="st-ghost-button" onClick={vault.dismissNotice}>
            OK
          </button>
        </p>
      )}
    </div>
  );
}
