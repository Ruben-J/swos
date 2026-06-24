import { PITCH, clamp, type Vec2 } from "@pitch/shared";

export interface CameraView {
  /** Middelpunt van de camera in pitch units. */
  center: Vec2;
  zoom: number;
}

/**
 * Zachte balvolgende camera met dead-zone en look-ahead. Volgt de bal (niet de
 * actieve speler) zodat passing lanes leesbaar blijven; schokt niet bij rebounds.
 */
export class Camera {
  center: Vec2;
  zoom = 1;
  private viewW: number;
  private viewH: number;

  constructor(viewWidthUnits: number, viewHeightUnits: number) {
    this.viewW = viewWidthUnits;
    this.viewH = viewHeightUnits;
    this.center = { x: PITCH.width / 2, y: PITCH.height / 2 };
  }

  setViewSize(wUnits: number, hUnits: number): void {
    this.viewW = wUnits;
    this.viewH = hUnits;
  }

  /** Werk de camera bij richting bal-positie met look-ahead op balsnelheid. */
  follow(ball: Vec2, ballVel: Vec2, dt: number): void {
    const lookAhead = 0.35;
    const target: Vec2 = {
      x: ball.x + clamp(ballVel.x * lookAhead, -8, 8),
      y: ball.y + clamp(ballVel.y * lookAhead, -5, 5),
    };

    // Dead-zone: pas bewegen als de bal te ver van het centrum staat.
    const deadX = this.viewW * 0.12;
    const deadY = this.viewH * 0.12;
    const dx = target.x - this.center.x;
    const dy = target.y - this.center.y;
    let desiredX = this.center.x;
    let desiredY = this.center.y;
    if (Math.abs(dx) > deadX) desiredX = target.x - Math.sign(dx) * deadX;
    if (Math.abs(dy) > deadY) desiredY = target.y - Math.sign(dy) * deadY;

    // Zachte smoothing.
    const k = Math.min(1, dt * 5);
    this.center.x += (desiredX - this.center.x) * k;
    this.center.y += (desiredY - this.center.y) * k;

    this.clampToPitch();
  }

  private clampToPitch(): void {
    const halfW = this.viewW / 2;
    const halfH = this.viewH / 2;
    // Ruimere overscan voorbij de doel-/zijlijnen, zodat de camera bij een doel/
    // hoek verder doorschuift en er een groter deel van de tribune in beeld komt.
    const over = 15;
    const minX = -over + halfW;
    const maxX = PITCH.width + over - halfW;
    const minY = -over + halfH;
    const maxY = PITCH.height + over - halfH;
    this.center.x = minX <= maxX ? clamp(this.center.x, minX, maxX) : PITCH.width / 2;
    this.center.y = minY <= maxY ? clamp(this.center.y, minY, maxY) : PITCH.height / 2;
  }

  view(): CameraView {
    return { center: { ...this.center }, zoom: this.zoom };
  }
}
