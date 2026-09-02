export interface TelemetryEvent {
  name: string;
  time: string;
  properties: Record<string, string | number | boolean>;
}

export class Telemetry {
  private readonly events: TelemetryEvent[] = [];

  public track(name: string, properties: Record<string, string | number | boolean>): void {
    this.events.push({
      name,
      time: new Date().toISOString(),
      properties
    });
  }

  public recent(limit = 200): TelemetryEvent[] {
    return this.events.slice(-limit).reverse();
  }
}
