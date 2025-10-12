const manifestFile = process.argv[2];
const installDir = process.argv[3];
let depotKey = process.argv[4];
if (!manifestFile || !installDir) {
	console.log("Syntax: node populate-chunks.js <manifest file> <install dir> [depot key]");
	process.exit(1);
}
(async () => {
	const fs = require("fs");
	const ContentManifest = require("steam-user/components/content_manifest");
	const manifest = ContentManifest.parse(fs.readFileSync(manifestFile));
	if (!depotKey) {
		depotKey = await require("./include/fetch-depot-key.js")(manifest.depot_id);
	}
	depotKey = Buffer.from(depotKey, "hex");
	const { populateChunks } = require(".");
	await populateChunks(manifest, depotKey, installDir, (file, file_i, num_files, chunk_i, num_chunks) => {
		if (chunk_i == 0) {
			console.log(`Processing ${file}...`);
		}
	});
})();
