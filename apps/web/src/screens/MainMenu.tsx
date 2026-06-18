interface Props {
  onQuickMatch: () => void;
  onLocalVersus: () => void;
  onCareer: () => void;
  onLoadCareer: () => void;
}

export function MainMenu({ onQuickMatch, onLocalVersus, onCareer, onLoadCareer }: Props) {
  return (
    <div className="menu">
      <div>
        <h1>PITCH LEGEND</h1>
        <p className="tagline">Top-down arcadevoetbal &mdash; vertical slice</p>
      </div>
      <div className="menu-buttons">
        <button className="btn primary" onClick={onQuickMatch}>
          Snelle wedstrijd
        </button>
        <button className="btn" onClick={onLocalVersus}>
          Lokaal 1v1
        </button>
        <button className="btn" onClick={onCareer}>
          Carrièremodus
        </button>
        <button className="btn" onClick={onLoadCareer}>
          Carrière laden
        </button>
        <button className="btn" disabled title="Komt in een latere fase">
          Opties
        </button>
      </div>
    </div>
  );
}
