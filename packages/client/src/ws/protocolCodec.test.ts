import { describe, expect, it } from 'vitest';
import { parseServerMessage } from './protocolCodec';

describe('parseServerMessage', () => {
  it('parses a valid ROOM_JOINED message', () => {
    const msg = parseServerMessage(
      JSON.stringify({ type: 'ROOM_JOINED', roomCode: 'ABC123', seat: 1, reconnectToken: 'tok' }),
    );
    expect(msg).toEqual({ type: 'ROOM_JOINED', roomCode: 'ABC123', seat: 1, reconnectToken: 'tok' });
  });

  it('parses a valid ERROR message', () => {
    const msg = parseServerMessage(JSON.stringify({ type: 'ERROR', message: 'nope' }));
    expect(msg).toEqual({ type: 'ERROR', message: 'nope' });
  });

  it('returns null for invalid JSON', () => {
    expect(parseServerMessage('{not json')).toBeNull();
  });

  it('returns null for a JSON value that is not an object', () => {
    expect(parseServerMessage('"hello"')).toBeNull();
    expect(parseServerMessage('42')).toBeNull();
    expect(parseServerMessage('null')).toBeNull();
  });

  it('returns null for an object missing type', () => {
    expect(parseServerMessage(JSON.stringify({ foo: 'bar' }))).toBeNull();
  });

  it('returns null for an unrecognized type', () => {
    expect(parseServerMessage(JSON.stringify({ type: 'SOMETHING_ELSE' }))).toBeNull();
  });
});
