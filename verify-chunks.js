const depotId = process.argv[2];
let depotKey = process.argv[3];
if (!depotId) {
	console.log("Syntax: node verify-chunks.js <depot id> [depot key]");
	process.exit(1);
}

const { fetchDepotKey, verifyChunks } = require(".");
(async () => {
	if (!depotKey) {
		depotKey = await fetchDepotKey(depotId);
	}
	depotKey = Buffer.from(depotKey, "hex");
	console.log(`Verifying chunks...`);
	await verifyChunks(depotId, depotKey, (file, expectedHash) => {
		console.log(`Deleted ${file}`);
	});
})();
