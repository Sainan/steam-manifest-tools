const depotId = process.argv[2];
const manifestId = process.argv[3];
if (!depotId || !manifestId) {
	console.log("Syntax: node download-manifest.js <depot id> <manifest id>");
	process.exit(1);
}

const fsPromises = require("fs/promises");
const { fetchManifest }  = require(".");

(async () => {
	const ab = await fetchManifest(depotId, manifestId);
	if (ab) {
		await fsPromises.writeFile(`${depotId}_${manifestId}.manifest`, Buffer.from(ab));
		console.log(`Saved in ${depotId}_${manifestId}.manifest`);
		process.exit(0);
	}
	else {
		console.log(`Could not find the given manifest. Double-check with https://steamdb.info/depot/${depotId}/manifests/ and report an issue in https://github.com/Sainan/k25FCdfEOoEJ42S6/issues if you're sure the manifest exists.`);
		process.exit(1);
	}
})();
