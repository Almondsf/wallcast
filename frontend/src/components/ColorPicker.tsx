import { useEffect, useMemo, useRef, useState } from "react";
import type { PaintColor } from "../types";

interface Props {
  label: string;
  colors: PaintColor[];
  value: number | "";
  onChange: (id: number | "") => void;
  disabled?: boolean;
  /** Shows a clear button, for the optional second colour. */
  allowClear?: boolean;
  placeholder?: string;
}

function matches(color: PaintColor, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  // Hex is matched with the # optional so "2c5f" and "#2c5f" both work. The
  // manufacturer code is matched the same way, since Berger's own codes contain
  // hyphens people leave out ("nfr06" should still find NF-R06).
  const hex = color.hex_code.toLowerCase();
  const code = (color.code ?? "").toLowerCase();
  const loose = q.replace(/[-\s#]/g, "");
  return (
    color.name.toLowerCase().includes(q) ||
    color.brand.toLowerCase().includes(q) ||
    (color.finish ?? "").toLowerCase().includes(q) ||
    code.includes(q) ||
    (loose.length > 0 && code.replace(/-/g, "").includes(loose)) ||
    hex.includes(q) ||
    hex.replace("#", "").includes(loose)
  );
}

export default function ColorPicker({
  label,
  colors,
  value,
  onChange,
  disabled,
  allowClear,
  placeholder = "Search colors…",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = useMemo(
    () => colors.find((c) => c.id === value) ?? null,
    [colors, value],
  );

  const filtered = useMemo(
    () => colors.filter((c) => matches(c, query)),
    [colors, query],
  );

  // Close when focus or a click lands outside the whole control.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Keep the highlighted row in view during keyboard navigation.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({
      block: "nearest",
    });
  }, [highlight, open]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function pick(color: PaintColor) {
    onChange(color.id);
    close();
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = e.key === "ArrowDown" ? 1 : -1;
      setHighlight((h) => {
        if (filtered.length === 0) return 0;
        return (h + step + filtered.length) % filtered.length;
      });
      return;
    }
    if (e.key === "Enter") {
      if (open && filtered[highlight]) {
        e.preventDefault();
        pick(filtered[highlight]);
      }
      return;
    }
    if (e.key === "Escape") {
      close();
      inputRef.current?.blur();
    }
  }

  return (
    <div className="color-picker" ref={rootRef}>
      <span className="color-picker-label">{label}</span>

      <div className={`color-picker-control${disabled ? " disabled" : ""}`}>
        {selected && !open && (
          <span className="swatch" style={{ background: selected.hex_code }} aria-hidden="true" />
        )}

        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          disabled={disabled}
          placeholder={selected && !open ? undefined : placeholder}
          value={
            open
              ? query
              : selected
                ? `${selected.name}${selected.code ? ` · ${selected.code}` : ""}`
                : ""
          }
          onFocus={() => {
            setOpen(true);
            setHighlight(0);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onKeyDown={handleKeyDown}
        />

        {allowClear && value !== "" && !disabled && (
          <button
            type="button"
            className="color-picker-clear"
            title="Clear"
            onClick={() => {
              onChange("");
              close();
            }}
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <ul className="color-picker-list" ref={listRef} role="listbox">
          {filtered.length === 0 && <li className="color-picker-empty">No colors match “{query}”</li>}
          {filtered.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={c.id === value}
              data-active={i === highlight}
              className={`color-picker-option${i === highlight ? " active" : ""}`}
              // pointerdown rather than click: the outside-click handler fires on
              // pointerdown, which would close the list before a click could land.
              onPointerDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              <span className="swatch" style={{ background: c.hex_code }} aria-hidden="true" />
              <span className="color-picker-name">{c.name}</span>
              <span className="color-picker-hex">{c.hex_code}</span>
              <span className="color-picker-meta">
                {c.code ? `${c.code} · ` : ""}
                {c.brand}
                {c.finish ? ` · ${c.finish}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
