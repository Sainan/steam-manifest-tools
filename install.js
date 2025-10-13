const manifestFile = process.argv[2];
let depotKey = process.argv[3];
if (!manifestFile) {
	console.log("Syntax: node install.js <manifest file> [depot key]");
	process.exit(1);
}

const fs = require("fs");
const ContentManifest = require("steam-user/components/content_manifest");
const { install }  = require(".");

(async () => {
	const manifest = ContentManifest.parse(fs.readFileSync(manifestFile));
	if (!depotKey) {
		depotKey = await require("./include/fetch-depot-key.js")(manifest.depot_id);
	}
	depotKey = Buffer.from(depotKey, "hex");
	await install(manifest, depotKey, undefined, (file, existed) => {
		console.log(`${existed ? "Repaired" : "Created"} ${file}`);
	});
})();
