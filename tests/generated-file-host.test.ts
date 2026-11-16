import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchesGeneratedFileHost} from '../src/runtime/generated-file-host.js';
test('installation receipt survives Bonjour renames; legacy configured name works while foreign identities remain denied',()=>{
 assert.equal(matchesGeneratedFileHost('installation:one','installation:one','Example-Mac-4.local'),true);
 assert.equal(matchesGeneratedFileHost('installation:other','installation:one','Example-Mac-4.local','Example Mac'),false);
 assert.equal(matchesGeneratedFileHost('Example-Mac.local','installation:one','Example-Mac-4.local','Example Mac'),true);
 assert.equal(matchesGeneratedFileHost('Other-Mac.local','installation:one','Example-Mac-4.local','Example Mac'),false);
 assert.equal(matchesGeneratedFileHost('Example-Mac-99.local','installation:one','Example-Mac-4.local','Example Mac'),false);
});
