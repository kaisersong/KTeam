import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeA2uiMessages, validateA2uiMessages } from '../runtime-core/src/a2ui/decoder.js';
import { validateLegacyA2uiMessages } from '../runtime-core/src/a2ui/validator.js';

const SURFACE = 'a2ui-task1-tool1';

const textComponents = [
  { id: 'root', component: 'Column' as const, children: ['t1'] },
  { id: 't1', component: 'Text' as const, text: 'hello', variant: 'body' as const },
];

function legacyMessages(version: 1 | '1.0' = 1) {
  return [
    { version, createSurface: { surfaceId: SURFACE, catalogId: 'xiaok-safe', root: 'root' } },
    { version, updateComponents: { surfaceId: SURFACE, components: textComponents } },
    { version, updateDataModel: { surfaceId: SURFACE, path: '', value: {} } },
  ];
}

function v1Messages() {
  return [
    { version: '1.0' as const, createSurface: { surfaceId: SURFACE, catalogId: 'xiaok-safe/1.0' } },
    { version: '1.0' as const, updateComponents: { surfaceId: SURFACE, components: textComponents } },
    { version: '1.0' as const, updateDataModel: { surfaceId: SURFACE, path: '/', value: {} } },
  ];
}

function assertRejected(input: unknown) {
  const result = validateA2uiMessages(input);
  assert.equal(result.ok, false);
  assert.equal(result.ok ? '' : result.reason, '未知协议版本');
}

test('numeric 1 passes', () => {
  const messages = legacyMessages(1);
  assert.equal(validateA2uiMessages(messages).ok, true);
  assert.equal(validateLegacyA2uiMessages(messages).ok, true);
  assert.equal(normalizeA2uiMessages(messages).length, 3);
});

test('string "1.0" passes', () => {
  const messages = v1Messages();
  assert.equal(validateA2uiMessages(messages).ok, true);
  const normalized = normalizeA2uiMessages(messages);
  assert.ok(normalized.length >= 2);
  assert.equal(validateLegacyA2uiMessages(legacyMessages('1.0')).ok, true);
});

test('unknown versions are rejected with 未知协议版本', () => {
  for (const version of ['2.0', '1', 1.1] as const) {
    assertRejected(v1Messages().map((message) => ({ ...message, version })));
    assertRejected(legacyMessages(1).map((message) => ({ ...message, version })));
    const legacy = validateLegacyA2uiMessages(legacyMessages(1).map((message) => ({ ...message, version })));
    assert.equal(legacy.ok, false);
    assert.equal(legacy.ok ? '' : legacy.reason, '未知协议版本');
  }
  assertRejected(v1Messages().map(({ version: _version, ...rest }) => rest));
});

test('deleteSurface is accepted under "1.0" and clears the surface', () => {
  const messages = [...v1Messages(), { version: '1.0' as const, deleteSurface: { surfaceId: SURFACE } }];
  assert.equal(validateA2uiMessages(messages).ok, true);
  assert.deepEqual(normalizeA2uiMessages(messages), []);
});

test('destroySurface is still accepted and clears the surface', () => {
  const legacy = [...legacyMessages(1), { version: 1 as const, destroySurface: { surfaceId: SURFACE } }];
  assert.equal(validateLegacyA2uiMessages(legacy).ok, true);
  assert.equal(validateA2uiMessages(legacy).ok, true);
  assert.deepEqual(normalizeA2uiMessages(legacy), []);

  const v1 = [...v1Messages(), { version: '1.0' as const, destroySurface: { surfaceId: SURFACE } }];
  assert.equal(validateA2uiMessages(v1).ok, true);
  assert.deepEqual(normalizeA2uiMessages(v1), []);
});
