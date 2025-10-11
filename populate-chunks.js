const depotId = process.argv[2];
const depotKey = process.argv[3];
const installDir = process.argv[4];
if (!depotId || !depotKey || !installDir) {
	console.log("Syntax: node populate-chunks.js <depot id> <depot key> <install dir>");
	process.exit(1);
}
const { populateChunks } = require(".");
populateChunks(depotId, depotKey, installDir);
