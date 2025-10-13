const fs = require("fs");
const path = require("path");
const ContentManifest = require("steam-user/components/content_manifest");

const file = process.argv[2];
let depotKey = process.argv[3];
if (!file) {
	console.log("Syntax: node to-hashdeep-auditfile.js <manifest file> [depot key]");
	process.exit(1);
}

(async () => {
	const buf = fs.readFileSync(file);
	const manifest = ContentManifest.parse(buf);
	if (manifest.filenames_encrypted) {
		if (!depotKey) {
			console.log("Manifest has encrypted filenames. A depot key will be needed.");
			const { fetchDepotKey } = require(".");
			depotKey = await fetchDepotKey(manifest.depot_id);
		}
		ContentManifest.decryptFilenames(manifest, Buffer.from(depotKey, "hex"));
	}

	const fh = fs.createWriteStream(`${file}.auditfile`);
	fh.write("%%%% HASHDEEP-1.0\n");
	fh.write("%%%% size,sha1,filename\n");
	for (const file of manifest.files) {
		if ((file.flags & 64) === 0) {
			fh.write(`${file.size},${file.sha_content},${manifest.gid_manifest}${path.sep}${path.sep != '\\' ? file.filename.split('\\').join(path.sep) : file.filename.split('/').join(path.sep)}\n`);
		}
	}
	fh.end();
})();
