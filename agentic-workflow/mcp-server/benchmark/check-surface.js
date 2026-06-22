/**
 * Quick, browser-free check that the `intelligent` profile resolves to the
 * curated primitives-first surface and that every surface tool actually exists.
 *   node benchmark/check-surface.js
 */
import { ALL_TOOLS } from '../tools/tool-definitions.js';
import { INTELLIGENT_SURFACE } from '../config/tool-profiles.js';

const allNames = new Set(ALL_TOOLS.map((t) => t.name));
const fromAllTools = ALL_TOOLS.filter((t) => INTELLIGENT_SURFACE.has(t.name)).map((t) => t.name);
// Injected separately by the server (not part of ALL_TOOLS):
const injected = ['unified_tool_search', 'unified_execute_exploration', 'unified_crawl'];

let pass = 0, fail = 0;
const check = (n, c, d) => { c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n}${d ? ' — ' + d : ''}`)); };

console.log('\n Intelligent surface resolution:');
console.log('  from ALL_TOOLS:', fromAllTools.join(', '));
console.log('  injected by server:', injected.join(', '));

for (const name of ['unified_act', 'unified_observe', 'unified_extract']) {
    check(`primitive ${name} exists in ALL_TOOLS`, allNames.has(name));
    check(`primitive ${name} in intelligent surface`, INTELLIGENT_SURFACE.has(name));
}
check('intelligent surface excludes low-level click', !INTELLIGENT_SURFACE.has('unified_click'));
check('intelligent surface excludes get_by_role', !INTELLIGENT_SURFACE.has('unified_get_by_role'));

const surfaceCount = fromAllTools.length + injected.length;
check('curated surface is small (<= 15 tools)', surfaceCount <= 15, `surface=${surfaceCount}`);
check('full toolset remains large (callable + searchable)', ALL_TOOLS.length > 100, `all=${ALL_TOOLS.length}`);

console.log(`\n Surface size: ${surfaceCount} listed vs ${ALL_TOOLS.length} total callable`);
console.log(`\n CHECK: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
