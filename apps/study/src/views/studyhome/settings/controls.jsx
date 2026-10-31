import { Switch } from "../ui/switch";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

// Small building blocks shared by every settings section.

export function Section({ title, description, children }) {
  return (
    <section>
      <h2 className="st-set-title">{title}</h2>
      {description && <p className="st-set-desc">{description}</p>}
      {children}
    </section>
  );
}

export function Group({ title, children }) {
  return (
    <div className="st-set-group">
      {title && <h3 className="st-set-group-title">{title}</h3>}
      {children}
    </div>
  );
}

export function Row({ label, description, children, htmlFor }) {
  return (
    <div className="st-set-row">
      <div className="st-set-row-text">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
        {description && <p>{description}</p>}
      </div>
      <div className="st-set-row-control">{children}</div>
    </div>
  );
}

export function Toggle({ checked, onChange, label }) {
  return <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />;
}

export function Segmented({ value, options, onChange, label, size = "default" }) {
  return (
    <ToggleGroup
      type="single"
      role="radiogroup"
      aria-label={label}
      value={value}
      onValueChange={(v) => v && onChange(v)}
      className="justify-start gap-0.5 rounded-st border border-st-border p-0.5"
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className={size === "sm" ? "h-7 px-2.5 text-xs" : "h-7 px-3 text-[13px]"}>
          {o.icon}
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function Select({ id, value, options, onChange }) {
  return (
    <select id={id} className="st-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Kbd({ keys }) {
  return (
    <span className="st-kbd-group">
      {keys.map((k) => (
        <kbd key={k} className="st-kbd">
          {k}
        </kbd>
      ))}
    </span>
  );
}
