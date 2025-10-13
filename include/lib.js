const crypto = require("crypto");
const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");
const AdmZip = require("adm-zip");
const CdnCompression = require("steam-user/components/cdn_compression");
const ContentManifest = require("steam-user/components/content_manifest");
const SteamCrypto = require("@doctormckay/steam-crypto");

const DEFAULT_HOSTS = [
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

const sha1 = (data) => crypto.createHash("sha1").update(data).digest("hex");

const sha1file = async (file) => {
	const st = crypto.createHash("sha1");
	const readStream = fs.createReadStream(file, { highWaterMark: 1048576 });
	for await (const chunk of readStream) {
		st.update(chunk);
	}
	return st.digest("hex");
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const compress = (buf) => {
	const zip = new AdmZip();
	zip.addFile("z", buf);
	return zip.toBuffer();
};

// https://stackoverflow.com/a/45130990
const getFiles = async (dir) => {
	const dirents = await fsPromises.readdir(dir, { withFileTypes: true });
	const files = await Promise.all(dirents.map((dirent) => {
		const res = path.resolve(dir, dirent.name);
		return dirent.isDirectory() ? getFiles(res) : res;
	}));
	return Array.prototype.concat(...files);
};

const getChunk = async (depotId, depotKey, hash) => {
	while (true) {
		try {
			let data = await fsPromises.readFile(`depot/${depotId}/chunk/${hash}`);
			data = SteamCrypto.symmetricDecrypt(data, depotKey);
			data = await CdnCompression.unzip(data);
			if (sha1(data) != hash) {
				throw new Error(`depot/${depotId}/chunk/${hash} does not match the expected hash`);
			}
			return data;
		} catch (e) {
			if (e.code == "ENOENT") {
				throw new Error(`depot/${depotId}/chunk/${hash} is missing`);
			}
			if (e.code != "EMFILE") {
				//console.log(`Error reading depot/${depotId}/chunk/${hash}`);
				throw e;
			}
			await sleep(500);
		}
	}
};

module.exports = {
	DEFAULT_HOSTS,
	sha1,
	sha1file,
	compress,
	getFiles,
	getChunk,
	populateChunks: async (manifest, depotKey, installDir, onProgress) => {
		if (manifest.filenames_encrypted) {
			ContentManifest.decryptFilenames(manifest, depotKey);
		}
		fs.mkdirSync(`depot/${manifest.depot_id}/chunk`, { recursive: true });
		let file_i = 0;
		for (const file of manifest.files) {
			if (file.flags & 64) {
				continue;
			}
			if (fs.existsSync(path.join(installDir, file.filename))) {
				const readSteam = await fsPromises.open(path.join(installDir, file.filename), "r");
				let chunk_i = 0;
				for (const chunk of file.chunks) {
					if (!fs.existsSync(`depot/${manifest.depot_id}/chunk/${chunk.sha}`)) {
						let chunkBuf = Buffer.alloc(chunk.cb_original);
						const { bytesRead } = await readSteam.read(chunkBuf, 0, chunk.cb_original, parseInt(chunk.offset));
						if (bytesRead != chunk.cb_original) {
							break;
						}
						if (sha1(chunkBuf) == chunk.sha) {
							chunkBuf = compress(chunkBuf);
							chunkBuf = SteamCrypto.symmetricEncrypt(chunkBuf, depotKey);
							await fsPromises.writeFile(`depot/${manifest.depot_id}/chunk/${chunk.sha}`, chunkBuf);
							if (onProgress) {
								onProgress(file.filename, file_i, manifest.files.length, chunk_i++, file.chunks.length);
							}
						}
					}
				}
				await readSteam.close();
			}
			++file_i;
		}
	},
	downloadChunks: (manifest, onStartDownloading, onStartDownload, onFinishDownload, onErroredDownload, hosts) => {
		hosts ??= DEFAULT_HOSTS;
		return new Promise(resolve => {
			fs.mkdirSync(`depot/${manifest.depot_id}/chunk`, { recursive: true });
			const toDownload = {};
			for (const file of manifest.files) {
				for (const chunk of file.chunks) {
					if (!fs.existsSync(`depot/${manifest.depot_id}/chunk/${chunk.sha}`)) {
						toDownload[`depot/${manifest.depot_id}/chunk/${chunk.sha}`] = true;
					}
				}
			}
			let remaining_chunks = Object.keys(toDownload).length;
			if (onStartDownloading) {
				onStartDownloading(remaining_chunks);
			}
			if (remaining_chunks == 0) {
				resolve();
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
					if (onStartDownload) {
						onStartDownload(path, host);
					}
					fetch(`${host}/${path}`).then(async res => {
						if (onFinishDownload) {
							onFinishDownload(path, res.status, host);
						}
						if (res.status == 200) {
							const ab = await res.arrayBuffer();
							await fsPromises.writeFile(path, Buffer.from(ab));
							if (--remaining_chunks == 0) {
								resolve();
							}
						}
						else {
							toDownload[path] = true;
						}
					}).catch(err => {
						if (onErroredDownload) {
							onErroredDownload(path, err);
						}
						toDownload[path] = true;
					}).finally(() => {
						--running;
						loop();
					});
				}
			};
			loop();
		});
	},
	install: async (manifest, depotKey, installDir, onFileWritten) => {
		ContentManifest.decryptFilenames(manifest, depotKey);
		installDir ??= `install/${manifest.depot_id}/${manifest.gid_manifest}`;
		fs.mkdirSync(installDir, { recursive: true });
		for (const file of manifest.files) {
			if (file.flags & 64) {
				continue;
			}
			const exists = fs.existsSync(path.join(installDir, file.filename));
			if (!exists || await sha1file(path.join(installDir, file.filename)) != file.sha_content) {
				for (const chunk of file.chunks) {
					chunk.offset = parseInt(chunk.offset);
				}
				file.chunks.sort((a, b) => a.offset - b.offset);

				const chunkPromises = [];
				for (const chunk of file.chunks) {
					chunkPromises.push(getChunk(manifest.depot_id, depotKey, chunk.sha));
				}
				const chunks = await Promise.all(chunkPromises);
				const data = Buffer.concat(chunks);
				await fsPromises.mkdir(path.dirname(path.join(installDir, file.filename)), { recursive: true });
				await fsPromises.writeFile(path.join(installDir, file.filename), data);
				if (onFileWritten) {
					onFileWritten(file.filename, exists);
				}
			}
		}
	},
};
