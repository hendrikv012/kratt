import { useEffect, useState } from "react";

export function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function AnalogFace({ now, seconds }) {
  const hand = (turns, length, width, className) => {
    const a = turns * Math.PI * 2;
    return (
      <line
        className={className}
        x1="50"
        y1="50"
        x2={50 + Math.sin(a) * length}
        y2={50 - Math.cos(a) * length}
        strokeWidth={width}
        strokeLinecap="round"
      />
    );
  };
  const s = now.getSeconds();
  const m = now.getMinutes() + s / 60;
  const h = (now.getHours() % 12) + m / 60;
  return (
    <svg className="st-clock-face" viewBox="0 0 100 100" role="img" aria-label={now.toLocaleTimeString()}>
      <circle cx="50" cy="50" r="46" className="st-clock-rim" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return (
          <line
            key={i}
            className="st-clock-tick"
            x1={50 + Math.sin(a) * 38}
            y1={50 - Math.cos(a) * 38}
            x2={50 + Math.sin(a) * (i % 3 ? 41 : 43)}
            y2={50 - Math.cos(a) * (i % 3 ? 41 : 43)}
          />
        );
      })}
      {hand(h / 12, 22, 3.2, "st-clock-hand")}
      {hand(m / 60, 32, 2.2, "st-clock-hand")}
      {seconds && hand(s / 60, 35, 1, "st-clock-second")}
      <circle cx="50" cy="50" r="2.4" className="st-clock-pin" />
    </svg>
  );
}

// The digital time grows with its Home tile.
const TIME_PX = { "1x1": 60, "2x1": 92, "2x2": 140 };

// Options come from Settings > Layout and home screen > Clock. `size` is
// the Home tile's size, when it sits on Home.
export default function ClockWidget({ home, size }) {
  const { style, hours, seconds, date } = home.clock;
  const now = useNow();
  const time = now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: seconds ? "2-digit" : undefined,
    hour12: hours === "12",
  });

  return (
    <section className="st-widget st-clock" data-style={style}>
      {style === "analog" ? <AnalogFace now={now} seconds={seconds} /> : <p className="st-clock-time" style={TIME_PX[size] ? { fontSize: TIME_PX[size] } : undefined}>{time}</p>}
      {date && (
        <p className="st-clock-date">
          {now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
        </p>
      )}
    </section>
  );
}

// The time in the top bar: small and quiet, so it never outshouts the graph.
export function TopBarClock({ hours }) {
  const now = useNow();
  return (
    <time className="st-topbar-clock" dateTime={now.toISOString()}>
      {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: hours === "12" })}
    </time>
  );
}
