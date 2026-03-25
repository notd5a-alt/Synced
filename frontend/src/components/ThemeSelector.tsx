import { themes } from "../hooks/useTheme";

interface ThemeSelectorProps {
  currentTheme: string;
  onSelect: (id: string) => void;
}

export default function ThemeSelector({ currentTheme, onSelect }: ThemeSelectorProps) {
  return (
    <div className="theme-selector">
      <span className="theme-label">THEME</span>
      <div className="theme-options">
        {themes.map((t) => (
          <button
            key={t.id}
            className={`theme-swatch ${currentTheme === t.id ? "active" : ""}`}
            onClick={() => onSelect(t.id)}
            title={t.name}
          >
            <span
              className="swatch-color"
              style={{
                background: t.vars["--bg"],
                borderColor: t.vars["--text"],
                color: t.vars["--text"],
              }}
            />
            <span className="swatch-name">{t.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
