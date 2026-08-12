// Structured JSON logging, kept in two channels so operational noise
// (connections, room lifecycle) can be filtered out from game-event logs
// when M3's log collection milestone comes to consume these.
type LogChannel = 'operational' | 'game-event';

function log(channel: LogChannel, event: string, data: Record<string, unknown>): void {
  const line = JSON.stringify({ channel, event, timestamp: new Date().toISOString(), ...data });
  process.stdout.write(`${line}\n`);
}

export function logOperational(event: string, data: Record<string, unknown> = {}): void {
  log('operational', event, data);
}

export function logGameEvent(event: string, data: Record<string, unknown> = {}): void {
  log('game-event', event, data);
}
