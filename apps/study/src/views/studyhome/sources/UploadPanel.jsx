import { useEffect, useRef, useState } from "react";
import Kratt from "../kratt/Kratt";
import { Button } from "../ui/button";
import { motionReduced } from "../motion";
import { useUploads } from "./UploadsProvider";
import "./uploads.css";

// Kratt "at work" in the bottom-right corner while files upload, and for a
// moment after with what happened. Mounted once by the shell, outside the routed
// view, so it stays across tabs.

export const PANEL_AFTER = 6000;

const UNITS = [["GB", 1000 ** 3], ["MB", 1000 ** 2], ["KB", 1000]];
// Both numbers use the unit of the bigger one, so "0.5 MB of 1.0 MB" reads as a fraction.
export function formatBytes(bytes, of = bytes) {
  const [unit, size] = UNITS.find(([, s]) => of >= s) ?? ["KB", 1000];
  return `${(bytes / size).toFixed(1)} ${unit}`;
}

export default function UploadPanel() {
  const uploads = useUploads();
  const status = uploads?.status;
  const ref = useRef(null);
  // Which finished summary has been shown long enough.
  const [hidden, setHidden] = useState(null);
  const summary = status?.summary;
  useEffect(() => {
    if (status?.running) { setHidden(null); return; }
    if (!summary || status?.details?.length) return;
    const timer = setTimeout(() => setHidden(summary), PANEL_AFTER);
    return () => clearTimeout(timer);
  }, [summary, status?.running, status?.details]);
  if (!status || !(status.running || (summary && hidden !== summary))) return null;

  const still = motionReduced(ref.current) || undefined;
  return (
    <section className="st-uploads" ref={ref} aria-label="Uploads" data-still={still}>
      <Kratt size={28} mode={status.running ? "think" : "hop"} />
      <div className="st-uploads-body" role="status">
        {status.running ? (
          <>
            <div className="st-uploads-title">{status.total ? `Uploading ${status.index} of ${status.total} · ${status.name}` : "Adding sources…"}</div>
            {status.total > 0 && (
              <>
                <progress max={status.totalBytes || 1} value={status.doneBytes} aria-label="Upload progress" />
                <div className="st-uploads-bytes">{`${formatBytes(status.doneBytes, status.totalBytes)} of ${formatBytes(status.totalBytes)}`}</div>
              </>
            )}
            <Button variant="ghost" size="sm" onClick={uploads.cancel}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <div className="st-uploads-title">{summary}</div>
            {status.details?.length > 0 && <details><summary>Files needing attention</summary><ul>{status.details.map((item, i) => <li key={i}>{item.name}: {item.message}</li>)}</ul></details>}
            {status.details?.length > 0 && <Button variant="ghost" size="sm" onClick={() => setHidden(summary)}>Dismiss</Button>}
          </>
        )}
      </div>
    </section>
  );
}
