import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyEventDate, extractEntryFee, makeDateRange } from '../src/parsing.js';

test('classifies English Facebook-style event date', () => {
  const dates = makeDateRange('2026-05-01', '2026-05-02');
  const result = classifyEventDate('Friday, May 1, 2026 at 8:00 PM', dates);

  assert.equal(result.iso, '2026-05-01');
});

test('classifies Hungarian Facebook-style event date', () => {
  const dates = makeDateRange('2026-05-01', '2026-05-02');
  const result = classifyEventDate('2026. május 2., szombat, 20:00', dates);

  assert.equal(result.iso, '2026-05-02');
});

test('extracts HUF entry fee', () => {
  const result = extractEntryFee('Jegyek elővételben: 2 500 Ft\nHelyszínen: 3 000 Ft');

  assert.equal(result.value, '2 500 Ft');
  assert.equal(result.confidence, 'high');
});

test('extracts compact slash-separated HUF entry fee', () => {
  const result = extractEntryFee('Jegyek: 2000/2500/3000 Ft');

  assert.equal(result.value, '2000/2500/3000 Ft');
  assert.equal(result.confidence, 'high');
});

test('extracts free admission', () => {
  const result = extractEntryFee('A belépés ingyenes.');

  assert.equal(result.value, 'Ingyenes');
  assert.equal(result.confidence, 'high');
});

test('does not treat Free Speech as free admission', () => {
  const result = extractEntryFee('Underground Slam Academy, Free Speech and Censorship around the Globe');

  assert.equal(result.value, '?');
  assert.equal(result.confidence, 'unknown');
});
