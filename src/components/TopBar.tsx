import "./TopBar.css";
import ThemePicker from "./ThemePicker";
import type { ThemeId } from "../theme/themes";

type Mode = "default" | "sim";

type Props = {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  simAvailable?: boolean;
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
  simAvailable = true,
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
        <img className="mark" src="/favicon.svg" alt="" width={34} height={34} />
        <span className="wordmark">Tempo</span>
      </div>

      <div className="modes" role="group" aria-label="Game mode">
        <button
          className={mode === "default" ? "mode is-on" : "mode"}
          onClick={() => onModeChange("default")}
        >
          Default
        </button>
        <button
          className={mode === "sim" ? "mode is-on" : "mode"}
          onClick={() => onModeChange("sim")}
          disabled={!simAvailable}
          title={simAvailable ? "Play on a 3D board" : "This browser can't show 3D graphics"}
        >
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