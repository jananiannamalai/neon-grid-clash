import test from 'node:test';
import assert from 'node:assert/strict';
import { formatClock, initialBoard, remainingSeconds, winnerLabel } from '../src/game.js';

test('room board starts with 25 unclaimed tiles', () => {
  assert.equal(initialBoard().length, 25);
  assert.ok(initialBoard().every((tile) => tile === null));
});

test('timer display rounds remaining seconds up and clamps at zero', () => {
  assert.equal(remainingSeconds('2026-01-01T00:00:10Z', Date.parse('2026-01-01T00:00:09.5Z')), 1);
  assert.equal(remainingSeconds('2026-01-01T00:00:10Z', Date.parse('2026-01-01T00:00:11Z')), 0);
  assert.equal(formatClock(180), '03:00');
});

test('winner labels handle ties', () => {
  assert.equal(winnerLabel([{ name: 'Nova', score: 3 }, { name: 'Flux', score: 3 }]), 'Tie game · Nova & Flux');
});
