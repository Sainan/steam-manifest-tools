const fs = require("fs");
const ContentManifest = require("steam-user/components/content_manifest");

const file = process.argv[2];
const depotKey = process.argv[3];
if (!file) {
	console.log("Syntax: node to-json.js <manifest file> [depot key]");
	process.exit(1);
}

const buf = fs.readFileSync(file);
const manifest = ContentManifest.parse(buf);
if (manifest.filenames_encrypted) {
	if (depotKey) {
		ContentManifest.decryptFilenames(manifest, Buffer.from(depotKey, "hex")); // Sets filenames_encrypted to false
		//manifest.filenames_decrypted = true; // Indicate that this transformation took place in the JSON export // Kinda pointless because some .manifest files are already decrypted by their sources
	} else {
		console.log("Manifest has encrypted filenames, suggest supplying depot key");
	}

}
fs.writeFileSync(file + ".json", JSON.stringify(manifest, null, 2));
