const depotId = process.argv[2];
let depotKey = process.argv[3];
const installDir = process.argv[4];
if (!depotId || !depotKey || !installDir) {
	console.log("Syntax: node populate-chunks.js <depot id> <depot key> <install dir>");
	process.exit(1);
}
depotKey = Buffer.from(depotKey, "hex");
const { populateChunks } = require(".");
populateChunks(depotId, depotKey, installDir);
