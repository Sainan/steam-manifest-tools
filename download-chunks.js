let manifestFile = process.argv[2];
let lancache = (process.argv[3] == "--lancache");
if (manifestFile == "--lancache") {
	lancache = true;
	manifestFile = process.argv[3];
}
if (!manifestFile) {
	console.log("Syntax: node download-chunks.js <manifest file> [--lancache]");
	process.exit(1);
}

const fs = require("fs");
const ContentManifest = require("steam-user/components/content_manifest");
const { DEFAULT_HOSTS, downloadChunks } = require(".");

const hosts = lancache ? ["http://lancache.steamcontent.com"] : DEFAULT_HOSTS;

const manifest = ContentManifest.parse(fs.readFileSync(manifestFile));
downloadChunks(
	manifest,
	undefined /*(num_chunks) => {}*/,
	(path, host) => { console.log(`${path}: Downloading from ${host}`); },
	(path, status, host) => { console.log(`${path}: Got ${status/*} from ${host*/}`); },
	(path, err) => { console.log(`${path}: `, err); },
	hosts
).then(() => process.exit(0));
