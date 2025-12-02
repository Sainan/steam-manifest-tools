const crypto = require("node:crypto");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const worker_threads = require("node:worker_threads");
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

const workers = [];

const getAvailableWorker = () => {
	const w = workers.find(x => !x.busy);
	if (w) {
		//console.log(`Found an idle worker`);
		w.busy = true;
		return Promise.resolve(w);
	}
	if (workers.length < 8) {
		//console.log(`Creating a new worker`);
		const w = {
			inst: new worker_threads.Worker(__filename),
			busy: true,
		}
		w.inst.on("message", (x) => {
			w.busy = false;
			w.resolve(x);
		});
		w.inst.on("error", (x) => {
			w.busy = false;
			w.reject(x);
		});
		w.inst.on("exit", (code) => {
			console.log(`Worker exited with code ${code}`);
			workers.splice(workers.indexOf(w), 1);
		});
		workers.push(w);
		return Promise.resolve(w);
	}
	//console.log("All workers busy, waiting");
	return new Promise(resolve => {
		let i;
		i = setInterval(() => {
			const w = workers.find(x => !x.busy);
			if (w) {
				w.busy = true;
				clearInterval(i);
				resolve(w);
			}
		}, 4);
	});
};

const doJobInWorker = (job) => {
	return new Promise((resolve, reject) => {
		getAvailableWorker().then((w) => {
			w.resolve = resolve;
			w.reject = reject;
			w.inst.postMessage(job);
		});
	});
};

if (!worker_threads.isMainThread) {
	worker_threads.parentPort.on("message", (job) => {
		if ("getChunk" in job) {
			(async () => {
				const [ depotId, depotKey, hash ] = job.getChunk;
				try {
					let data = await getFileContents(`depot/${depotId}/chunk/${hash}`);
					data = SteamCrypto.symmetricDecrypt(data, depotKey);
					data = await CdnCompression.unzip(data);
					if (sha1(data) != hash) {
						throw new Error(`depot/${depotId}/chunk/${hash} does not match the expected hash`);
					}
					worker_threads.parentPort.postMessage(data);
				}
				catch (e) {
					if (e.code == "ENOENT") {
						throw new Error(`depot/${depotId}/chunk/${hash} is missing`);
					}
					throw e;
				}
			})();
		}
	});
}

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

const getFileContents = async (file) => {
	while (true) {
		try {
			return await fsPromises.readFile(file);
		}
		catch (e) {
			if (e.code != "EMFILE") {
				//console.log(`Error reading ${file}`);
				throw e;
			}
			await sleep(500);
		}
	}
};

const getChunk = (depotId, depotKey, hash) => {
	return doJobInWorker({
		getChunk: [ depotId, depotKey, hash ]
	});
};

const downloadChunks = (manifest, onStartDownloading, onStartDownload, onFinishDownload, onErroredDownload, hosts) => {
	hosts ??= DEFAULT_HOSTS;
	return new Promise(resolve => {
		fs.mkdirSync(`depot/${manifest.depot_id}/chunk`, { recursive: true });
		const toDownload = {};
		const alreadyDownloaded = [];
		for (const file of manifest.files) {
			for (const chunk of file.chunks) {
				if (fs.existsSync(`depot/${manifest.depot_id}/chunk/${chunk.sha}`)) {
					alreadyDownloaded.push(`depot/${manifest.depot_id}/chunk/${chunk.sha}`);
				}
				else {
					toDownload[`depot/${manifest.depot_id}/chunk/${chunk.sha}`] = true;
				}
			}
		}
		let remaining_chunks = Object.keys(toDownload).length;
		if (onStartDownloading) {
			onStartDownloading(remaining_chunks, alreadyDownloaded);
		}
		if (remaining_chunks == 0) {
			resolve();
		}
		let /*host_i = 0,*/ running = 0;
		const concurrency = hosts.length == 1 ? 4 : (hosts.length * 2);
		const loop = () => {
			while (running < concurrency) {
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
					if (onFinishDownload) {
						onFinishDownload(path, res.status, host);
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
};

module.exports = {
	DEFAULT_HOSTS,
	sha1,
	sha1file,
	compress,
	getFiles,
	getFileContents,
	getChunk,
	fetchManifest: async (depotId, manifestId) => {
		try {
			return await fsPromises.readFile(`manifests/${depotId}_${manifestId}.manifest`);
		}
		catch (e) {
			// fallthrough
		}
		const forkers = [
			"qwe213312",
			"mejikuhibiniu1",
			"Sainan",
			//"FreakyObservatory", // Seems inactive now and seems to have no manifests missing in the above.
		];
		for (const forker of forkers) {
			const res = await fetch(`https://raw.githubusercontent.com/${forker}/k25FCdfEOoEJ42S6/refs/heads/main/${depotId}_${manifestId}.manifest`);
			if (res.status == 200) {
				const ab = await res.arrayBuffer();
				await fsPromises.mkdir(`manifests`, { recursive: true });
				await fsPromises.writeFile(`manifests/${depotId}_${manifestId}.manifest`, Buffer.from(ab));
				return ab;
			}
		}
		throw new Error(`Could not find the given manifest (${manifestId}). Double-check with https://steamdb.info/depot/${depotId}/manifests/ and report an issue in https://github.com/Sainan/k25FCdfEOoEJ42S6/issues if you're sure the manifest exists.`);
	},
	fetchDepotKey: async (depotId) => {
		try {
			return await fsPromises.readFile(`depot/${depotId}/key.txt`, "utf-8");
		}
		catch (e) {
			// fallthrough
		}
		const depotkeys = await fetch("https://raw.githubusercontent.com/SteamAutoCracks/ManifestHub/refs/heads/main/depotkeys.json").then(x => x.json());
		if (!depotkeys[depotId]) {
			throw new Error(`Failed to get the depot key.`);
		}
		await fsPromises.mkdir(`depot/${depotId}`, { recursive: true });
		fsPromises.writeFile(`depot/${depotId}/key.txt`, depotkeys[depotId], "utf-8");
		return depotkeys[depotId];
	},
	populateChunks: async (manifest, depotKey, installDir, onProgress) => {
		if (manifest.filenames_encrypted) {
			ContentManifest.decryptFilenames(manifest, depotKey);
		}
		await fsPromises.mkdir(`depot/${manifest.depot_id}/chunk`, { recursive: true });
		let file_i = 0;
		for (const file of manifest.files) {
			if (file.flags & 64) {
				continue;
			}
			const filename = file.filename.replace(/\\/g, "/");
			if (fs.existsSync(path.join(installDir, filename))) {
				const readSteam = await fsPromises.open(path.join(installDir, filename), "r");
				let chunk_i = 0;
				const writePromises = [];
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
							const writePromise = fsPromises.writeFile(`depot/${manifest.depot_id}/chunk/${chunk.sha}`, chunkBuf);
							if (onProgress) {
								writePromise.then(() => {
									onProgress(filename, file_i, manifest.files.length, chunk_i++, file.chunks.length)
								});
							}
							writePromises.push(writePromise);
						}
					}
				}
				await readSteam.close();
				await Promise.all(writePromises);
			}
			++file_i;
		}
	},
	downloadChunks,
	install: async (manifest, depotKey, installDir, onFileWritten) => {
		ContentManifest.decryptFilenames(manifest, depotKey);
		installDir ??= `install/${manifest.depot_id}/${manifest.gid_manifest}`;
		await fsPromises.mkdir(installDir, { recursive: true });
		for (const file of manifest.files) {
			const filename = file.filename.replace(/\\/g, "/");
			if (file.flags & 64) {
				await fsPromises.mkdir(path.join(installDir, filename), { recursive: true });
				continue;
			}
			const exists = fs.existsSync(path.join(installDir, filename));
			if (!exists || await sha1file(path.join(installDir, filename)) != file.sha_content) {
				for (const chunk of file.chunks) {
					chunk.offset = parseInt(chunk.offset);
				}
				file.chunks.sort((a, b) => a.offset - b.offset);

				await fsPromises.mkdir(path.dirname(path.join(installDir, filename)), { recursive: true });
				const writeStream = await fsPromises.open(path.join(installDir, filename), "w");
				for (let i = 0; i != file.chunks.length; ) {
					const j = Math.min(i + 100, file.chunks.length);
					const promises = [];
					for (; i != j; ++i) {
						promises.push(getChunk(manifest.depot_id, depotKey, file.chunks[i].sha));
					}
					for (const p of promises) {
						await writeStream.write(await p);
					}
				}
				await writeStream.close();
				if (onFileWritten) {
					onFileWritten(filename, exists);
				}
			}
		}
	},
	downloadAndInstall: async (manifest, depotKey, onStartDownloading, onStartDownload, onFinishDownload, onErroredDownload, hosts, installDir) => {
		const depotId = manifest.depot_id;

		ContentManifest.decryptFilenames(manifest, depotKey);
		installDir ??= `install/${manifest.depot_id}/${manifest.gid_manifest}`;

		const writeStreams = {};
		for (const file of manifest.files) {
			const filename = file.filename.replace(/\\/g, "/");
			if (file.flags & 64) {
				await fsPromises.mkdir(path.join(installDir, filename), { recursive: true });
			}
			else {
				await fsPromises.mkdir(path.dirname(path.join(installDir, filename)), { recursive: true });
				writeStreams[file.filename] = await fsPromises.open(path.join(installDir, filename), "w");
			}
		}

		const ioQueue = [];
		let ioLoopRunning = false;
		let ioLoopPromise;
		const ioLoop = async () => {
			ioLoopRunning = true;
			while (ioQueue.length > 0) {
				const completedChunks = {};
				for (let i = 0; ioQueue.length > 0 && i != 100; ++i) {
					const chunkSha = ioQueue.shift();
					completedChunks[chunkSha] = getChunk(depotId, depotKey, chunkSha);
				}
				for (const file of manifest.files) {
					for (const chunk of file.chunks) {
						if (chunk.sha in completedChunks) {
							const data = await completedChunks[chunk.sha];
							await writeStreams[file.filename].write(data, 0, data.byteLength, parseInt(chunk.offset));
						}
					}
				}
			}
			ioLoopRunning = false;
		};
		const ioAddPath = (path) => {
			ioQueue.push(path.substr(path.length - 40));
			if (!ioLoopRunning) {
				ioLoopPromise = ioLoop();
			}
		};

		await downloadChunks(
			manifest,
			(num_chunks, alreadyDownloaded) => {
				for (const path of alreadyDownloaded) {
					ioAddPath(path);
				}
				if (onStartDownloading) {
					onStartDownloading(num_chunks);
				}
			},
			onStartDownload,
			(path, status, host) => {
				if (status == 200) {
					ioAddPath(path);
				}
				if (onFinishDownload) {
					onFinishDownload(path, status, host);
				}
			},
			onErroredDownload,
			hosts
		);

		if (ioLoopRunning) {
			await ioLoopPromise;
		}

		for (const writeStream of Object.values(writeStreams)) {
			await writeStream.close();
		}
	},
	verifyChunks: async (depotId, depotKey, onDeletedFile) => {
		const files = await getFiles(`depot/${depotId}/chunk`);
		let promises = [];
		for (const file of files) {
			const hash = file.substr(file.length - 40);
			if (promises.length > 100) {
				await Promise.all(promises);
				promises = [];
			}
			promises.push((async () => {
				try {
					await getChunk(depotId, depotKey, hash);
					return;
				}
				catch (e) {
					//console.log(e);
				}
				await fsPromises.unlink(file);
				if (onDeletedFile) {
					onDeletedFile(file, hash);
				}
			})());
		}
		await Promise.all(promises);
	},
};
