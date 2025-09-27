const depotId = process.argv[2];
const manifestId = process.argv[3];
if (!depotId || !manifestId) {
	console.log("Syntax: node download-manifest.js <depot id> <manifest id>");
	process.exit(1);
}

const fsPromises = require("fs/promises");

const forkers = [
	"qwe213312",
	"mejikuhibiniu1",
	"Sainan",
	"FreakyObservatory",
];
(async () => {
	let i = 0;
	for (const forker of forkers) {
		const res = await fetch(`https://raw.githubusercontent.com/${forker}/k25FCdfEOoEJ42S6/refs/heads/main/${depotId}_${manifestId}.manifest`);
		if (res.status == 200) {
			const ab = await res.arrayBuffer();
			await fsPromises.writeFile(`${depotId}_${manifestId}.manifest`, Buffer.from(ab));
			console.log(`Saved in ${depotId}_${manifestId}.manifest`);
			return;
		}
	}
	console.log(`Could not find the given manifest. Double-check with https://steamdb.info/depot/${depotId}/manifests/ and report an issue in https://github.com/Sainan/k25FCdfEOoEJ42S6/issues if you're sure the manifest exists.`);
})();
