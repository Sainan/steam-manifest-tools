const fs = require("fs");
const fsPromises = require("fs/promises");
const ContentManifest = require("steam-user/components/content_manifest");

const hosts = [
	"https://cache8-sto1.steamcontent.com",
	"https://cache6-sto1.steamcontent.com",
	"https://cache1-sto1.steamcontent.com",
	"https://cache2-sto1.steamcontent.com",
	"https://cache3-sto1.steamcontent.com",
	"https://cache7-sto1.steamcontent.com",
	"https://cache2-sto2.steamcontent.com",
	"https://cache6-sto2.steamcontent.com",
	"https://cache1-sto2.steamcontent.com",
	"https://cache9-sto1.steamcontent.com",
	"https://cache4-sto2.steamcontent.com",
	"https://cache4-sto1.steamcontent.com",
	"https://cache5-sto1.steamcontent.com",
	"https://cache3-sto2.steamcontent.com",
	"https://cache5-sto2.steamcontent.com",
	"http://alibaba.cdn.steampipe.steamcontent.com",
	"http://edgenext.cdn.steampipe.steamcontent.com",
	"https://steampipe.akamaized.net",
	"https://fastly.cdn.steampipe.steamcontent.com",
	"https://google2.cdn.steampipe.steamcontent.com",
];

const manifestFile = process.argv[2];
if (!manifestFile) {
	console.log("Syntax: node download-chunks.js <manifest file>");
	process.exit(1);
}
const data = fs.readFileSync(manifestFile);
const manifest = ContentManifest.parse(data);
fs.mkdirSync(`depot/${manifest.depot_id}/chunk`, { recursive: true });
const toDownload = {};
for (const file of manifest.files) {
	for (const chunk of file.chunks) {
		if (!fs.existsSync(`depot/${manifest.depot_id}/chunk/${chunk.sha}`)) {
			toDownload[`depot/${manifest.depot_id}/chunk/${chunk.sha}`] = true;
		}
	}
}
let /*host_i = 0,*/ running = 0;
const loop = () => {
	while (running < 4) {
		const path = Object.keys(toDownload)[0];
		if (!path) {
			break;
		}
		++running;
		delete toDownload[path];
		const host = hosts[Math.floor(Math.random()*hosts.length)];
		//const host = hosts[host_i]; host_i = (host_i + 1) % hosts.length;
		console.log(`${path}: Downloading from ${host}`);
		fetch(`${host}/${path}`).then(async res => {
			console.log(`${path}: Got ${res.status/*} from ${host*/}`);
			if (res.status == 200) {
				const ab = await res.arrayBuffer();
				await fsPromises.writeFile(path, Buffer.from(ab));
			}
			else {
				toDownload[path] = true;
			}
		}).catch(err => {
			console.log(`${path}: `, err);
			toDownload[path] = true;
		}).finally(() => {
			--running;
			loop();
		});
	}
};
loop();
