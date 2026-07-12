// Re-exports Mol* Viewer (drop-in for the CDN build) PLUS the selection/query API the
// CDN viewer build omits, so the site can build a residue Loci and focus it (and later
// colour by selection). Bundled by esbuild to ../static/molstar.js (global `molstar`).
export { Viewer } from 'molstar/lib/apps/viewer/app';
export { MolScriptBuilder as MS } from 'molstar/lib/mol-script/language/builder';
export { Script } from 'molstar/lib/mol-script/script';
export { StructureSelection } from 'molstar/lib/mol-model/structure/query';
export { StructureElement } from 'molstar/lib/mol-model/structure';
