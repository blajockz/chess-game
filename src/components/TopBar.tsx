import "./TopBar.css";
import ThemePicker from "./ThemePicker";
import type { ThemeId } from "../theme/themes";

type Mode = "default" | "sim";

type Props = {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  soundOn: boolean;
  onSoundToggle: () => void;
  control: string;
  onNewGame: () => void;
  theme: ThemeId;
  onThemeChange: (id: ThemeId) => void;
};

export default function TopBar({
  mode,
  onModeChange,
  soundOn,
  onSoundToggle,
  control,
  onNewGame,
  theme,
  onThemeChange,
}: Props) {
  return (
    <header className="topbar">
      <div className="identity">
        <img className="mark" src="/favicon.svg?v=2" alt="" width={34} height={34} />
        <span className="wordmark">Chess</span>
      </div>

      <div className="modes" role="group" aria-label="Game mode">
        <button
          className={mode === "default" ? "mode is-on" : "mode"}
          onClick={() => onModeChange("default")}
        >
          Default
        </button>
        <button className="mode" disabled title="Not built yet">
          Real-life sim
        </button>
      </div>

      <div className="actions">
        <span className="chip">{control}</span>
        <ThemePicker theme={theme} onChange={onThemeChange} />
        <button
          className="icon-btn"
          onClick={onSoundToggle}
          aria-pressed={soundOn}
          title={soundOn ? "Mute sound" : "Unmute sound"}
        >
          {soundOn ? "🔊" : "🔇"}
        </button>
        <button className="btn" onClick={onNewGame}>
          New game
        </button>
      </div>
    </header>
  );
}