import {test} from 'node:test';
import {writeFileSync} from 'node:fs';
import {realUpstreams} from '../../dist/tests/helpers/real-upstreams.js';
test('fixture caller returns before its explicit cleanup',async()=>{const f=await realUpstreams();writeFileSync(process.env.KTEAM_FIXTURE_RECORD,JSON.stringify({root:f.root,url:f.upstream.options.kswarmUrl}));});
